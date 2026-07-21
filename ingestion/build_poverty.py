#!/usr/bin/env python3
"""xlsx -> Postgres ingestion for PSA Small Area Estimates of poverty (E4.4).

Loads PSA's "Annex 1. Statistical Table on 2018, 2021 and 2023 City- and Municipal-Level
Poverty Estimates" (owner-supplied, PSGC-stamped) into agg_poverty. Long format: one row per
(geo_code, sae_year) carrying poverty_incidence + coefficient of variation + standard error +
the 90% confidence interval, exactly as published — the CI columns the plan calls for.

  ingestion/data/psa_sae_2023_poverty.xlsx  -> sae_year 2018 / 2021 / 2023
                                               (single dataset psa-sae-poverty-2023: all three
                                                years are back-estimates from the same 2023 release)

Join to dim_geo (the target of truth, 2020+ PSGC series). The source carries the *classic*
pre-2020 PSGC (NCR districts as pseudo-provinces — Manila = province 39; ARMM as region 15),
so the join derives dim_geo's province code from the old PSGC, then name-matches the
city/municipality *within* that province (tolerant of the 2- vs 3-digit province widening and
Manila's district split). Region-scoped unique-name matching is the fallback for the NCR
multi-city districts and for the 2022 Maguindanao split (whose old province code 38 no longer
resolves). Every residual is reported, never silently dropped (the 1.6 discipline).

Grain: **city/municipality only**. Poverty incidence is a rate; it is NOT rolled up to
province/region/national (that would need population weighting PSA does not publish here), so
agg_poverty carries no parent rows. Poverty therefore appears in the Relationships view only
where the children are cities/municipalities (a province view). This is a deliberate deviation
from the plan's "province/citymun grain" wording — the source stops at city/municipality.

Known reconciliation residuals (documented in docs/POVERTY_SAE.md / _qa_report_poverty.json):
  * The source is "noHUC": Highly Urbanized Cities (Cebu, Davao, all 16 non-Manila Metro Manila
    cities, Bacolod, Cotabato City, ...) are a separate SAE domain and carry NO estimate here.
  * City of Manila is split into 14 districts in the source but folded into 10 in dim_geo, so
    four source districts (Binondo, San Miguel, Ermita, Intramuros) have no dim_geo node.
  * Kalayaan, Palawan has no estimate ("not generated", the source's own footnote 3).
  * BARMM Special Geographic Areas (dim_geo province 19999) are not in the source.

Run modes mirror ingest_population.py:
  python ingestion/build_poverty.py --dim-geo-json ingestion/dim_geo.json --verify
  python ingestion/build_poverty.py --dim-geo-json ingestion/dim_geo.json --emit-sql-dir OUT
  python ingestion/build_poverty.py --database-url "$DATABASE_URL"
"""

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

from ingest import batched

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA = REPO_ROOT / "ingestion" / "data"
QA_REPORT_PATH = REPO_ROOT / "ingestion" / "_qa_report_poverty.json"

SOURCE_FILE = "psa_sae_2023_poverty.xlsx"
DATASET_SLUG = "psa-sae-poverty-2023"
TABLE = "agg_poverty"
BATCH_SIZE = 400

# 0-indexed source columns per year: (incidence, cv, se, ci_low, ci_high). Verified against the
# workbook's multi-row header (row groups: Poverty Incidence | CoV | Standard Error | 90% CI).
YEAR_COLS = {
    2018: (3, 6, 9, 12, 13),
    2021: (4, 7, 10, 14, 15),
    2023: (5, 8, 11, 16, 17),
}

# --- name normalisation (shared shape with ingest_population.py) --------------------------- #
ABBREV = {"GEN": "GENERAL", "PRES": "PRESIDENT", "STO": "SANTO", "STA": "SANTA"}
# Source spelling -> dim_geo spelling, for the handful that differ and would otherwise be lost.
# Documented reconciliations (docs/POVERTY_SAE.md), not silent guesses.
SPELLING_FIXUPS = {
    "BALIUAG": "BALIWAG",            # dim_geo spells CITY OF BALIWAG (Bulacan)
    "SAN IDELFONSO": "SAN ILDEFONSO",  # source transposes the L (Bulacan)
    "JETAFE": "GETAFE",              # Bohol
    "PINAMUNGAHAN": "PINAMUNGAJAN",  # Cebu
    "LAPAZ": "LA PAZ",               # Leyte
    "BUMBARAN": "AMAI MANABILANG",   # renamed 2018 (the source's own footnote 2); dim_geo carries new name
}
# Old-PSGC -> dim_geo geo_code overrides for codes the derivation cannot resolve on its own.
# Maguindanao's classic province 38 was split (2022) into del Norte/del Sur, so its old code no
# longer maps and its Parang collides by name with Sulu's Parang region-wide.
CODE_OVERRIDES = {
    "153811": "1908709",  # Parang, Maguindanao del Norte (vs Sulu's Parang 1906609)
}
# NIR: three provinces re-regioned to XVIII (RA 12000, 2024); the source still codes them under
# classic regions 06/07. Keyed (old_region, old_province) -> dim_geo province code.
NIR_PROVCODE = {("06", "45"): "18045", ("07", "46"): "18046", ("07", "61"): "18061"}


def norm(s):
    if s is None:
        return ""
    s = str(s).strip().upper().replace("Ñ", "N")
    s = re.sub(r"\*+", " ", s)
    s = re.sub(r"\s+\d+\s*$", "", s)
    s = re.sub(r"[.,\-']", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = " ".join(ABBREV.get(w, w) for w in s.split())
    return SPELLING_FIXUPS.get(s, s)


def variants(name):
    """Candidate match keys in priority order (most specific first)."""
    n = norm(name)
    ordered = [n]
    m = re.match(r"^(.+?)\s+CITY$", n)               # "CALBAYOG CITY" -> "CITY OF CALBAYOG"
    if m:
        ordered.append(f"CITY OF {m.group(1)}")
    p = re.match(r"^(.*?)\s*\((.+)\)\s*$", n)          # "HINOBA-AN (ASIA)" -> both halves
    if p:
        for half in (p.group(1), p.group(2)):
            ordered.append(norm(half))
    core = re.sub(r"^(CITY OF|MUNICIPALITY OF)\s+", "", n)
    core = re.sub(r"\s*\((CAPITAL|CAPITAL CITY|HUC|ICC|CC)\)\s*$", "", core).strip()
    ordered.append(core)
    if m:
        ordered.append(m.group(1))
    seen, res = set(), []
    for v in ordered:
        for cand in (v, SPELLING_FIXUPS.get(v, v)):   # apply fixups to the class-stripped core too
            if cand and cand not in seen:
                seen.add(cand)
                res.append(cand)
    return res


def derive_provcode(old6):
    """dim_geo (2020+) province code for a classic 6-digit PSGC RR PP MM, plus (muni_seq,
    new_region). Handles the ARMM->BARMM region bump, the NIR re-regioning, and Manila's
    province recode; everything else is the plain 2->3 digit province widening."""
    rr, pp, mm = old6[:2], old6[2:4], old6[4:6]
    if (rr, pp) in NIR_PROVCODE:
        return NIR_PROVCODE[(rr, pp)], mm, "18"
    new_rr = "19" if rr == "15" else rr
    if rr == "13" and pp == "39":            # classic NCR "1st district" == City of Manila
        return "13806", mm, "13"
    return new_rr + "0" + pp, mm, new_rr


def build_reference(geo):
    """From a dim_geo dump [[code,name,level,province_code,region_code,prov_name,region_name],...]
    build the province-scoped and region-scoped name indexes plus a province-code/muni-sequence
    index (for Manila's districts)."""
    cm = [g for g in geo if g[2] == "citymun"]
    provcodes = {g[0] for g in geo if g[2] == "province"}
    by_pc = defaultdict(dict)     # province_code -> {variant: citymun_code}
    by_pc_seq = {}                # (province_code, muni_seq) -> citymun_code
    by_region = defaultdict(lambda: defaultdict(set))  # region_code -> {variant: {codes}}
    names = {}
    for code, name, _lvl, pc, rc, *_ in cm:
        names[code] = name
        for v in variants(name):
            by_pc[pc].setdefault(v, code)
            by_region[rc][v].add(code)
        by_pc_seq[(pc, code[-2:])] = code
    return {"cm_codes": {g[0] for g in cm}, "provcodes": provcodes,
            "by_pc": by_pc, "by_pc_seq": by_pc_seq, "by_region": by_region, "names": names}


def match_row(old6, muni, ref):
    """Resolve one source city/municipality to a dim_geo geo_code, with the method used."""
    if old6 in CODE_OVERRIDES:
        return CODE_OVERRIDES[old6], "override"
    pc, seq, new_rr = derive_provcode(old6)
    vs = variants(muni)
    if pc in ref["provcodes"]:
        for v in vs:
            if v in ref["by_pc"][pc]:
                return ref["by_pc"][pc][v], "provname"
        if (pc, seq) in ref["by_pc_seq"]:            # Manila district by muni sequence
            return ref["by_pc_seq"][(pc, seq)], "provseq"
    for v in vs:                                      # region-scoped unique fallback
        cand = ref["by_region"][new_rr].get(v)
        if cand and len(cand) == 1:
            return next(iter(cand)), "regionuniq"
    return None, None


def parse_file(path, ref):
    """Return (rows, unmatched, method_counts). `rows` is a list of dicts, one per
    (geo_code, year) with the five published measures."""
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    rows, unmatched = [], []
    method = defaultdict(int)
    seen_codes = set()
    for raw in wb.active.iter_rows(values_only=True):
        psgc, muni = raw[0], raw[2]
        if not isinstance(psgc, (int, float)) or muni is None:
            continue
        old6 = str(int(psgc)).zfill(6)
        code, how = match_row(old6, muni, ref)
        if code is None:
            unmatched.append({"psgc": old6, "name": str(muni)})
            continue
        method[how] += 1
        seen_codes.add(code)
        for year, (ci, cvi, sei, loi, hii) in YEAR_COLS.items():
            inc = raw[ci] if len(raw) > ci else None
            if not isinstance(inc, (int, float)):
                continue  # e.g. Kalayaan — "not generated" (source footnote 3)
            rows.append({
                "geo_code": code, "sae_year": year,
                "poverty_incidence": round(float(inc), 4),
                "cv": _num(raw, cvi), "se": _num(raw, sei),
                "ci_low": _num(raw, loi), "ci_high": _num(raw, hii),
            })
    return rows, unmatched, method, seen_codes


def _num(raw, i):
    v = raw[i] if len(raw) > i else None
    return round(float(v), 4) if isinstance(v, (int, float)) else None


def sql_for_rows(rows):
    """Idempotent INSERT ... SELECT with dataset_id resolved via the slug (reloads by dataset)."""
    def lit(x):
        return "NULL" if x is None else repr(x)
    body = ",".join(
        f"('{r['geo_code']}',{r['sae_year']},{r['poverty_incidence']},"
        f"{lit(r['cv'])},{lit(r['se'])},{lit(r['ci_low'])},{lit(r['ci_high'])})"
        for r in rows)
    return (
        f"INSERT INTO {TABLE} (dataset_id, geo_code, geo_level, sae_year, poverty_incidence, cv, se, ci_low, ci_high)\n"
        f"SELECT d.dataset_id, v.geo_code, 'citymun', v.sae_year, v.poverty_incidence, v.cv, v.se, v.ci_low, v.ci_high\n"
        f"FROM (VALUES {body}) AS v(geo_code, sae_year, poverty_incidence, cv, se, ci_low, ci_high)\n"
        f"CROSS JOIN (SELECT dataset_id FROM dim_dataset WHERE slug = '{DATASET_SLUG}') d\n"
        f"ON CONFLICT (dataset_id, geo_code, sae_year) DO UPDATE SET\n"
        f"  poverty_incidence = EXCLUDED.poverty_incidence, cv = EXCLUDED.cv, se = EXCLUDED.se,\n"
        f"  ci_low = EXCLUDED.ci_low, ci_high = EXCLUDED.ci_high;\n")


def load_dim_geo(args):
    if args.dim_geo_json:
        return json.load(open(args.dim_geo_json))
    import psycopg2
    conn = psycopg2.connect(args.database_url)
    cur = conn.cursor()
    cur.execute("""
        select g.geo_code, g.geo_name, g.geo_level, g.province_code, g.region_code,
               p.geo_name, r.geo_name
        from dim_geo g
        left join dim_geo p on p.geo_code = g.province_code
        left join dim_geo r on r.geo_code = g.region_code
        where g.geo_level in ('citymun','province','region')""")
    return [list(row) for row in cur.fetchall()]


def selftest():
    assert norm("San Idelfonso") == "SAN ILDEFONSO"       # full-name spelling fixup
    assert "BALIWAG" in variants("City of Baliuag")       # fixup reached via the class-stripped core
    assert norm("Hinoba-An (Asia)") == "HINOBA AN (ASIA)"
    assert "CITY OF CALBAYOG" in variants("Calbayog City")
    assert derive_provcode("012801") == ("01028", "01", "01")   # Adams, Ilocos Norte
    assert derive_provcode("064502") == ("18045", "02", "18")   # City of Bago, NIR
    assert derive_provcode("150702") == ("19007", "02", "19")   # Lamitan, BARMM (ARMM 15->19)
    assert derive_provcode("133901") == ("13806", "01", "13")   # Tondo -> City of Manila
    print("build_poverty selftest: OK")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dim-geo-json", help="dim_geo dump (citymun+province+region)")
    ap.add_argument("--database-url")
    ap.add_argument("--emit-sql-dir")
    ap.add_argument("--verify", action="store_true", help="print reconciliation only")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        selftest()
        return
    if not args.dim_geo_json and not args.database_url:
        ap.error("provide --dim-geo-json or --database-url (for the dim_geo reference)")

    ref = build_reference(load_dim_geo(args))
    rows, unmatched, method, seen = parse_file(DATA / SOURCE_FILE, ref)

    covered = {r["geo_code"] for r in rows}          # geos that actually carry ≥1 estimate
    matched_no_estimate = sorted(seen - covered)     # resolved to dim_geo but "not generated"
    uncovered = sorted(ref["cm_codes"] - covered)
    by_year = defaultdict(int)
    for r in rows:
        by_year[r["sae_year"]] += 1
    qa = {
        "source_file": SOURCE_FILE,
        "dataset_slug": DATASET_SLUG,
        "grain": "citymun only (no rollup — poverty incidence is a rate)",
        "match_methods": dict(method),
        "citymun_with_estimate": len(covered),
        "citymun_total_dim_geo": len(ref["cm_codes"]),
        "citymun_uncovered": len(uncovered),
        "rows_by_year": dict(sorted(by_year.items())),
        "total_rows": len(rows),
        "unmatched_source_rows": unmatched,
        "matched_but_no_estimate": [{"code": c, "name": ref["names"][c]} for c in matched_no_estimate],
        "uncovered_citymun": [{"code": c, "name": ref["names"][c]} for c in uncovered],
    }
    QA_REPORT_PATH.write_text(json.dumps(qa, indent=2))
    print(f"[{DATASET_SLUG}] matched {len(covered)}/{len(ref['cm_codes'])} citymun · "
          f"rows {len(rows)} {dict(sorted(by_year.items()))} · methods {dict(method)}")
    print(f"unmatched source rows: {len(unmatched)} -> {[u['name'] for u in unmatched]}")
    print(f"dim_geo citymun with no poverty: {len(uncovered)} "
          f"(HUCs excluded by source + Manila folds + SGAs; see {QA_REPORT_PATH.name})")

    if args.verify:
        return
    if args.emit_sql_dir:
        out = Path(args.emit_sql_dir)
        out.mkdir(parents=True, exist_ok=True)
        for i, chunk in enumerate(batched(rows, BATCH_SIZE), 1):
            (out / f"{i:04d}_{TABLE}.sql").write_text(sql_for_rows(chunk))
        print(f"Wrote SQL batches to {out}")
    elif args.database_url:
        import psycopg2
        conn = psycopg2.connect(args.database_url)
        try:
            with conn, conn.cursor() as cur:
                for chunk in batched(rows, BATCH_SIZE):
                    cur.execute(sql_for_rows(chunk))
        finally:
            conn.close()
        print("Loaded via psycopg2.")


if __name__ == "__main__":
    main()
