"""Load the NHFR September 2026 snapshot into fact_nhfr_facility (plan N1).

Reads the committed extract `ingestion/data/nhfr_2026_09_cleaned.csv` produced by
`ingestion/clean_nhfr.py`. This script never opens the source workbook — it trusts the checked
extract and nothing else, mirroring `ingestion/ingest_uuc_phc.py`.

Two run modes, following `ingestion/ingest_stepzero.py`:

    # live load, one transaction, writes an ingestion_batches row with the QA report
    python ingestion/ingest_nhfr.py --database-url "$SUPABASE_DB_URL"

    # offline: batched .sql files to review and apply by hand
    python ingestion/ingest_nhfr.py --emit-sql-dir /tmp/nhfr_sql

**No committed seed migration.** `ingest_uuc_phc.py` emits one because 5,987 rows fit inside a
migration file; 44,799 do not (~10 MB of SQL). The reproducible committed artefact for this
dataset is the cleaned CSV, and re-running this loader is the refresh procedure.

**geo_code is resolved in SQL, not here.** Every row's city/municipality and barangay codes go
through `map_psgc_to_dim_geo()`, so an unresolvable code fails the insert on `geo_code`'s NOT NULL
instead of silently dropping a facility, and the Sulu vintage remap lives in one place
(`dim_psgc_crosswalk`) rather than being re-implemented in Python.

Sulu is the one geography that needs the crosswalk. The export is internally inconsistent about
it: all 177 Sulu facilities are *named* under Region IX, but 152 carry BARMM-vintage '19066…'
codes and 25 carry Region IX '09066…' codes. The 152 hit dim_geo directly; the 25 resolve through
the rows `20260826121200_crosswalk_sulu_region_ix.sql` already seeded. Both land on dim_geo's
BARMM placement, so the rollups file Sulu under BARMM — which is what honouring the code, rather
than the source's region name, means here.
"""

import argparse
import csv
import json
from pathlib import Path

from ingest import batched, sql_literal

SRC_DEFAULT = "ingestion/data/nhfr_2026_09_cleaned.csv"
DATASET_SLUG = "nhfr-2026-09"
TABLE = "fact_nhfr_facility"
BATCH_SIZE = 2000

# The vintage the source's Sulu codes are on. Matches the old_vintage that
# 20260826121200_crosswalk_sulu_region_ix.sql seeded, which is what makes the 25 '09066…' codes
# resolvable. Codes already on dim_geo's vintage never reach the crosswalk branch at all —
# map_psgc_to_dim_geo() tries a direct hit first.
SOURCE_VINTAGE = "post-2024 Sulu transfer (Sulu under Region IX)"

# Every one of these is load-blocking. The dashboard publishes 44,799 as a headline figure and
# "X of this area's barangays have a facility" as a derived one, so a silently short load is worse
# than a failed one — the same discipline as ingest_uuc_phc.py's check().
EXPECTED_ROWS = 44799
EXPECTED_NO_BARANGAY = 108
EXPECTED_DISTINCT_CITYMUN = 1673
# Distinct barangay *codes as the source prints them*. Not the same as the number of barangays
# that end up with a facility: 21 Sulu barangays are listed under both code vintages and resolve
# to one dim_geo barangay each, so the loaded figure is 28,490.
EXPECTED_DISTINCT_BARANGAY = 28511

EXPECTED_REGION_COUNTS = {
    "REGION IV-A (CALABARZON)": 5490,
    "REGION III (CENTRAL LUZON)": 4784,
    "REGION V (BICOL REGION)": 3405,
    "NATIONAL CAPITAL REGION (NCR)": 3237,
    "REGION I (ILOCOS REGION)": 3114,
    "REGION VII (CENTRAL VISAYAS)": 2992,
    "REGION II (CAGAYAN VALLEY)": 2603,
    "REGION VI (WESTERN VISAYAS)": 2347,
    "REGION X (NORTHERN MINDANAO)": 2169,
    "REGION XI (DAVAO REGION)": 2055,
    "NEGROS ISLAND REGION (NIR)": 1825,
    "REGION IX (ZAMBOANGA PENINSULA)": 1700,
    "REGION XII (SOCCSKSARGEN)": 1696,
    "REGION VIII (EASTERN VISAYAS)": 1654,
    "MIMAROPA REGION": 1591,
    "REGION XIII (CARAGA)": 1586,
    "CORDILLERA ADMINISTRATIVE REGION (CAR)": 1401,
    "BANGSAMORO AUTONOMOUS REGION IN MUSLIM MINDANAO (BARMM)": 1150,
}

EXPECTED_OWNERSHIP = {"Government": 33524, "Private": 11275}

EXPECTED_LICENSING = {"With License": 15441, "Without License": 1111, "": 28247}

# The four the section renders as headline figures. Checked so a re-export that reshapes the type
# vocabulary fails here rather than quietly changing a published number.
EXPECTED_TYPE_SAMPLE = {
    "Barangay Health Station": 27186,
    "Clinical Laboratory": 4349,
    "Birthing Home": 3565,
    "Rural Health Unit": 2745,
    "Hospital": 1358,
}

# Sulu's split-vintage rows, by the prefix of the code the source printed.
EXPECTED_SULU = {"19066": 152, "09066": 25}

CSV_COLUMNS = [
    "facility_code",
    "facility_code_short",
    "facility_name",
    "facility_major_type",
    "facility_type",
    "ownership_major",
    "ownership_sub",
    "source_region_psgc",
    "source_region_name",
    "source_province_psgc",
    "source_province_name",
    "source_citymun_psgc",
    "source_citymun_name",
    "source_barangay_psgc",
    "source_barangay_name",
    "citymun_code",
    "barangay_code",
    "service_capability",
    "bed_capacity",
    "licensing_status",
    "license_validity_date",
]

# Columns written to the table, in order. citymun_code / barangay_code are not among them: they
# are the *inputs* to map_psgc_to_dim_geo(), and what lands is the resolved geo_code /
# barangay_geo_code.
INSERT_COLUMNS = [
    "dataset_id",
    "facility_code",
    "facility_code_short",
    "facility_name",
    "facility_major_type",
    "facility_type",
    "ownership_major",
    "ownership_sub",
    "geo_code",
    "barangay_geo_code",
    "source_region_psgc",
    "source_region_name",
    "source_province_psgc",
    "source_province_name",
    "source_citymun_psgc",
    "source_citymun_name",
    "source_barangay_psgc",
    "source_barangay_name",
    "service_capability",
    "bed_capacity",
    "licensing_status",
    "license_validity_date",
]


def read_rows(src: str) -> list[dict]:
    with open(src, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames != CSV_COLUMNS:
            raise SystemExit(
                f"{src}: unexpected columns.\n  expected {CSV_COLUMNS}\n  found    "
                f"{reader.fieldnames}\nRe-run ingestion/clean_nhfr.py."
            )
        return list(reader)


def tally(rows: list[dict], key: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        counts[row[key]] = counts.get(row[key], 0) + 1
    return counts


def check(rows: list[dict]) -> list[str]:
    """Every failure here aborts the load. Returns the problem list rather than raising so the
    caller can print all of them at once — a load that fails six checks should say so six times,
    not make the operator re-run to discover the next one."""
    problems: list[str] = []

    if len(rows) != EXPECTED_ROWS:
        problems.append(f"row count is {len(rows):,}, expected {EXPECTED_ROWS:,}")

    codes = tally(rows, "facility_code")
    duplicates = {c: n for c, n in codes.items() if n > 1}
    if duplicates:
        problems.append(f"{len(duplicates)} duplicate facility codes, e.g. {list(duplicates)[:5]}")

    missing_citymun = [r["facility_code"] for r in rows if len(r["citymun_code"]) != 7]
    if missing_citymun:
        problems.append(
            f"{len(missing_citymun)} rows without a 7-digit city/municipality code, e.g. "
            f"{missing_citymun[:5]} — every facility must have a rollup path"
        )

    bad_barangay = [
        r["facility_code"] for r in rows if r["barangay_code"] and len(r["barangay_code"]) != 10
    ]
    if bad_barangay:
        problems.append(
            f"{len(bad_barangay)} rows with a barangay code that is not 10 digits, e.g. "
            f"{bad_barangay[:5]}"
        )

    outside = [
        r["facility_code"]
        for r in rows
        if r["barangay_code"] and r["barangay_code"][:7] != r["citymun_code"]
    ]
    if outside:
        problems.append(
            f"{len(outside)} barangay codes outside their own city/municipality, e.g. "
            f"{outside[:5]}"
        )

    no_barangay = sum(1 for r in rows if not r["barangay_code"])
    if no_barangay != EXPECTED_NO_BARANGAY:
        problems.append(
            f"{no_barangay} rows without a barangay code, expected {EXPECTED_NO_BARANGAY}"
        )

    distinct_citymun = len({r["citymun_code"] for r in rows})
    if distinct_citymun != EXPECTED_DISTINCT_CITYMUN:
        problems.append(
            f"{distinct_citymun:,} distinct city/municipalities, expected "
            f"{EXPECTED_DISTINCT_CITYMUN:,}"
        )

    distinct_barangay = len({r["barangay_code"] for r in rows if r["barangay_code"]})
    if distinct_barangay != EXPECTED_DISTINCT_BARANGAY:
        problems.append(
            f"{distinct_barangay:,} distinct barangays, expected {EXPECTED_DISTINCT_BARANGAY:,}"
        )

    regions = tally(rows, "source_region_name")
    for name, expected in EXPECTED_REGION_COUNTS.items():
        found = regions.get(name, 0)
        if found != expected:
            problems.append(f"region {name}: {found:,} facilities, expected {expected:,}")
    unexpected_regions = set(regions) - set(EXPECTED_REGION_COUNTS)
    if unexpected_regions:
        problems.append(f"unexpected region names: {sorted(unexpected_regions)}")

    ownership = tally(rows, "ownership_major")
    for name, expected in EXPECTED_OWNERSHIP.items():
        if ownership.get(name, 0) != expected:
            problems.append(
                f"ownership {name}: {ownership.get(name, 0):,}, expected {expected:,}"
            )

    licensing = tally(rows, "licensing_status")
    for name, expected in EXPECTED_LICENSING.items():
        if licensing.get(name, 0) != expected:
            label = name or "(not stated)"
            problems.append(
                f"licensing {label}: {licensing.get(name, 0):,}, expected {expected:,}"
            )

    types = tally(rows, "facility_type")
    for name, expected in EXPECTED_TYPE_SAMPLE.items():
        if types.get(name, 0) != expected:
            problems.append(
                f"facility type {name}: {types.get(name, 0):,}, expected {expected:,}"
            )

    sulu = {"19066": 0, "09066": 0}
    for row in rows:
        prefix = row["citymun_code"][:5]
        if prefix in sulu:
            sulu[prefix] += 1
    if sulu != EXPECTED_SULU:
        problems.append(
            f"Sulu code split is {sulu}, expected {EXPECTED_SULU} — the crosswalk assumption in "
            "20260826121200_crosswalk_sulu_region_ix.sql may no longer hold"
        )

    return problems


def value_tuple(row: dict) -> str:
    """One VALUES tuple for the src CTE, in CSV_COLUMNS order minus the columns SQL derives."""
    return (
        "("
        + ", ".join(
            [
                sql_literal(row["facility_code"]),
                sql_literal(row["facility_code_short"] or None),
                sql_literal(row["facility_name"]),
                sql_literal(row["facility_major_type"]),
                sql_literal(row["facility_type"]),
                sql_literal(row["ownership_major"]),
                sql_literal(row["ownership_sub"] or None),
                sql_literal(row["citymun_code"]),
                sql_literal(row["barangay_code"] or None),
                sql_literal(row["source_region_psgc"] or None),
                sql_literal(row["source_region_name"] or None),
                sql_literal(row["source_province_psgc"] or None),
                sql_literal(row["source_province_name"] or None),
                sql_literal(row["source_citymun_psgc"] or None),
                sql_literal(row["source_citymun_name"] or None),
                sql_literal(row["source_barangay_psgc"] or None),
                sql_literal(row["source_barangay_name"] or None),
                sql_literal(row["service_capability"] or None),
                str(int(row["bed_capacity"])),
                sql_literal(row["licensing_status"] or None),
                sql_literal(row["license_validity_date"] or None),
            ]
        )
        + ")"
    )


def insert_sql(rows: list[dict]) -> str:
    """One idempotent INSERT for a batch, resolving both geo columns in SQL."""
    values = ",\n  ".join(value_tuple(r) for r in rows)
    return f"""with ds as (
  select dataset_id from dim_dataset where slug = {sql_literal(DATASET_SLUG)}
),
src (
  facility_code, facility_code_short, facility_name, facility_major_type, facility_type,
  ownership_major, ownership_sub, citymun_code, barangay_code,
  source_region_psgc, source_region_name, source_province_psgc, source_province_name,
  source_citymun_psgc, source_citymun_name, source_barangay_psgc, source_barangay_name,
  service_capability, bed_capacity, licensing_status, license_validity_date
) as (values
  {values}
)
insert into {TABLE} (
  {", ".join(INSERT_COLUMNS)}
)
select
  (select dataset_id from ds),
  src.facility_code,
  src.facility_code_short,
  src.facility_name,
  src.facility_major_type,
  src.facility_type,
  src.ownership_major,
  src.ownership_sub,
  -- Resolved, not written literally: a code that neither dim_geo nor dim_psgc_crosswalk knows
  -- returns NULL and fails geo_code's NOT NULL, aborting the load instead of dropping a facility.
  map_psgc_to_dim_geo(src.citymun_code, {sql_literal(SOURCE_VINTAGE)}),
  case
    when src.barangay_code is null then null
    else map_psgc_to_dim_geo(src.barangay_code, {sql_literal(SOURCE_VINTAGE)})
  end,
  src.source_region_psgc,
  src.source_region_name,
  src.source_province_psgc,
  src.source_province_name,
  src.source_citymun_psgc,
  src.source_citymun_name,
  src.source_barangay_psgc,
  src.source_barangay_name,
  src.service_capability,
  src.bed_capacity::integer,
  src.licensing_status,
  src.license_validity_date::date
from src
on conflict (dataset_id, facility_code) do update set
  facility_code_short = excluded.facility_code_short,
  facility_name = excluded.facility_name,
  facility_major_type = excluded.facility_major_type,
  facility_type = excluded.facility_type,
  ownership_major = excluded.ownership_major,
  ownership_sub = excluded.ownership_sub,
  geo_code = excluded.geo_code,
  barangay_geo_code = excluded.barangay_geo_code,
  source_region_psgc = excluded.source_region_psgc,
  source_region_name = excluded.source_region_name,
  source_province_psgc = excluded.source_province_psgc,
  source_province_name = excluded.source_province_name,
  source_citymun_psgc = excluded.source_citymun_psgc,
  source_citymun_name = excluded.source_citymun_name,
  source_barangay_psgc = excluded.source_barangay_psgc,
  source_barangay_name = excluded.source_barangay_name,
  service_capability = excluded.service_capability,
  bed_capacity = excluded.bed_capacity,
  licensing_status = excluded.licensing_status,
  license_validity_date = excluded.license_validity_date;
"""


def qa_report(rows: list[dict]) -> dict:
    return {
        "dataset_slug": DATASET_SLUG,
        "source_file": SRC_DEFAULT,
        "rows": len(rows),
        "distinct_facility_codes": len({r["facility_code"] for r in rows}),
        "distinct_citymun": len({r["citymun_code"] for r in rows}),
        "distinct_barangay": len({r["barangay_code"] for r in rows if r["barangay_code"]}),
        "rows_without_barangay": sum(1 for r in rows if not r["barangay_code"]),
        "by_region": tally(rows, "source_region_name"),
        "by_ownership": tally(rows, "ownership_major"),
        "by_licensing": tally(rows, "licensing_status"),
        "by_facility_type": tally(rows, "facility_type"),
    }


def emit_sql_files(rows: list[dict], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for i, batch in enumerate(batched(rows, BATCH_SIZE)):
        path = out_dir / f"{TABLE}_{i:03d}.sql"
        path.write_text(insert_sql(batch), encoding="utf-8")
        print(f"  wrote {path} ({len(batch):,} rows)")


def run_live(database_url: str, rows: list[dict], report: dict) -> None:
    import psycopg2

    conn = psycopg2.connect(database_url)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select dataset_id from dim_dataset where slug = %s",
                (DATASET_SLUG,),
            )
            found = cur.fetchone()
            if not found:
                raise SystemExit(
                    f"dim_dataset has no row for slug {DATASET_SLUG!r} — apply "
                    "supabase/migrations/20260905090100_seed_dim_dataset_nhfr.sql first."
                )

            # Pre-flight: every geo code must resolve before a single row is written. Without
            # this the load runs for 23 batches and then dies on a NOT NULL violation naming one
            # facility, which says nothing about the shape of the problem. dim_geo is built from
            # the bhw-2025 parquet alone, so a city or barangay with facilities but no profiled
            # BHW simply has no row — see ingestion/patch_dim_geo_nhfr_gap.py.
            citymun_codes = sorted({r["citymun_code"] for r in rows})
            barangay_codes = sorted({r["barangay_code"] for r in rows if r["barangay_code"]})
            cur.execute(
                "select count(*) from unnest(%s::text[]) as c "
                "where map_psgc_to_dim_geo(c, %s) is null",
                (citymun_codes, SOURCE_VINTAGE),
            )
            unresolved_citymun = cur.fetchone()[0]
            cur.execute(
                "select count(*) from unnest(%s::text[]) as c "
                "where map_psgc_to_dim_geo(c, %s) is null",
                (barangay_codes, SOURCE_VINTAGE),
            )
            unresolved_barangay = cur.fetchone()[0]
            if unresolved_citymun or unresolved_barangay:
                raise SystemExit(
                    f"{unresolved_citymun} of {len(citymun_codes):,} city/municipality codes and "
                    f"{unresolved_barangay:,} of {len(barangay_codes):,} barangay codes do not "
                    "resolve against dim_geo.\n"
                    "Run the gap patch first, then re-run this loader:\n"
                    '  python ingestion/patch_dim_geo_nhfr_gap.py --database-url "$DATABASE_URL"'
                )

            cur.execute(
                "insert into ingestion_batches (source_file, row_counts) values (%s, %s) "
                "returning batch_id",
                (SRC_DEFAULT, json.dumps({TABLE: len(rows)})),
            )
            batch_id = cur.fetchone()[0]

            for i, batch in enumerate(batched(rows, BATCH_SIZE)):
                cur.execute(insert_sql(batch))
                print(f"  batch {i:03d}: {len(batch):,} rows")

            # The load-time truth check. The Python checks above verify the extract; this verifies
            # what actually landed, including the geo resolution SQL did.
            cur.execute(
                f"select count(*), count(distinct facility_code), "
                f"count(*) filter (where barangay_geo_code is null) from {TABLE} "
                f"where dataset_id = (select dataset_id from dim_dataset where slug = %s)",
                (DATASET_SLUG,),
            )
            loaded, distinct_codes, null_barangay = cur.fetchone()
            if loaded != EXPECTED_ROWS or distinct_codes != EXPECTED_ROWS:
                raise SystemExit(
                    f"loaded {loaded:,} rows ({distinct_codes:,} distinct codes), expected "
                    f"{EXPECTED_ROWS:,} — rolling back"
                )
            if null_barangay != EXPECTED_NO_BARANGAY:
                raise SystemExit(
                    f"{null_barangay} rows have no barangay_geo_code, expected "
                    f"{EXPECTED_NO_BARANGAY} — rolling back"
                )

            report["loaded_rows"] = loaded
            report["rows_without_barangay_geo_code"] = null_barangay
            cur.execute(
                "update ingestion_batches set finished_at = now(), qa_report = %s "
                "where batch_id = %s",
                (json.dumps(report), batch_id),
            )
        conn.commit()
        print(f"\nCommitted. ingestion_batches.batch_id = {batch_id}")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", default=SRC_DEFAULT, help="Path to the cleaned CSV")
    parser.add_argument("--database-url", help="Load live into this Postgres URL")
    parser.add_argument("--emit-sql-dir", help="Write batched .sql files here instead of loading")
    parser.add_argument(
        "--qa-report",
        default="ingestion/_qa_report_nhfr.json",
        help="Where to write the QA report JSON",
    )
    args = parser.parse_args()

    if not args.database_url and not args.emit_sql_dir:
        parser.error("pass --database-url to load, or --emit-sql-dir to write SQL files")

    rows = read_rows(args.src)
    problems = check(rows)
    if problems:
        raise SystemExit(
            "Load aborted — the extract disagrees with what this loader expects:\n"
            + "\n".join(f"  - {p}" for p in problems)
        )
    print(f"Checked {len(rows):,} facilities — every check passes.")

    report = qa_report(rows)
    Path(args.qa_report).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"QA report written to {args.qa_report}")

    if args.emit_sql_dir:
        emit_sql_files(rows, Path(args.emit_sql_dir))
    if args.database_url:
        run_live(args.database_url, rows, report)


if __name__ == "__main__":
    main()
