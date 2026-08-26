#!/usr/bin/env python3
"""Cleaned CSV -> seed SQL generator for the UUC for PHC 2025 dataset (plan U1).

Reads ingestion/data/uuc_phc_2025_cleaned.csv — the machine-readable extract written by
ingestion/clean_uuc_phc_indicators.py from the source office's reconciled workbook — and emits
an idempotent seed migration for fact_uuc_phc_barangay.

Scope is the classification only: the 5,991 barangays ON the 2025 list. The workbook's 9,395
'NOT UUA' rows are not loaded (owner decision), so no decision column is written; presence in
the table is membership. The 12 cleaned indicators stay out until U3, which needs a display
rule for capped values first.

Geography. The PSGC codes come from the workbook and are joined to dim_geo IN SQL, via
map_psgc_to_dim_geo(), rather than being remapped here. 87 of the 5,991 are Sulu's '09066…'
codes, which exist in dim_geo only as '19066…'; the crosswalk rows that resolve them are
seeded by 20260826120200_crosswalk_sulu_region_ix.sql. Doing the resolution in SQL means a
missing crosswalk row fails the insert on fact_uuc_phc_barangay.geo_code's NOT NULL rather
than silently dropping barangays, and keeps the remap in one place instead of two.

This mirrors ingestion/ingest_encoding_status.py: generate a migration offline, review the
diff, apply it like any other.

Usage:

  python ingestion/ingest_uuc_phc.py \
      --src ingestion/data/uuc_phc_2025_cleaned.csv \
      --out supabase/migrations/20260826120300_seed_fact_uuc_phc_barangay.sql

Regenerate the source extract first if the reconciled workbook changes:

  python ingestion/clean_uuc_phc_indicators.py
"""

import argparse
import csv
from collections import Counter
from pathlib import Path

DATASET_SLUG = "uuc-phc-2025"
TABLE = "fact_uuc_phc_barangay"

# The vintage the workbook's codes belong to; must match the crosswalk migration's old_vintage.
SOURCE_VINTAGE = "post-2024 Sulu transfer (Sulu under Region IX)"

EXPECTED_ROWS = 5991
SULU_SOURCE_PREFIX = "09066"
EXPECTED_SULU = 87

# Regional counts as the workbook itself reports them. Locked in as a regression check: these
# reproduce the workbook's own embedded TOTAL rows and match the 2027 Budget Cue Cards p37
# table at 15 of 17 regions (BARMM 399 vs p37's 400, CALABARZON 200 vs p37's 195 — the
# workbook is published, p37 footnoted; docs/UUC_PHC_2025_PLAN.md §3).
EXPECTED_REGION_COUNTS = {
    "REGION V (BICOL REGION)": 757,
    "CORDILLERA ADMINISTRATIVE REGION (CAR)": 609,
    "REGION IX (ZAMBOANGA PENINSULA)": 523,
    "MIMAROPA REGION": 458,
    "REGION X (NORTHERN MINDANAO)": 440,
    "REGION XI (DAVAO REGION)": 437,
    "BANGSAMORO AUTONOMOUS REGION IN MUSLIM MINDANAO (BARMM)": 399,
    "REGION VI (WESTERN VISAYAS)": 397,
    "REGION VIII (EASTERN VISAYAS)": 358,
    "REGION XII (SOCCSKSARGEN)": 304,
    "REGION XIII (CARAGA)": 268,
    "REGION I (ILOCOS REGION)": 262,
    "REGION II (CAGAYAN VALLEY)": 227,
    "REGION IV-A (CALABARZON)": 200,
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
    dashboard publishes 5,991 as a headline figure, so a silently short load is worse than a
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
        f"{n_sulu} Sulu codes to resolve via the crosswalk."
    )


def emit_sql(rows: list[dict]) -> str:
    header = (
        "-- Seed fact_uuc_phc_barangay with the 2025 UUC for PHC list (plan U1).\n"
        "--\n"
        "-- Generated by ingestion/ingest_uuc_phc.py from ingestion/data/uuc_phc_2025_cleaned.csv,\n"
        "-- which ingestion/clean_uuc_phc_indicators.py writes from the source office's reconciled\n"
        "-- workbook. Do not hand-edit: regenerate both.\n"
        "--\n"
        "-- 5,991 rows, one per listed barangay. geo_code is resolved through\n"
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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--src",
        default="ingestion/data/uuc_phc_2025_cleaned.csv",
        help="Cleaned extract from clean_uuc_phc_indicators.py",
    )
    parser.add_argument("--out", required=True, help="Path to write the seed .sql migration")
    args = parser.parse_args()

    rows = load_rows(Path(args.src))
    check(rows)
    Path(args.out).write_text(emit_sql(rows))
    print(f"Wrote {args.out}: {len(rows):,} barangay rows")


if __name__ == "__main__":
    main()
