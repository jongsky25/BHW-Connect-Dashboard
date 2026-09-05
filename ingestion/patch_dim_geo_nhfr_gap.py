#!/usr/bin/env python3
"""Add dim_geo rows for places NHFR knows about that dim_geo does not (plan N1).

Same shape of problem, and same fix, as `ingestion/patch_dim_geo_stepzero_gap.py`.

**Why the gap exists.** dim_geo is built purely from the bhw-2025 parquet (`build_dim_geo()` in
`ingest.py`), so it contains exactly the places that have at least one individually-profiled BHW —
not the full PSGC universe. A city or barangay with a health facility but no profiled BHW has no
dim_geo row, and `fact_nhfr_facility.geo_code` is NOT NULL against `dim_geo`, so loading NHFR
without this patch aborts rather than silently dropping those facilities. That abort is by design;
this script is the fix for it.

**Known before running: four districts of the City of Manila.** dim_geo holds 10 of Manila's 14
districts. BINONDO (1380602), SAN MIGUEL (1380607), ERMITA (1380608) and INTRAMUROS (1380609) are
absent — between them 127 facilities, including Ermita's 95, which is where a large share of
Manila's private clinics and laboratories sit. They are real districts with real facilities and no
profiled BHWs, exactly like the 12 citymuns the StepZero patch added.

**The barangay gap is computed here, not asserted.** How many barangays NHFR knows and dim_geo
does not depends on the live dim_geo (the StepZero patch already added 2,682), so this script
diffs against the database rather than carrying a number that could go stale. Run it and read the
report.

**What it will not do.** A place whose *province* is missing from dim_geo is reported and skipped
rather than invented — a province row is a bigger claim than a leaf row, and a missing one means
something is wrong upstream that a loader should not paper over. Same for a barangay whose
city/municipality could not be resolved or created.

New rows are tagged `psgc_vintage = 'nhfr_only_v1: …'` so the gap stays visible in the data
itself, not only in this script and the docs — the discipline the StepZero patch set.

Two modes, matching the other loaders:

  python ingestion/patch_dim_geo_nhfr_gap.py --database-url "$DATABASE_URL"
  python ingestion/patch_dim_geo_nhfr_gap.py --database-url "$DATABASE_URL" --dry-run
  python ingestion/patch_dim_geo_nhfr_gap.py --emit-sql-dir ingestion/_sql_patch_nhfr_gap \
      --database-url "$DATABASE_URL"

`--database-url` is required even for `--emit-sql-dir`: the gap is defined against the live
dim_geo, so there is nothing to emit without reading it first.

Writes a QA report to ingestion/_qa_report_patch_nhfr_gap.json.
"""

import argparse
import csv
import json
from pathlib import Path

from ingest import sql_literal

SRC_DEFAULT = "ingestion/data/nhfr_2026_09_cleaned.csv"
QA_DEFAULT = "ingestion/_qa_report_patch_nhfr_gap.json"

VINTAGE = "nhfr_only_v1: on the NHFR September 2026 registry, no bhw-2025 profile rows"

# Sulu's codes resolve through dim_psgc_crosswalk rather than directly; see ingest_nhfr.py.
SOURCE_VINTAGE = "post-2024 Sulu transfer (Sulu under Region IX)"

DIM_GEO_COLUMNS = [
    "geo_code",
    "geo_level",
    "geo_name",
    "parent_code",
    "region_code",
    "province_code",
    "citymun_code",
    "income_class",
    "psgc_vintage",
]


def read_places(src: str) -> tuple[dict, dict]:
    """The distinct city/municipalities and barangays NHFR carries, with their source names.

    Keyed on the code as the *source* prints it — resolution to dim_geo's vintage happens in SQL,
    so a Sulu code stays '09066…' here and is only mapped when it is looked up.
    """
    citymuns: dict[str, dict] = {}
    barangays: dict[str, dict] = {}
    with open(src, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            cm = row["citymun_code"]
            if cm and cm not in citymuns:
                citymuns[cm] = {
                    "code": cm,
                    "name": row["source_citymun_name"],
                    "province_code": cm[:5],
                    "region_code": cm[:2],
                }
            brgy = row["barangay_code"]
            if brgy and brgy not in barangays:
                barangays[brgy] = {
                    "code": brgy,
                    "name": row["source_barangay_name"],
                    "citymun_code": cm,
                    "province_code": cm[:5],
                    "region_code": cm[:2],
                }
    return citymuns, barangays


def resolve_many(cur, codes: list[str]) -> dict[str, str | None]:
    """code -> resolved dim_geo code (or None), through map_psgc_to_dim_geo so the Sulu crosswalk
    applies. Done in one round trip via unnest rather than a query per code."""
    if not codes:
        return {}
    cur.execute(
        "select c, map_psgc_to_dim_geo(c, %s) from unnest(%s::text[]) as c",
        (SOURCE_VINTAGE, codes),
    )
    return {code: resolved for code, resolved in cur.fetchall()}


def existing_provinces(cur) -> set[str]:
    cur.execute("select geo_code from dim_geo where geo_level = 'province'")
    return {row[0] for row in cur.fetchall()}


def build_rows(cur, citymuns: dict, barangays: dict) -> tuple[list[dict], dict]:
    """The dim_geo rows to add, plus the report of what was skipped and why."""
    provinces = existing_provinces(cur)

    cm_resolved = resolve_many(cur, sorted(citymuns))
    missing_citymuns = [citymuns[c] for c, r in cm_resolved.items() if r is None]

    rows: list[dict] = []
    skipped_no_province: list[str] = []
    added_citymun_codes: set[str] = set()

    for cm in sorted(missing_citymuns, key=lambda c: c["code"]):
        if cm["province_code"] not in provinces:
            skipped_no_province.append(f"{cm['code']} {cm['name']} (province {cm['province_code']})")
            continue
        rows.append(
            {
                "geo_code": cm["code"],
                "geo_level": "citymun",
                "geo_name": cm["name"],
                "parent_code": cm["province_code"],
                "region_code": cm["region_code"],
                "province_code": cm["province_code"],
                "citymun_code": cm["code"],
                "income_class": None,
                "psgc_vintage": VINTAGE,
            }
        )
        added_citymun_codes.add(cm["code"])

    brgy_resolved = resolve_many(cur, sorted(barangays))
    missing_barangays = [barangays[c] for c, r in brgy_resolved.items() if r is None]

    skipped_no_citymun: list[str] = []
    for brgy in sorted(missing_barangays, key=lambda b: b["code"]):
        parent = brgy["citymun_code"]
        # The parent must either already be in dim_geo or be one this run is adding. A barangay
        # whose city/municipality is neither is skipped rather than orphaned.
        if cm_resolved.get(parent) is None and parent not in added_citymun_codes:
            skipped_no_citymun.append(f"{brgy['code']} {brgy['name']} (citymun {parent})")
            continue
        resolved_parent = cm_resolved.get(parent) or parent
        rows.append(
            {
                "geo_code": brgy["code"],
                "geo_level": "barangay",
                "geo_name": brgy["name"],
                "parent_code": resolved_parent,
                "region_code": resolved_parent[:2],
                "province_code": resolved_parent[:5],
                "citymun_code": resolved_parent,
                "income_class": None,
                "psgc_vintage": VINTAGE,
            }
        )

    report = {
        "source_file": SRC_DEFAULT,
        "nhfr_distinct_citymuns": len(citymuns),
        "nhfr_distinct_barangays": len(barangays),
        "citymuns_missing_from_dim_geo": len(missing_citymuns),
        "barangays_missing_from_dim_geo": len(missing_barangays),
        "citymun_rows_added": sum(1 for r in rows if r["geo_level"] == "citymun"),
        "barangay_rows_added": sum(1 for r in rows if r["geo_level"] == "barangay"),
        "skipped_citymuns_without_a_province": skipped_no_province,
        "skipped_barangays_without_a_citymun": skipped_no_citymun,
        "added_citymuns": sorted(
            f"{r['geo_code']} {r['geo_name']}" for r in rows if r["geo_level"] == "citymun"
        ),
    }
    return rows, report


def insert_sql(rows: list[dict]) -> str:
    values = ",\n".join(
        "("
        + ", ".join(
            sql_literal(row[c]) if c != "income_class" else "NULL" for c in DIM_GEO_COLUMNS
        )
        + ")"
        for row in rows
    )
    return (
        "-- Generated by ingestion/patch_dim_geo_nhfr_gap.py — re-run it to regenerate.\n"
        "-- dim_geo rows for places on the NHFR September 2026 registry that bhw-2025's individual\n"
        "-- profiling had not reached, so dim_geo had no row for them. Tagged 'nhfr_only_v1' so the\n"
        "-- gap stays visible in the data. income_class is NULL: NHFR does not carry it.\n"
        f"INSERT INTO dim_geo ({', '.join(DIM_GEO_COLUMNS)}) VALUES\n{values}\n"
        "ON CONFLICT (geo_code) DO NOTHING;\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", default=SRC_DEFAULT)
    parser.add_argument("--database-url", required=True, help="Needed to read the live dim_geo")
    parser.add_argument("--emit-sql-dir", help="Write the patch SQL here instead of applying it")
    parser.add_argument("--dry-run", action="store_true", help="Report the gap, change nothing")
    parser.add_argument("--qa-report", default=QA_DEFAULT)
    args = parser.parse_args()

    import psycopg2

    citymuns, barangays = read_places(args.src)
    conn = psycopg2.connect(args.database_url)
    try:
        with conn.cursor() as cur:
            rows, report = build_rows(cur, citymuns, barangays)

            print(f"NHFR carries {report['nhfr_distinct_citymuns']:,} city/municipalities and "
                  f"{report['nhfr_distinct_barangays']:,} barangays.")
            print(f"  missing from dim_geo: {report['citymuns_missing_from_dim_geo']} "
                  f"city/municipalities, {report['barangays_missing_from_dim_geo']:,} barangays")
            print(f"  rows this patch adds: {report['citymun_rows_added']} + "
                  f"{report['barangay_rows_added']:,}")
            for cm in report["added_citymuns"]:
                print(f"    citymun {cm}")
            for line in report["skipped_citymuns_without_a_province"]:
                print(f"    SKIPPED (no province in dim_geo): {line}")
            for line in report["skipped_barangays_without_a_citymun"]:
                print(f"    SKIPPED (no city/municipality): {line}")

            Path(args.qa_report).write_text(json.dumps(report, indent=2), encoding="utf-8")
            print(f"\nQA report written to {args.qa_report}")

            if not rows:
                print("Nothing to patch — dim_geo already covers every place NHFR knows about.")
                return

            if args.emit_sql_dir:
                out = Path(args.emit_sql_dir)
                out.mkdir(parents=True, exist_ok=True)
                path = out / "patch_dim_geo_nhfr_gap.sql"
                path.write_text(insert_sql(rows), encoding="utf-8")
                print(f"Wrote {path} ({len(rows):,} rows)")
                return

            if args.dry_run:
                print("Dry run — no rows written.")
                return

            cur.execute(insert_sql(rows))
        conn.commit()
        print(f"Committed {len(rows):,} dim_geo rows.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
