"""Load the FHSIS 2025 annual release into fact_fhsis_indicator and fact_fhsis_workforce (F1).

Reads the committed extracts `ingestion/data/fhsis_2025_*_cleaned.csv` produced by
`ingestion/clean_fhsis.py`. This script never opens a source workbook — it trusts the checked
extracts and nothing else, mirroring `ingestion/ingest_nhfr.py` and `ingestion/ingest_uuc_phc.py`.

Two run modes, following `ingest_nhfr.py`:

    # live load, one transaction, writes an ingestion_batches row with the QA report
    python ingestion/ingest_fhsis.py --database-url "$SUPABASE_DB_URL"

    # offline: batched .sql files to review and apply by hand
    python ingestion/ingest_fhsis.py --emit-sql-dir ingestion/_sql_fhsis

**No committed seed migration.** `ingest_uuc_phc.py` emits one because 5,987 rows fit inside a
migration file; 94,005 do not. The reproducible committed artefacts for this dataset are the
cleaned CSVs, `docs/FHSIS_2025_CLEANING_REPORT.md` and the manifest, and re-running this loader is
the refresh procedure (plan Decision 8).

**geo_code is re-resolved in SQL, not trusted from the CSV.** The cleaner already resolved every
row — it had to, because resolution needs `dim_geo`'s names for the repair paths that ~70 rows per
sheet require. But the code it wrote still goes through `map_psgc_to_dim_geo()` here, so a code
that `dim_geo` no longer knows fails `geo_code`'s NOT NULL and aborts the load rather than
silently dropping an area. That keeps the guarantee `ingest_nhfr.py` gets from resolving in SQL,
without pretending the resolution was simple.

No `SOURCE_VINTAGE` is passed: unlike NHFR, nothing in FHSIS is on the pre-transfer Sulu vintage —
every code the cleaner emits is already a live `dim_geo` code — so the crosswalk branch is never
needed and passing a vintage would only mask a code that should have failed.

---

## The checks, all of which abort the load

Every one is load-blocking, on `ingest_uuc_phc.py`'s discipline: this dataset publishes national
coverage figures, and a silently short load is worse than a failed one.

  - **Zero BHW rows, asserted before commit.** Plan Decision 2. The cleaner dropped the column and
    the table carries `check (cadre <> 'bhw')`; this is the third of three independent guards, and
    it is the one that runs against what actually landed in the database.
  - **The national FIC row reproduces 1,560,924 of 2,392,392.** The figure the plan pins the load
    to. Checked in the extract and again in the database after the insert.
  - **Row counts and `over_100` counts match the cleaning report** — read from
    `fhsis_2025_cleaning_summary.json`, the machine-readable twin the same cleaning run writes, so
    the two cannot drift apart the way two hand-maintained lists would.
  - **Every `indicator_key` exists in `ref_fhsis_indicator`**, checked against the live table
    rather than against a copy of the list, so an unapplied migration fails here with a useful
    message instead of a foreign-key error 40 batches in.
  - **No unresolvable `geo_code`**, pre-flighted before a single row is written.
  - **`breakdown` inside the vocabulary** and no duplicate keys.

The leaf-vs-parent residual is **recorded, not required to be zero** (Decision 4). The QA report
carries it and `ref_fhsis_reconciliation` exposes it; 78 of 83 comparable provinces reconcile
exactly and the rest differ by an independent city the source's province row excludes, which is a
property of the source rather than a fault in the load.
"""

import argparse
import csv
import json
from pathlib import Path

from ingest import batched, sql_literal

SRC_DIR_DEFAULT = "ingestion/data"
SUMMARY_DEFAULT = "ingestion/data/fhsis_2025_cleaning_summary.json"
DATASET_SLUG = "fhsis-2025"

INDICATOR_TABLE = "fact_fhsis_indicator"
WORKFORCE_TABLE = "fact_fhsis_workforce"
BATCH_SIZE = 2000

# One CSV per program area, as clean_fhsis.py emits them.
INDICATOR_AREAS = ["envi", "immunization", "maternal", "tb"]

# The headline figures the plan names, hard-coded here as well as read from the summary. Two
# independent sources of the same truth on purpose: the summary catches a stale CSV, and these
# catch a stale *summary* — a re-clean that quietly lost the national row would otherwise agree
# with itself.
EXPECTED_NATIONAL_FIC_NUMERATOR = 1_560_924
EXPECTED_NATIONAL_FIC_DENOMINATOR = 2_392_392
EXPECTED_NATIONAL_POPULATION_2025 = 113_146_216
EXPECTED_NATIONAL_HOUSEHOLDS_2025 = 27_387_195

BREAKDOWNS = {"total", "male", "female", "10-14", "15-19", "20-49", "0-14", "15+"}

CSV_COLUMNS_INDICATOR = [
    "indicator_key",
    "breakdown",
    "geo_code",
    "geo_level",
    "numerator",
    "denominator",
    "rate_pct",
    "over_100",
    "source_psgc",
    "source_area_name",
    "geo_resolution",
]

CSV_COLUMNS_WORKFORCE = [
    "cadre",
    "geo_code",
    "geo_level",
    "lgu_hired",
    "doh_hired",
    "total",
    "population_2025",
    "households_2025",
    "source_psgc",
    "source_area_name",
    "geo_resolution",
]

# Written to the tables, in order. `geo_resolution` is not among them: it is the cleaner's record
# of *how* a row's geography was determined, which belongs in the cleaning report and the QA
# report rather than in a fact table — the fact table keeps `source_psgc` and `source_area_name`,
# which are what let a reader check the answer for themselves.
INSERT_COLUMNS_INDICATOR = [
    "dataset_id",
    "geo_code",
    "geo_level",
    "indicator_key",
    "breakdown",
    "numerator",
    "denominator",
    "rate_pct",
    "over_100",
    "source_psgc",
    "source_area_name",
]

INSERT_COLUMNS_WORKFORCE = [
    "dataset_id",
    "geo_code",
    "geo_level",
    "cadre",
    "lgu_hired",
    "doh_hired",
    "total",
    "population_2025",
    "households_2025",
    "source_psgc",
    "source_area_name",
]


def read_rows(path: Path, columns: list[str]) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames != columns:
            raise SystemExit(
                f"{path}: unexpected columns.\n  expected {columns}\n  found    "
                f"{reader.fieldnames}\nRe-run ingestion/clean_fhsis.py."
            )
        return list(reader)


def load_extracts(src_dir: Path) -> tuple[list[dict], list[dict]]:
    indicator_rows: list[dict] = []
    for area in INDICATOR_AREAS:
        path = src_dir / f"fhsis_2025_{area}_cleaned.csv"
        rows = read_rows(path, CSV_COLUMNS_INDICATOR)
        for row in rows:
            row["_source_csv"] = path.name
        indicator_rows.extend(rows)
    workforce_rows = read_rows(src_dir / "fhsis_2025_workforce_cleaned.csv", CSV_COLUMNS_WORKFORCE)
    return indicator_rows, workforce_rows


def integer(value):
    return None if value == "" else int(value)


def numeric(value):
    return None if value == "" else float(value)


def check(indicator_rows: list[dict], workforce_rows: list[dict], summary: dict) -> list[str]:
    """Every failure here aborts the load. Returns the problem list rather than raising so the
    caller can print all of them at once — a load that fails six checks should say so six times,
    not make the operator re-run to discover the next one."""
    problems: list[str] = []

    # --- Decision 2, before anything else -----------------------------------
    bhw = [r for r in workforce_rows if "bhw" in r["cadre"].lower()]
    if bhw:
        problems.append(
            f"{len(bhw)} workforce rows carry a BHW cadre — FHSIS supplies no BHW count for this "
            "site (plan Decision 2). The cleaner should have dropped the column; the extract is "
            "not the one clean_fhsis.py produces."
        )
    bhw_indicators = [r for r in indicator_rows if "bhw" in r["indicator_key"].lower()]
    if bhw_indicators:
        problems.append(f"{len(bhw_indicators)} indicator rows carry a BHW indicator key")

    # --- row counts against the cleaning report -----------------------------
    expected = summary["output_rows"]
    for area in INDICATOR_AREAS:
        name = f"fhsis_2025_{area}_cleaned.csv"
        found = sum(1 for r in indicator_rows if r["_source_csv"] == name)
        if found != expected.get(name):
            problems.append(
                f"{name}: {found:,} rows, the cleaning report says {expected.get(name)!r}"
            )
    if len(workforce_rows) != expected.get("fhsis_2025_workforce_cleaned.csv"):
        problems.append(
            f"workforce: {len(workforce_rows):,} rows, the cleaning report says "
            f"{expected.get('fhsis_2025_workforce_cleaned.csv')!r}"
        )

    # --- over_100 per indicator against the cleaning report ------------------
    over_100: dict[str, int] = {}
    for row in indicator_rows:
        if row["over_100"] == "true":
            over_100[row["indicator_key"]] = over_100.get(row["indicator_key"], 0) + 1
    for key, count in summary["over_100_by_indicator"].items():
        found = over_100.get(key, 0)
        if found != count:
            problems.append(
                f"indicator {key}: {found:,} rows flagged over_100, the cleaning report says "
                f"{count:,}"
            )
    unexpected = set(over_100) - set(summary["over_100_by_indicator"])
    if unexpected:
        problems.append(f"over_100 set on indicators the report does not list: {sorted(unexpected)}")

    # --- the national figures the plan pins the load to ----------------------
    national_fic = [
        r
        for r in indicator_rows
        if r["indicator_key"] == "fic" and r["breakdown"] == "total" and r["geo_level"] == "national"
    ]
    if len(national_fic) != 1:
        problems.append(f"expected exactly one national FIC total row, found {len(national_fic)}")
    else:
        row = national_fic[0]
        if integer(row["numerator"]) != EXPECTED_NATIONAL_FIC_NUMERATOR:
            problems.append(
                f"national FIC numerator is {row['numerator']!r}, expected "
                f"{EXPECTED_NATIONAL_FIC_NUMERATOR:,}"
            )
        if integer(row["denominator"]) != EXPECTED_NATIONAL_FIC_DENOMINATOR:
            problems.append(
                f"national FIC denominator is {row['denominator']!r}, expected "
                f"{EXPECTED_NATIONAL_FIC_DENOMINATOR:,}"
            )

    national_workforce = [r for r in workforce_rows if r["geo_level"] == "national"]
    if not national_workforce:
        problems.append("no national workforce row")
    else:
        row = national_workforce[0]
        if integer(row["population_2025"]) != EXPECTED_NATIONAL_POPULATION_2025:
            problems.append(
                f"national population_2025 is {row['population_2025']!r}, expected "
                f"{EXPECTED_NATIONAL_POPULATION_2025:,}"
            )
        if integer(row["households_2025"]) != EXPECTED_NATIONAL_HOUSEHOLDS_2025:
            problems.append(
                f"national households_2025 is {row['households_2025']!r}, expected "
                f"{EXPECTED_NATIONAL_HOUSEHOLDS_2025:,}"
            )

    # --- shape ---------------------------------------------------------------
    bad_breakdowns = {r["breakdown"] for r in indicator_rows} - BREAKDOWNS
    if bad_breakdowns:
        problems.append(f"breakdowns outside the vocabulary: {sorted(bad_breakdowns)}")

    bad_levels = {r["geo_level"] for r in indicator_rows + workforce_rows} - {
        "national",
        "region",
        "province",
        "citymun",
    }
    if bad_levels:
        problems.append(
            f"geo levels outside the source's grain: {sorted(bad_levels)} — FHSIS has no barangay "
            "grain at all"
        )

    seen: set = set()
    duplicates = 0
    for row in indicator_rows:
        key = (row["geo_code"], row["indicator_key"], row["breakdown"])
        if key in seen:
            duplicates += 1
        seen.add(key)
    if duplicates:
        problems.append(
            f"{duplicates} duplicate (geo_code, indicator_key, breakdown) keys — the table's "
            "unique constraint would reject them"
        )

    seen_workforce: set = set()
    duplicates = 0
    for row in workforce_rows:
        key = (row["geo_code"], row["cadre"])
        if key in seen_workforce:
            duplicates += 1
        seen_workforce.add(key)
    if duplicates:
        problems.append(f"{duplicates} duplicate (geo_code, cadre) keys")

    missing_geo = sum(1 for r in indicator_rows + workforce_rows if not r["geo_code"])
    if missing_geo:
        problems.append(f"{missing_geo} rows with no geo_code")

    return problems


def indicator_value_tuple(row: dict) -> str:
    return (
        "("
        + ", ".join(
            [
                sql_literal(row["geo_code"]),
                sql_literal(row["geo_level"]),
                sql_literal(row["indicator_key"]),
                sql_literal(row["breakdown"]),
                "null" if row["numerator"] == "" else str(integer(row["numerator"])),
                "null" if row["denominator"] == "" else str(integer(row["denominator"])),
                "null" if row["rate_pct"] == "" else repr(numeric(row["rate_pct"])),
                "true" if row["over_100"] == "true" else "false",
                sql_literal(row["source_psgc"] or None),
                sql_literal(row["source_area_name"] or None),
            ]
        )
        + ")"
    )


def indicator_insert_sql(rows: list[dict]) -> str:
    values = ",\n  ".join(indicator_value_tuple(r) for r in rows)
    return f"""with ds as (
  select dataset_id from dim_dataset where slug = {sql_literal(DATASET_SLUG)}
),
src (
  geo_code, geo_level, indicator_key, breakdown, numerator, denominator, rate_pct, over_100,
  source_psgc, source_area_name
) as (values
  {values}
)
insert into {INDICATOR_TABLE} (
  {", ".join(INSERT_COLUMNS_INDICATOR)}
)
select
  (select dataset_id from ds),
  -- Resolved, not written literally: a code dim_geo no longer knows returns NULL and fails
  -- geo_code's NOT NULL, aborting the load instead of dropping an area.
  map_psgc_to_dim_geo(src.geo_code),
  src.geo_level::geo_level_enum,
  src.indicator_key,
  src.breakdown,
  src.numerator::integer,
  src.denominator::integer,
  src.rate_pct::numeric,
  src.over_100::boolean,
  src.source_psgc,
  src.source_area_name
from src
on conflict (dataset_id, geo_code, indicator_key, breakdown) do update set
  numerator = excluded.numerator,
  denominator = excluded.denominator,
  rate_pct = excluded.rate_pct,
  over_100 = excluded.over_100,
  geo_level = excluded.geo_level,
  source_psgc = excluded.source_psgc,
  source_area_name = excluded.source_area_name;
"""


def workforce_value_tuple(row: dict) -> str:
    return (
        "("
        + ", ".join(
            [
                sql_literal(row["geo_code"]),
                sql_literal(row["geo_level"]),
                sql_literal(row["cadre"]),
                "null" if row["lgu_hired"] == "" else str(integer(row["lgu_hired"])),
                "null" if row["doh_hired"] == "" else str(integer(row["doh_hired"])),
                "null" if row["total"] == "" else str(integer(row["total"])),
                "null" if row["population_2025"] == "" else str(integer(row["population_2025"])),
                "null" if row["households_2025"] == "" else str(integer(row["households_2025"])),
                sql_literal(row["source_psgc"] or None),
                sql_literal(row["source_area_name"] or None),
            ]
        )
        + ")"
    )


def workforce_insert_sql(rows: list[dict]) -> str:
    values = ",\n  ".join(workforce_value_tuple(r) for r in rows)
    return f"""with ds as (
  select dataset_id from dim_dataset where slug = {sql_literal(DATASET_SLUG)}
),
src (
  geo_code, geo_level, cadre, lgu_hired, doh_hired, total, population_2025, households_2025,
  source_psgc, source_area_name
) as (values
  {values}
)
insert into {WORKFORCE_TABLE} (
  {", ".join(INSERT_COLUMNS_WORKFORCE)}
)
select
  (select dataset_id from ds),
  map_psgc_to_dim_geo(src.geo_code),
  src.geo_level::geo_level_enum,
  src.cadre,
  src.lgu_hired::integer,
  src.doh_hired::integer,
  src.total::integer,
  src.population_2025::integer,
  src.households_2025::integer,
  src.source_psgc,
  src.source_area_name
from src
-- No BHW branch and no filter: the cadre check constraint on the table is what refuses one, so a
-- BHW row would abort the transaction rather than be quietly skipped here.
on conflict (dataset_id, geo_code, cadre) do update set
  lgu_hired = excluded.lgu_hired,
  doh_hired = excluded.doh_hired,
  total = excluded.total,
  population_2025 = excluded.population_2025,
  households_2025 = excluded.households_2025,
  geo_level = excluded.geo_level,
  source_psgc = excluded.source_psgc,
  source_area_name = excluded.source_area_name;
"""


def tally(rows: list[dict], key: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        counts[row[key]] = counts.get(row[key], 0) + 1
    return counts


def qa_report(indicator_rows: list[dict], workforce_rows: list[dict], summary: dict) -> dict:
    return {
        "dataset_slug": DATASET_SLUG,
        "source_files": [f"fhsis_2025_{a}_cleaned.csv" for a in INDICATOR_AREAS]
        + ["fhsis_2025_workforce_cleaned.csv"],
        "source_retrieved_at": summary["source_retrieved_at"],
        "workbooks": summary["workbooks"],
        "indicator_rows": len(indicator_rows),
        "workforce_rows": len(workforce_rows),
        "by_indicator": tally(indicator_rows, "indicator_key"),
        "by_breakdown": tally(indicator_rows, "breakdown"),
        "by_geo_level": tally(indicator_rows, "geo_level"),
        "by_cadre": tally(workforce_rows, "cadre"),
        "by_geo_resolution": tally(indicator_rows, "geo_resolution"),
        "over_100_by_indicator": summary["over_100_by_indicator"],
        # Decision 7: recorded so the "not reported ≠ zero" gap is a published number rather than
        # an absence a reader has to infer.
        "not_reported_by_indicator": summary["not_reported_by_indicator"],
        # Decision 4: recorded, never required to be zero.
        "reconciliation": summary["reconciliation"],
        "bhw_rows": 0,
    }


def emit_sql_files(indicator_rows: list[dict], workforce_rows: list[dict], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for i, batch in enumerate(batched(indicator_rows, BATCH_SIZE)):
        path = out_dir / f"{INDICATOR_TABLE}_{i:03d}.sql"
        path.write_text(indicator_insert_sql(batch), encoding="utf-8")
        print(f"  wrote {path} ({len(batch):,} rows)")
    for i, batch in enumerate(batched(workforce_rows, BATCH_SIZE)):
        path = out_dir / f"{WORKFORCE_TABLE}_{i:03d}.sql"
        path.write_text(workforce_insert_sql(batch), encoding="utf-8")
        print(f"  wrote {path} ({len(batch):,} rows)")


def run_live(database_url: str, indicator_rows: list[dict], workforce_rows: list[dict],
             report: dict) -> None:
    import psycopg2

    conn = psycopg2.connect(database_url)
    try:
        with conn.cursor() as cur:
            cur.execute("select dataset_id from dim_dataset where slug = %s", (DATASET_SLUG,))
            found = cur.fetchone()
            if not found:
                raise SystemExit(
                    f"dim_dataset has no row for slug {DATASET_SLUG!r} — apply "
                    "supabase/migrations/20260906100300_seed_dim_dataset_fhsis.sql first."
                )

            # Pre-flight 1: the dictionary. Checked against the live table rather than a copy of
            # the list, so an unapplied migration fails here with a useful message instead of a
            # foreign-key error forty batches in.
            cur.execute("select indicator_key from ref_fhsis_indicator")
            known = {row[0] for row in cur.fetchall()}
            used = {r["indicator_key"] for r in indicator_rows}
            unknown = sorted(used - known)
            if unknown:
                raise SystemExit(
                    f"{len(unknown)} indicator keys are not in ref_fhsis_indicator: {unknown}\n"
                    "Apply supabase/migrations/20260906100000_ref_fhsis_indicator.sql, or add the "
                    "indicator to INDICATORS in clean_fhsis.py and to that migration together."
                )

            # Pre-flight 2: every geography resolves before a single row is written. Without this
            # the load runs for dozens of batches and then dies on a NOT NULL violation naming one
            # code, which says nothing about the shape of the problem.
            codes = sorted(
                {r["geo_code"] for r in indicator_rows} | {r["geo_code"] for r in workforce_rows}
            )
            cur.execute(
                "select count(*) from unnest(%s::text[]) as c where map_psgc_to_dim_geo(c) is null",
                (codes,),
            )
            unresolved = cur.fetchone()[0]
            if unresolved:
                raise SystemExit(
                    f"{unresolved} of {len(codes):,} geo codes do not resolve against dim_geo. "
                    "The cleaner resolved them against a dim_geo snapshot that no longer matches "
                    "this database — re-run clean_fhsis.py with --database-url."
                )

            cur.execute(
                "insert into ingestion_batches (source_file, row_counts) values (%s, %s) "
                "returning batch_id",
                (
                    "ingestion/data/fhsis_2025_*_cleaned.csv",
                    json.dumps(
                        {
                            INDICATOR_TABLE: len(indicator_rows),
                            WORKFORCE_TABLE: len(workforce_rows),
                        }
                    ),
                ),
            )
            batch_id = cur.fetchone()[0]

            for i, batch in enumerate(batched(indicator_rows, BATCH_SIZE)):
                cur.execute(indicator_insert_sql(batch))
                print(f"  {INDICATOR_TABLE} batch {i:03d}: {len(batch):,} rows")
            for i, batch in enumerate(batched(workforce_rows, BATCH_SIZE)):
                cur.execute(workforce_insert_sql(batch))
                print(f"  {WORKFORCE_TABLE} batch {i:03d}: {len(batch):,} rows")

            # The load-time truth checks. The Python checks above verify the extract; these verify
            # what actually landed, including the geo resolution SQL did.
            for problem in verify_loaded(cur):
                raise SystemExit(f"{problem} — rolling back")

            cur.execute(
                f"select count(*) from {INDICATOR_TABLE} where dataset_id = "
                "(select dataset_id from dim_dataset where slug = %s)",
                (DATASET_SLUG,),
            )
            report["loaded_indicator_rows"] = cur.fetchone()[0]
            cur.execute(
                f"select count(*) from {WORKFORCE_TABLE} where dataset_id = "
                "(select dataset_id from dim_dataset where slug = %s)",
                (DATASET_SLUG,),
            )
            report["loaded_workforce_rows"] = cur.fetchone()[0]

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


def verify_loaded(cur) -> list[str]:
    """What landed, checked in the database. Shared by the live load and `--verify-only`."""
    problems: list[str] = []

    # Decision 2, the guard that runs against reality rather than against the extract.
    cur.execute(f"select count(*) from {WORKFORCE_TABLE} where cadre = 'bhw'")
    bhw = cur.fetchone()[0]
    if bhw:
        problems.append(f"{bhw} rows in {WORKFORCE_TABLE} carry cadre 'bhw'")

    cur.execute(
        """select count(*) from information_schema.columns
           where table_schema = 'public' and table_name like '%fhsis%' and column_name ilike '%bhw%'"""
    )
    bhw_columns = cur.fetchone()[0]
    if bhw_columns:
        problems.append(f"{bhw_columns} columns in the FHSIS tables name a BHW field")

    cur.execute(
        f"""select numerator, denominator from {INDICATOR_TABLE}
            where dataset_id = (select dataset_id from dim_dataset where slug = %s)
              and indicator_key = 'fic' and breakdown = 'total' and geo_level = 'national'""",
        (DATASET_SLUG,),
    )
    row = cur.fetchone()
    if not row:
        problems.append("no national FIC total row landed")
    elif (row[0], row[1]) != (
        EXPECTED_NATIONAL_FIC_NUMERATOR,
        EXPECTED_NATIONAL_FIC_DENOMINATOR,
    ):
        problems.append(
            f"national FIC is {row[0]:,}/{row[1]:,}, expected "
            f"{EXPECTED_NATIONAL_FIC_NUMERATOR:,}/{EXPECTED_NATIONAL_FIC_DENOMINATOR:,}"
        )

    return problems


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src-dir", default=SRC_DIR_DEFAULT, help="Where the cleaned CSVs are")
    parser.add_argument("--summary", default=SUMMARY_DEFAULT, help="The cleaning summary JSON")
    parser.add_argument("--database-url", help="Load live into this Postgres URL")
    parser.add_argument("--emit-sql-dir", help="Write batched .sql files here instead of loading")
    parser.add_argument(
        "--qa-report",
        default="ingestion/_qa_report_fhsis.json",
        help="Where to write the QA report JSON",
    )
    args = parser.parse_args()

    if not args.database_url and not args.emit_sql_dir:
        parser.error("pass --database-url to load, or --emit-sql-dir to write SQL files")

    summary = json.loads(Path(args.summary).read_text(encoding="utf-8"))
    indicator_rows, workforce_rows = load_extracts(Path(args.src_dir))

    problems = check(indicator_rows, workforce_rows, summary)
    if problems:
        raise SystemExit(
            "Load aborted — the extract disagrees with what this loader expects:\n"
            + "\n".join(f"  - {p}" for p in problems)
        )
    print(
        f"Checked {len(indicator_rows):,} indicator rows and {len(workforce_rows):,} workforce "
        "rows — every check passes."
    )
    print(f"  national FIC: {EXPECTED_NATIONAL_FIC_NUMERATOR:,} of "
          f"{EXPECTED_NATIONAL_FIC_DENOMINATOR:,}")
    print("  BHW cadre rows: 0")

    report = qa_report(indicator_rows, workforce_rows, summary)
    Path(args.qa_report).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"QA report written to {args.qa_report}")

    if args.emit_sql_dir:
        emit_sql_files(indicator_rows, workforce_rows, Path(args.emit_sql_dir))
    if args.database_url:
        run_live(args.database_url, indicator_rows, workforce_rows, report)


if __name__ == "__main__":
    main()
