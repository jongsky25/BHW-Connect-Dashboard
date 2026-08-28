#!/usr/bin/env python3
"""Cleaned CSV -> seed SQL generator for the UUC for PHC 2025 dataset (plan U1).

Reads ingestion/data/uuc_phc_2025_cleaned.csv — the machine-readable extract written by
ingestion/clean_uuc_phc_indicators.py from the source office's reconciled workbook — and emits
an idempotent seed migration for fact_uuc_phc_barangay.

Emits two seeds from the same checked extract:

  --out             fact_uuc_phc_barangay — the classification (U1). The 5,987 barangays ON the
                    2025 list. The workbook's 'NOT UUA' rows are not loaded (owner decision),
                    so no decision column is written; presence is membership.
  --indicators-out  fact_uuc_phc_indicators — the 12 indicator values, their provincial
                    benchmarks, and capped_indicators (U3). A value bounded during cleaning is
                    indistinguishable from a genuine one, so the per-indicator flags travel with
                    the values; without them the columns are not publishable.

Geography. The PSGC codes come from the workbook and are joined to dim_geo IN SQL, via
map_psgc_to_dim_geo(), rather than being remapped here. 87 of the 5,987 are Sulu's '09066…'
codes, which exist in dim_geo only as '19066…'; the crosswalk rows that resolve them are
seeded by 20260826121200_crosswalk_sulu_region_ix.sql. Doing the resolution in SQL means a
missing crosswalk row fails the insert on fact_uuc_phc_barangay.geo_code's NOT NULL rather
than silently dropping barangays, and keeps the remap in one place instead of two.

This mirrors ingestion/ingest_encoding_status.py: generate a migration offline, review the
diff, apply it like any other.

Usage:

  python ingestion/ingest_uuc_phc.py \
      --src ingestion/data/uuc_phc_2025_cleaned.csv \
      --out supabase/migrations/20260826121300_seed_fact_uuc_phc_barangay.sql

Regenerate the source extract first if the reconciled workbook changes:

  python ingestion/clean_uuc_phc_indicators.py
"""

import argparse
import csv
from collections import Counter
from pathlib import Path

DATASET_SLUG = "uuc-phc-2025"
TABLE = "fact_uuc_phc_barangay"
INDICATORS_TABLE = "fact_uuc_phc_indicators"

# Indicator columns, in table order. Names match the cleaned CSV's headers exactly.
INDICATOR_COLS = [
    "physical_factor",
    "ip_pop",
    "armed_conf",
    "idp",
    "four_ps",
]
HEALTH_COLS = ["imr", "ufmr", "fic", "abr", "pre_natal", "sba", "water"]
PROV_REF_COLS = [f"{c}_prov_ref" for c in HEALTH_COLS]

# The source's own criterion (d) score: how many of the seven health assessments this barangay
# failed against its province, as the source office scored it. Carried through as an integer
# because it is a *recorded classification*, not a value this pipeline derives — see the U7 note
# in supabase/migrations/20260826150000_fact_uuc_phc_indicators.sql for why it is loaded rather
# than recomputed. Range is 0–7: the AO's eighth indicator (FP CU) was dropped before
# reconciliation, so seven remain and the >= 4 threshold applies to seven.
SCORE_COL = "health_indicators"
SCORE_MAX = 7

# How many rows may carry no score at all. Exactly one: BASILAN / SUMISIP / SUMISIP CENTRAL,
# which the source office's final list carries and the reconciled workbook does not. Its
# indicator values are recovered from the workbook's '2025 LIST' sheet, which has no criterion
# (d) score column — and the score is a recorded classification this pipeline never recomputes
# (see 20260826150000_fact_uuc_phc_indicators.sql), so it stays NULL and route (d) does not
# count that barangay. Its listing does not rest on route (d): IP POP is 100, so criterion (a)
# carries it alone. A *second* blank is a different problem and still fails the load.
EXPECTED_MISSING_SCORE = 1

# Expected capped-value counts per indicator, from docs/UUC_PHC_2025_CLEANING_REPORT.md §4.
# A regression check: these are the values the published caveats quote.
EXPECTED_CAPPED = {
    "water": 886,
    "fic": 456,
    "pre_natal": 208,
    "sba": 30,
    "abr": 2,
    "imr": 1,
    "ufmr": 1,
}
EXPECTED_CAPPED_ROWS = 1397

# The vintage the workbook's codes belong to; must match the crosswalk migration's old_vintage.
SOURCE_VINTAGE = "post-2024 Sulu transfer (Sulu under Region IX)"

EXPECTED_ROWS = 5987
SULU_SOURCE_PREFIX = "09066"
EXPECTED_SULU = 87

# Regional counts as the source office's final 2025 UUC for PHC list reports them. Locked in as
# a regression check: they reproduce that list's own summary table at all 17 regions, and the
# 2027 Budget Cue Cards p37 table at all 17 as well. The reconciled workbook's embedded TOTAL
# rows differ at two — BARMM 399, CALABARZON 200 — which is exactly the six-barangay membership
# delta the extract now resolves. See docs/UUC_PHC_2025_PLAN.md §3.
EXPECTED_REGION_COUNTS = {
    "REGION V (BICOL REGION)": 757,
    "CORDILLERA ADMINISTRATIVE REGION (CAR)": 609,
    "REGION IX (ZAMBOANGA PENINSULA)": 523,
    "MIMAROPA REGION": 458,
    "REGION X (NORTHERN MINDANAO)": 440,
    "REGION XI (DAVAO REGION)": 437,
    "BANGSAMORO AUTONOMOUS REGION IN MUSLIM MINDANAO (BARMM)": 400,
    "REGION VI (WESTERN VISAYAS)": 397,
    "REGION VIII (EASTERN VISAYAS)": 358,
    "REGION XII (SOCCSKSARGEN)": 304,
    "REGION XIII (CARAGA)": 268,
    "REGION I (ILOCOS REGION)": 262,
    "REGION II (CAGAYAN VALLEY)": 227,
    "REGION IV-A (CALABARZON)": 195,
    "NEGROS ISLAND REGION (NIR)": 141,
    "REGION III (CENTRAL LUZON)": 129,
    "REGION VII (CENTRAL VISAYAS)": 82,
}


def q(value) -> str:
    """SQL string literal, or NULL for an empty cell. Names carry apostrophes (B'LAAN, M'LANG)."""
    if value is None or str(value).strip() == "":
        return "null"
    return "'" + str(value).strip().replace("'", "''") + "'"


def load_rows(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def check(rows: list[dict]) -> None:
    """Structural checks on the extract. Every one of these is a load-blocking error: the
    dashboard publishes 5,987 as a headline figure, so a silently short load is worse than a
    failed one."""
    problems = []

    if len(rows) != EXPECTED_ROWS:
        problems.append(f"expected {EXPECTED_ROWS:,} rows, found {len(rows):,}")

    codes = [r["psgc"].strip() for r in rows]
    malformed = [c for c in codes if len(c) != 10 or not c.isdigit()]
    if malformed:
        problems.append(f"{len(malformed)} malformed PSGC codes, e.g. {malformed[:3]}")

    dupes = [c for c, n in Counter(codes).items() if n > 1]
    if dupes:
        problems.append(f"{len(dupes)} duplicate PSGC codes, e.g. {dupes[:3]}")

    decisions = {r["decision"].strip().upper() for r in rows}
    if decisions != {"UUA"}:
        problems.append(f"expected only UUA rows, found {sorted(decisions)}")

    n_sulu = sum(1 for c in codes if c.startswith(SULU_SOURCE_PREFIX))
    if n_sulu != EXPECTED_SULU:
        problems.append(
            f"expected {EXPECTED_SULU} Sulu '{SULU_SOURCE_PREFIX}…' codes, found {n_sulu} — "
            "the crosswalk migration covers exactly Sulu, so a change here needs review"
        )

    # Capped-value flags: the per-indicator counts the published caveats quote. If cleaning ever
    # changes what it bounds, this fails rather than letting the dashboard's footnotes go stale.
    capped = Counter()
    capped_rows = 0
    for r in rows:
        flags = [f for f in r["capped_indicators"].split("|") if f]
        if flags:
            capped_rows += 1
        if len(flags) != int(r["values_capped"]):
            problems.append(
                f"{r['psgc']}: capped_indicators has {len(flags)} entries but values_capped "
                f"says {r['values_capped']}"
            )
        for f in flags:
            capped[f] += 1
    if capped_rows != EXPECTED_CAPPED_ROWS:
        problems.append(f"expected {EXPECTED_CAPPED_ROWS} barangays with a capped value, found {capped_rows}")
    if dict(capped) != EXPECTED_CAPPED:
        problems.append(f"capped counts changed: expected {EXPECTED_CAPPED}, found {dict(capped)}")

    # The source's criterion (d) score. It decides the health route on /uuc-phc/criteria (U7),
    # so a fraction or an out-of-range value has to fail the load rather than become a silently
    # wrong route count. A blank is allowed only up to EXPECTED_MISSING_SCORE — see there.
    bad_score, missing_score = [], []
    for r in rows:
        raw = str(r[SCORE_COL]).strip()
        if raw == "":
            missing_score.append(r["psgc"])
            continue
        try:
            value = float(raw)
        except ValueError:
            bad_score.append(f"{r['psgc']}={raw!r}")
            continue
        if value != int(value) or not (0 <= value <= SCORE_MAX):
            bad_score.append(f"{r['psgc']}={raw}")
    if bad_score:
        problems.append(
            f"{len(bad_score)} rows have a {SCORE_COL} that is not a whole number in 0–{SCORE_MAX}, "
            f"e.g. {bad_score[:3]}"
        )
    if len(missing_score) != EXPECTED_MISSING_SCORE:
        problems.append(
            f"expected {EXPECTED_MISSING_SCORE} row(s) with no {SCORE_COL}, "
            f"found {len(missing_score)}: {missing_score[:5]}"
        )

    counts = Counter(r["region_name"].strip() for r in rows)
    for region, expected in EXPECTED_REGION_COUNTS.items():
        if counts.get(region, 0) != expected:
            problems.append(f"{region}: expected {expected}, found {counts.get(region, 0)}")
    for region in set(counts) - set(EXPECTED_REGION_COUNTS):
        problems.append(f"unexpected region {region!r} ({counts[region]} rows)")

    if problems:
        raise SystemExit("Source extract failed its checks:\n  - " + "\n  - ".join(problems))

    print(
        f"Checks passed: {len(rows):,} listed barangays, {len(counts)} regions, "
        f"{n_sulu} Sulu codes to resolve via the crosswalk, "
        f"{sum(capped.values()):,} capped values across {capped_rows:,} barangays."
    )


def emit_sql(rows: list[dict]) -> str:
    header = (
        "-- Seed fact_uuc_phc_barangay with the 2025 UUC for PHC list (plan U1).\n"
        "--\n"
        "-- Generated by ingestion/ingest_uuc_phc.py from ingestion/data/uuc_phc_2025_cleaned.csv,\n"
        "-- which ingestion/clean_uuc_phc_indicators.py writes from the source office's reconciled\n"
        "-- workbook. Do not hand-edit: regenerate both.\n"
        "--\n"
        "-- 5,987 rows, one per listed barangay. geo_code is resolved through\n"
        "-- map_psgc_to_dim_geo() rather than written literally, so Sulu's 87 '09066…' codes\n"
        "-- resolve via dim_psgc_crosswalk and a missing crosswalk row fails this insert on\n"
        "-- geo_code's NOT NULL instead of dropping barangays. Idempotent: re-running updates the\n"
        "-- provenance columns in place.\n\n"
        "with ds as (\n"
        f"  select dataset_id from dim_dataset where slug = '{DATASET_SLUG}'\n"
        "),\n"
        "src (source_geo_code, region_name, province_name, citymun_name, barangay_name) as (\n"
        "  values\n"
    )
    lines = []
    for r in rows:
        lines.append(
            "    ({}, {}, {}, {}, {})".format(
                q(r["psgc"]),
                q(r["region_name"]),
                q(r["province_name"]),
                q(r["citymun_name"]),
                q(r["barangay_name"]),
            )
        )
    body = ",\n".join(lines)
    footer = (
        "\n)\n"
        f"insert into {TABLE} (\n"
        "  dataset_id, geo_code, source_geo_code,\n"
        "  source_region, source_province, source_citymun, source_barangay\n"
        ")\n"
        "select\n"
        "  (select dataset_id from ds),\n"
        f"  map_psgc_to_dim_geo(src.source_geo_code, '{SOURCE_VINTAGE}'),\n"
        "  src.source_geo_code,\n"
        "  src.region_name, src.province_name, src.citymun_name, src.barangay_name\n"
        "from src\n"
        "on conflict (dataset_id, geo_code) do update set\n"
        "  source_geo_code = excluded.source_geo_code,\n"
        "  source_region = excluded.source_region,\n"
        "  source_province = excluded.source_province,\n"
        "  source_citymun = excluded.source_citymun,\n"
        "  source_barangay = excluded.source_barangay;\n"
    )
    return header + body + footer



def num(value) -> str:
    """SQL numeric literal, or NULL for a blank cell (a value the source did not supply)."""
    if value is None or str(value).strip() == "":
        return "null"
    return str(float(value))


def flag(value) -> str:
    """SQL boolean from the source's 0/1 encoding; NULL when blank."""
    v = str(value).strip()
    if v == "":
        return "null"
    return "true" if v not in ("0", "0.0") else "false"


def score(value) -> str:
    """SQL smallint literal for the source's criterion (d) score, or NULL where it has none.
    Integer-formatted, not via num(): the column is smallint and a `4.0` literal would churn
    every row of the generated seed for no change in value."""
    v = str(value).strip()
    if v == "":
        return "null"
    return str(int(float(v)))


def arr(value) -> str:
    """SQL text[] literal from the pipe-separated capped-indicator list."""
    flags = [f for f in str(value).split("|") if f]
    if not flags:
        return "'{}'::text[]"
    return "array[" + ", ".join(q(f) for f in flags) + "]"


def emit_indicators_sql(rows: list[dict]) -> str:
    cols = INDICATOR_COLS + ["elcac_brgy"] + HEALTH_COLS + PROV_REF_COLS + [SCORE_COL]
    header = (
        "-- Seed fact_uuc_phc_indicators with the 2025 UUC for PHC indicator values (plan U3).\n"
        "--\n"
        "-- Generated by ingestion/ingest_uuc_phc.py from ingestion/data/uuc_phc_2025_cleaned.csv.\n"
        "-- Do not hand-edit: regenerate both.\n"
        "--\n"
        "-- 5,987 rows, one per listed barangay: 12 indicators, the 7 provincial benchmarks\n"
        "-- criterion (d) compares against, and capped_indicators — which of this barangay's values\n"
        "-- were bounded during cleaning. 1,584 values across 1,397 barangays were bounded; without\n"
        "-- the flags a bounded 100% is indistinguishable from a genuine one. Also health_indicators\n"
        "-- (U7): the source office's own criterion (d) score, 0-7, loaded rather than recomputed —\n"
        "-- see 20260826150000_fact_uuc_phc_indicators.sql. geo_code resolves\n"
        "-- through map_psgc_to_dim_geo() for the same reason as the classification seed.\n"
        "-- Idempotent: re-running updates every value in place.\n\n"
        "with ds as (\n"
        f"  select dataset_id from dim_dataset where slug = '{DATASET_SLUG}'\n"
        "),\n"
        "src (source_geo_code, " + ", ".join(cols) + ", capped_indicators) as (\n"
        "  values\n"
    )
    lines = []
    for r in rows:
        vals = [q(r["psgc"])]
        vals += [num(r[c]) for c in INDICATOR_COLS]
        vals.append(flag(r["elcac_brgy"]))
        vals += [num(r[c]) for c in HEALTH_COLS]
        vals += [num(r[c]) for c in PROV_REF_COLS]
        vals.append(score(r[SCORE_COL]))
        vals.append(arr(r["capped_indicators"]))
        lines.append("    (" + ", ".join(vals) + ")")
    # The first row carries the casts the VALUES list needs: an all-NULL column would otherwise be
    # typed `text` and fail the insert, and the array literal needs its type stated once.
    body = ",\n".join(lines)
    footer = (
        "\n)\n"
        f"insert into {INDICATORS_TABLE} (\n"
        "  dataset_id, geo_code, " + ", ".join(cols) + ", capped_indicators\n"
        ")\n"
        "select\n"
        "  (select dataset_id from ds),\n"
        f"  map_psgc_to_dim_geo(src.source_geo_code, '{SOURCE_VINTAGE}'),\n"
        "  " + ", ".join(f"src.{c}" for c in cols) + ",\n"
        "  src.capped_indicators\n"
        "from src\n"
        "on conflict (dataset_id, geo_code) do update set\n"
        + ",\n".join(f"  {c} = excluded.{c}" for c in cols + ["capped_indicators"])
        + ";\n\n"
        "-- The provincial benchmarks are stored per barangay and exposed one-row-per-province by\n"
        "-- the ref_uuc_phc_provincial view. That is only sound while every barangay in a province\n"
        "-- carries the same reference, which the source does but nothing enforces. Assert it here:\n"
        "-- a contradiction aborts the migration rather than silently picking one value.\n"
        "do $$\n"
        "declare\n"
        "  n_bad integer;\n"
        "begin\n"
        "  select count(*) into n_bad from (\n"
        "    select g.province_code\n"
        "    from fact_uuc_phc_indicators i\n"
        "    join dim_geo g on g.geo_code = i.geo_code\n"
        "    group by g.province_code\n"
        "    having count(distinct i.imr_prov_ref) > 1\n"
        "        or count(distinct i.ufmr_prov_ref) > 1\n"
        "        or count(distinct i.fic_prov_ref) > 1\n"
        "        or count(distinct i.abr_prov_ref) > 1\n"
        "        or count(distinct i.pre_natal_prov_ref) > 1\n"
        "        or count(distinct i.sba_prov_ref) > 1\n"
        "        or count(distinct i.water_prov_ref) > 1\n"
        "  ) t;\n"
        "  if n_bad > 0 then\n"
        "    raise exception 'ref_uuc_phc_provincial would be ambiguous: % province(s) carry more "
        "than one provincial reference value', n_bad;\n"
        "  end if;\n"
        "end $$;\n"
    )
    return header + body + footer


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--src",
        default="ingestion/data/uuc_phc_2025_cleaned.csv",
        help="Cleaned extract from clean_uuc_phc_indicators.py",
    )
    parser.add_argument("--out", help="Path to write the classification seed .sql migration")
    parser.add_argument(
        "--indicators-out", help="Path to write the indicator seed .sql migration (plan U3)"
    )
    args = parser.parse_args()

    if not args.out and not args.indicators_out:
        raise SystemExit("Nothing to do: pass --out and/or --indicators-out")

    rows = load_rows(Path(args.src))
    check(rows)
    if args.out:
        Path(args.out).write_text(emit_sql(rows))
        print(f"Wrote {args.out}: {len(rows):,} barangay rows")
    if args.indicators_out:
        Path(args.indicators_out).write_text(emit_indicators_sql(rows))
        print(f"Wrote {args.indicators_out}: {len(rows):,} indicator rows")


if __name__ == "__main__":
    main()
