#!/usr/bin/env python3
"""E4.3 — DOF/BLGF 2024 LGU income reclassification loader.

Parses Annex A of DOF Department Order No. 074-2024 (the "Schedule of Income
Classification for the First General Income Reclassification of Provinces, Cities,
and Municipalities" under RA 11964) and reconciles each listed LGU against
`dim_geo`, producing a geo_code -> new income class mapping.

Why this exists
---------------
RA 11964 (the Automatic Income Classification of LGUs Act) collapsed the old
SIX-class ladder (1st..6th, DOF DO 23-08 vintage) into FIVE classes (1st..5th)
and recomputed every province/city/municipality from FY2021-2023 regular income.
DO 074-2024 took effect 01 January 2025. `dim_geo.income_class` previously held
the StepZero-reported (pre-reclassification, DO 23-08 era) class; this loader
refreshes it to the DO 074-2024 value and preserves the old one for provenance.

Source & reconciliation discipline
----------------------------------
- The DOF Annex A carries NO PSGC codes and labels regions with the *pre-NIR*
  vintage (Negros under Region VI/VII), so the join is name-based, province-scoped,
  and NIR-aware (see match logic). Every unresolved row is logged both ways, never
  silently dropped (the 1.6 boundary-reconciliation discipline).
- The public source file is an OCR'd mirror; a small, explicit OVERRIDES table
  (verified by eye against the rendered PDF) fixes the handful of rows the fuzzy
  matcher cannot resolve confidently. This IS the plan's "manual fixups file".
- Rows the source itself leaves unclassified ("New" for newly-created LGUs, a
  literal dash for Ubay, Bohol) get NO numeric class — dim_geo retains its prior
  value and the row is reported, never guessed.

Usage
-----
  # Re-derive the mapping from the PDF + a dim_geo export (sandbox / CI):
  python ingestion/build_income_reclass.py --pdf DO_074.2024_with_table.pdf \
      --dim-geo-json dim_geo.json --out ingestion/data/income_reclass_2024.csv

  # Or pull dim_geo straight from Postgres:
  python ingestion/build_income_reclass.py --pdf ... --database-url "$DATABASE_URL" --out ...

The committed CSV (ingestion/data/income_reclass_2024.csv) is the authoritative,
reviewed artifact; the E4.3 migration is generated from it.
"""
from __future__ import annotations
import argparse, csv, json, re, sys, unicodedata

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None
from rapidfuzz import fuzz, process

# ---------------------------------------------------------------------------
# 1. Parse Annex A
# ---------------------------------------------------------------------------
CLASS = re.compile(r'^(1st|2nd|3rd|4th|5th|6th|New|Special)\*?$', re.I)
DASH = ('-', '–', '—')
NOISE = {'I', '|', 'l', 'j', 's', 'i', 'J', 'f', '[', ']', '!', '.'}
ORD = {'1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6}
SUFFIX = {'City', 'City)', '(Capital)', 'City(Capital)', '(capital)'}
# Annex A section page ranges (0-indexed) in the DO_074.2024_with_table.pdf mirror.
PROV_PAGES, CITY_PAGES, MUNI_PAGES = range(4, 6), range(6, 10), range(10, 38)


def norm_class(tok):
    if tok is None:
        return None
    t = tok.rstrip('*').strip()
    tl = t.lower()
    if tl in ORD:
        return ORD[tl]
    if tl == 'special':
        return 'Special'
    if tl == 'new':
        return 'New'
    return None  # dash / unreadable


def cluster_rows(page, tol=4):
    words = [(x0, y0, x1, y1, w) for x0, y0, x1, y1, w, *_ in page.get_text("words")]
    words.sort(key=lambda t: (t[1], t[0]))
    rows, cur, cy = [], [], None
    for x0, y0, x1, y1, w in words:
        if cy is None or abs(y0 - cy) <= tol:
            cur.append((x0, w)); cy = y0 if cy is None else (cy + y0) / 2
        else:
            rows.append(sorted(cur)); cur = [(x0, w)]; cy = y0
    if cur:
        rows.append(sorted(cur))
    return rows


def parse_page(page, ncol):
    """Yield {blob, name, old_class, new_class, converted, retained} per data row.
    `name` = rightmost x-group; `blob` = region [+ province] words to its left."""
    out = []
    for cells in cluster_rows(page):
        while cells and cells[-1][1] in NOISE:
            cells = cells[:-1]
        if len(cells) < 2:
            continue
        cls = [(i, x, w) for i, (x, w) in enumerate(cells) if CLASS.match(w) or w in DASH]
        if len(cls) < 2:
            continue
        old_x, old_w = cls[-2][1], cls[-2][2]
        new_w = cls[-1][2]
        converted = any('Municipal' in w for x, w in cells)
        retained = new_w.endswith('*')
        # Keep every word left of the OLD-class column (that x-cut already excludes the
        # two class cells). Do NOT drop CLASS-matching words here: names legitimately begin
        # with "New" (New Lucena, New Bataan, ...), which would otherwise vanish.
        left = [(x, w) for x, w in cells if x < old_x - 5
                and w not in DASH and 'Municipal' not in w and w not in ('(as', '(asMunicipality)')]
        if not left:
            continue
        left.sort()
        groups = [[left[0]]]
        for x, w in left[1:]:
            (groups[-1] if x - groups[-1][-1][0] <= 30 else groups.append([]) or groups[-1]).append((x, w))
        gj = lambda g: " ".join(w for x, w in g).strip()
        if len(groups) >= 2 and gj(groups[-1]) in SUFFIX:
            name = (gj(groups[-2]) + " " + gj(groups[-1])).strip()
            blob = " ".join(gj(g) for g in groups[:-2]).strip()
        else:
            name = gj(groups[-1]); blob = " ".join(gj(g) for g in groups[:-1]).strip()
        if not name:
            continue
        out.append(dict(blob=blob, name=name, old_class=norm_class(old_w),
                        new_class=norm_class(new_w), converted=converted, retained=retained))
    return out


def parse_annex(pdf_path):
    if fitz is None:
        sys.exit("PyMuPDF (pip install pymupdf) is required to parse the PDF.")
    doc = fitz.open(pdf_path)
    rows = []
    for pg in PROV_PAGES:
        for r in parse_page(doc[pg], 4):
            r['kind'] = 'province'; rows.append(r)
    for pg in CITY_PAGES:
        for r in parse_page(doc[pg], 5):
            r['kind'] = 'city'; rows.append(r)
    for pg in MUNI_PAGES:
        for r in parse_page(doc[pg], 5):
            r['kind'] = 'municipality'; rows.append(r)
    return rows


# ---------------------------------------------------------------------------
# 2. Match to dim_geo (province-scoped, region/NIR-aware)
# ---------------------------------------------------------------------------
# Only TRUE region-only tokens (province names share words like ilocos/davao/eastern).
REGION_TOK = set("region car barmm ncr mimaropa metro i ii iii iv iva ivb v vi vii "
                 "viii ix x xi xii xiii xviii".split())
PROV_ALIAS = {'north cotabato': 'cotabato', 'cotabato north': 'cotabato'}


def norm(s):
    if not s:
        return ""
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    s = s.replace('city of', ' ').replace('municipality of', ' ')
    s = re.sub(r'\(huc\)|\(capital\)|not a province|\bhuc\b|\bcity\b|\bcapital\b', ' ', s)
    s = re.sub(r'[^a-z0-9 ]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def strip_region(s):
    return " ".join(t for t in norm(s).split() if t not in REGION_TOK and len(t) > 1)


def dof_region(blob):
    b = blob.lower()
    if b.startswith('ncr') or 'metro manila' in b: return 'NCR'
    if b.startswith('car') or 'cordillera' in b: return 'CAR'
    if b.startswith('barmm') or 'bangsamoro' in b: return 'BARMM'
    if b.startswith('mimaropa'): return 'MIMAROPA'
    m = re.match(r'region\s+([ivx]+(?:-?[ab])?)', b)
    return m.group(1).upper().replace('-', '') if m else None


# --- Explicit, eyeball-verified fixups for OCR/rename/HUC rows the matcher misses.
#     Keyed by the parsed (blob, name); value is a geo_code, a list (Manila fan-out),
#     or None (source row with no PSGC counterpart / unclassified). ---
MANILA = '__MANILA_DISTRICTS__'
OVERRIDES = {
    ('Region VII Bohol Tagbilaran City', 'Based on'): '0701242',   # OCR: name lost to footnote
    ('Region 1,.1.Jda', 'Cauayan City'): '0203108',                # Isabela (OCR region blob)
    ('Region X Misamis Oriental Cagayan', 'De Oro City'): '1030500',
    ('Region XI Davao Del Norte', 'Island Garden City of'): '1102317',
    ('NCR Metro Manila', 'Las Piiias City'): '1380200',            # OCR n~ii
    ('NCR Metro Manila', 'Manila City'): MANILA,                   # one row -> 16 districts
    ('Region X Misamis Occidental', 'Ozamis City'): '1004210',     # Ozamiz
    ('NCR Metro Manila', 'Paraiiaque City'): '1381000',
    ('Region VII Negros Oriental', 'Sais City'): '1804604',        # OCR: Bais
    ('MIMAROPA Region Occidental Mindoro', 'Abra De Ilog'): '1705101',
    ('Region Antique', 'Anini-y'): '0600601',
    ('Region VIII Northern Samar', 'Boben'): '0804803',            # Bobon
    # Source mislabels Agusan del Norte's Buenavista under "Region XII / Sultan Kudarat"
    # (which has no Buenavista); the row sits in the Agusan del Norte alphabetical block,
    # right before Carmen, and Agusan's Buenavista is the only one otherwise unmatched.
    ('Region XII Sultan Kudarat', 'Buenavista'): '1600201',        # Buenavista, Agusan del Norte
    ('Region XII Sultan Kudarat', 'Columbia'): '1206502',          # Columbio
    ('BARMM Maguindanao Del Sur', 'Datu Abdullah'): '1908803',     # Datu Abdullah Sangki
    ('BARMM Maguindanao Del Sur', 'Datu Anggal'): '1908804',       # Datu Anggal Midtimbang
    ('BARMM Maguindanao Del Sur', 'Datu Hoffer'): '1908805',       # Datu Hoffer Ampatuan
    ('BARMM Maguindanao Del Sur', 'Datu Montawal'): '1908815',     # renamed from Pagagawan
    ('BARMM Maguindanao Del Sur', 'Datu Saudi-'): '1908809',       # Datu Saudi-Ampatuan
    ('BARMM Maguindanao Del Sur', 'Gen. S. K.'): '1908811',        # Gen. S.K. Pendatun
    ('Region III Nueva Ecija', 'General Mamerto'): '0304909',      # General Mamerto Natividad
    ('Region XII Sarangani', 'Gian'): '1208002',                   # Glan
    ('BARMM Sulu', 'Hadji Panglima'): '1906606',                   # Hadji Panglima Tahil
    ('BARMM Lanao Del Sur Tagoloan', 'II'): '1903638',             # Tagoloan II
    ('BARMM Sulu', 'Kalingalan'): '1906603',                       # Kalingalan Caluang
    ('Region XII North Cotabato', "M'Lang"): '1204710',
    ('Region IX Zamboanga Del Sur', 'Malave'): '0907319',          # Molave
    ('BARMM Maguindanao Del Norte', 'Northern'): '1908708',        # Northern Kabuntalan
    ('NCR Metro', 'Pateros'): '1381701',
    ('Region IV-A Rizal', 'Pililia'): '0405810',                   # Pililla
    ('Region VII Bohol', 'Pres. Carlos P. Garcia'): '0701235',     # President Carlos P. Garcia
    ('Region I Ilocos Norte', 'Sanna'): '0102811',                 # Banna
    ('BARMM Maguindanao Del Sur', 'Shariff Saydona'): '1908821',   # Shariff Saydona Mustapha
    ('Region XII South Cotabato', "T'Boli"): '1206316',
    ('CAR Abra', 'Tuba'): '1400126',                               # OCR: Tubo (Luba present separately)
    ('Region Aklan', 'Washington'): '0600415',                     # New Washington
    ('Region XJII', 'Surigao Del Norte'): '16067',                 # province (OCR region blob)
}
ACCEPT = 88  # fuzzy score threshold for auto-accept within a resolved province


def load_dim_geo(args):
    if args.dim_geo_json:
        return json.load(open(args.dim_geo_json))
    import psycopg2, psycopg2.extras
    conn = psycopg2.connect(args.database_url)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        select g.geo_code, g.geo_level, g.geo_name, g.income_class,
               p.geo_name as province_name, r.geo_name as region_name
        from dim_geo g
        left join dim_geo p on p.geo_code = g.province_code
        left join dim_geo r on r.geo_code = g.region_code
        where g.geo_level in ('citymun','province')""")
    return [dict(r) for r in cur.fetchall()]


def match(rows, geo):
    provs = [g for g in geo if g['geo_level'] == 'province']
    cms = [g for g in geo if g['geo_level'] == 'citymun']
    by_code = {g['geo_code']: g for g in geo}
    prov_by_norm = {}
    for g in provs:
        prov_by_norm.setdefault(norm(g['geo_name']), g)
    prov_names = list(prov_by_norm.keys())
    cm_by_prov, huc_all = {}, []
    for g in cms:
        cm_by_prov.setdefault(norm(g['province_name']), []).append(g)
        if g['province_name'] and 'HUC' in g['province_name'].upper():
            huc_all.append((norm(g['geo_name']), g))
    manila = [g['geo_code'] for g in cms if 'CITY OF MANILA' in (g['province_name'] or '')]

    def best_province_window(tokens):
        best_p, best_s, best_end = None, 0, 0
        for start in range(min(3, len(tokens))):
            for pname in prov_names:
                pt = pname.split(); end = start + len(pt)
                if end >= len(tokens):
                    continue
                s = fuzz.token_sort_ratio(pname, " ".join(tokens[start:end]))
                if s > best_s or (s == best_s and len(pt) > best_end - start):
                    best_s, best_p, best_end = s, pname, end
        return best_p, best_s, best_end

    results = []  # (row, [geo_codes], new_class, method, score)
    for r in rows:
        key = (r['blob'], r['name'])
        new_c = r['new_class'] if r['new_class'] in (1, 2, 3, 4, 5) else None
        if key in OVERRIDES:
            ov = OVERRIDES[key]
            codes = manila if ov == MANILA else ([] if ov is None else [ov])
            results.append((r, codes, new_c, 'override', 100)); continue
        if r['kind'] == 'province':
            q = strip_region(r['blob'] + " " + r['name'])
            for a, b in PROV_ALIAS.items():
                q = q.replace(a, b)
            if 'negros' in q:
                q = 'negros occidental' if dof_region(r['blob']) == 'VI' else 'negros oriental'
            m = process.extractOne(q, prov_names, scorer=fuzz.token_sort_ratio)
            g = prov_by_norm[m[0]]
            results.append((r, [g['geo_code']] if m[1] >= ACCEPT else [], new_c, 'province', round(m[1])))
            continue
        # city / municipality
        reg = dof_region(r['blob'])
        joined = " ".join(strip_region(r['blob'] + " " + r['name']).split())
        for a, b in PROV_ALIAS.items():
            joined = joined.replace(a, b)
        tokens = joined.split()
        pname, pscore, pend = best_province_window(tokens)
        cand_provs = []
        if tokens and tokens[0] == 'negros':
            if len(tokens) > 1 and tokens[1] in ('occidental', 'oriental'):
                pname = 'negros ' + tokens[1]; cand_provs = [pname]; name_q = " ".join(tokens[2:])
            else:
                pname = {'VI': 'negros occidental', 'VII': 'negros oriental'}.get(reg, 'negros')
                cand_provs = [pname] if reg in ('VI', 'VII') else ['negros occidental', 'negros oriental']
                name_q = " ".join(tokens[1:])
            name_q = name_q or " ".join(tokens); pscore = 100
        elif (len(tokens) >= 3 and tokens[1] == 'del' and tokens[2] not in ('norte', 'sur')
              and tokens[0] + ' del norte' in prov_names):
            cand_provs = [p for p in prov_names if p.startswith(tokens[0] + ' del')]
            name_q = " ".join(tokens[2:]); pscore = 100
        elif pscore >= 85:
            name_q = " ".join(tokens[pend:]) or " ".join(tokens)
            cand_provs = [pname]
            if pname.split()[-1] == 'del':
                cand_provs = [p for p in prov_names if p.startswith(pname.rsplit(' del', 1)[0] + ' del')]
            if pname.startswith('negros'):
                cand_provs = ['negros occidental', 'negros oriental']
        else:
            name_q = " ".join(tokens)
        cands = [g for p in cand_provs for g in cm_by_prov.get(p, [])]
        best, bs = None, 0
        for g in cands:
            s = fuzz.token_sort_ratio(norm(g['geo_name']), name_q)
            if s > bs:
                bs, best = s, g
        for nn, g in huc_all:   # HUCs listed under a mother province but filed independently
            s = fuzz.token_sort_ratio(nn, name_q)
            if s > bs:
                bs, best = s, g
        results.append((r, [best['geo_code']] if best and bs >= ACCEPT else [], new_c, 'fuzzy', round(bs)))
    return results, by_code


# ---------------------------------------------------------------------------
# 3. Emit mapping + reconciliation report
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pdf', required=True)
    ap.add_argument('--dim-geo-json')
    ap.add_argument('--database-url')
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    if not args.dim_geo_json and not args.database_url:
        ap.error("provide --dim-geo-json or --database-url")

    rows = parse_annex(args.pdf)
    geo = load_dim_geo(args)
    results, by_code = match(rows, geo)

    # Build geo_code -> mapping; detect collisions.
    out_rows, collisions, unresolved, unclassified = [], [], [], []
    seen = {}
    for r, codes, new_c, method, score in results:
        if not codes:
            unresolved.append((r, method, score)); continue
        if new_c is None:
            unclassified.append(r)  # matched geographically but source gives no numeric class
        for code in codes:
            g = by_code.get(code)
            if code in seen and new_c is not None:
                collisions.append((code, seen[code], (r['blob'], r['name'])))
            seen[code] = (r['blob'], r['name'])
            out_rows.append(dict(
                geo_code=code, geo_level=g['geo_level'] if g else '?',
                dof_kind=r['kind'], dof_region=dof_region(r['blob']) or '',
                dof_name=r['name'], old_class_dof=r['old_class'] if isinstance(r['old_class'], int) else '',
                new_class=new_c if new_c is not None else '', converted=int(r['converted']),
                method=method, score=score))

    out_rows.sort(key=lambda d: d['geo_code'])
    with open(args.out, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['geo_code', 'geo_level', 'dof_kind', 'dof_region',
                                          'dof_name', 'old_class_dof', 'new_class', 'converted',
                                          'method', 'score'])
        w.writeheader(); w.writerows(out_rows)

    # ---- reconciliation report to stderr ----
    cms_all = [g for g in geo if g['geo_level'] == 'citymun']
    prov_all = [g for g in geo if g['geo_level'] == 'province']
    covered = {d['geo_code'] for d in out_rows if d['new_class'] != ''}
    from collections import Counter
    log = sys.stderr.write
    log(f"\n=== E4.3 income reclassification — reconciliation ===\n")
    log(f"DOF Annex A rows parsed         : {len(rows)} "
        f"(prov {sum(r['kind']=='province' for r in rows)}, "
        f"city {sum(r['kind']=='city' for r in rows)}, "
        f"muni {sum(r['kind']=='municipality' for r in rows)})\n")
    log(f"Mapping rows emitted            : {len(out_rows)} (incl. Manila district fan-out)\n")
    log(f"  via fuzzy auto-match          : {sum(d['method']=='fuzzy' for d in out_rows)}\n")
    log(f"  via province match            : {sum(d['method']=='province' for d in out_rows)}\n")
    log(f"  via verified override         : {sum(d['method']=='override' for d in out_rows)}\n")
    log(f"citymun with new class          : {len(covered & {g['geo_code'] for g in cms_all})} / {len(cms_all)}\n")
    log(f"province with new class         : {len(covered & {g['geo_code'] for g in prov_all})} / 82 classifiable\n")
    log(f"DOF rows with NO PSGC match     : {len(unresolved)}\n")
    for r, method, score in unresolved:
        log(f"    UNRESOLVED  [{r['kind']}] {r['blob']!r} / {r['name']!r} (best score {score})\n")
    log(f"DOF rows unclassified in source : {len(unclassified)} (kept prior class)\n")
    for r in unclassified:
        log(f"    UNCLASSIFIED [{r['kind']}] {r['blob']!r} / {r['name']!r} "
            f"(old={r['old_class']}, new={'New' if r['new_class']=='New' else 'dash'})\n")
    log(f"collisions (2 DOF rows -> 1 code): {len(collisions)}\n")
    for c in collisions:
        log(f"    COLLISION {c}\n")
    dim_cms_no_class = [g for g in cms_all if g['geo_code'] not in covered]
    log(f"dim_geo citymun with NO new class: {len(dim_cms_no_class)}\n")
    for g in dim_cms_no_class[:40]:
        log(f"    NO-CLASS  {g['geo_code']} {g['geo_name']} / {g['province_name']}\n")
    newdist = Counter(d['new_class'] for d in out_rows if d['geo_level'] == 'citymun' and d['new_class'] != '')
    log(f"new citymun class distribution  : {dict(sorted(newdist.items()))}\n")
    log(f"wrote {args.out}\n")


if __name__ == '__main__':
    main()
