#!/usr/bin/env python3
"""xlsx -> Postgres ingestion for the BHW Connect StepZero quick-count dataset.

Loads ingestion/data/bhw_connect_stepzero.xlsx (one row per barangay: REGISTERED /
REGISTERED & ACCREDITED / NON-REGISTERED headcounts plus POPULATION/HOUSEHOLDS) into
agg_bhw_stepzero_counts at all 5 geo levels, rolling barangay rows up to
citymun/province/region/national by summing the sheet's own PSGC code columns (no join
against dim_geo needed for the rollup math itself - dim_geo is only consulted to validate
that a geo_code exists before it's inserted, since agg_bhw_stepzero_counts.geo_code is a
dim_geo FK).

REGISTERED / REGISTERED & ACCREDITED / NON-REGISTERED are three mutually-exclusive
buckets (confirmed by inspecting the source data - accredited counts exceed registered
counts in several rows, so "registered & accredited" cannot be a subset of "registered"):
n_total_bhw = REGISTERED + REGISTERED_ACCREDITED + NON_REGISTERED.

Code validation uses ingestion/data/dataset.parquet's own REGION/PROVINCE/CITY-MUN/
BARANGAY CODE columns as the known-good set, since that parquet is exactly what dim_geo
was built from (see build_dim_geo() in ingest.py) - this avoids needing a live DB
connection just to fetch dim_geo's codes. A full-file comparison (see docs/DECISIONS.md)
found all 39,276 dim_geo barangays present in this sheet, plus ~2,689 additional barangay
codes and 12 additional citymun codes not present in dim_geo (newer PSGC entries/renumbered
barangays, e.g. City of Laoag) - rows/rollups keyed on an unmatched code are skipped and
listed in the QA report rather than silently dropped or inserted with a dangling FK.

Two ways to run it (same modes as ingest.py):

  python ingestion/ingest_stepzero.py --database-url "$DATABASE_URL"
  python ingestion/ingest_stepzero.py --emit-sql-dir ingestion/_sql_batches_stepzero --dataset-id N

Either mode writes a QA report to ingestion/_qa_report_stepzero.json.
"""

import argparse
import json
from pathlib import Path

import pandas as pd

from ingest import batched, insert_statement, nullable_int, pad

REPO_ROOT = Path(__file__).resolve().parent.parent
XLSX_PATH = REPO_ROOT / "ingestion" / "data" / "bhw_connect_stepzero.xlsx"
PARQUET_PATH = REPO_ROOT / "ingestion" / "data" / "dataset.parquet"
QA_REPORT_PATH = REPO_ROOT / "ingestion" / "_qa_report_stepzero.json"

DATASET_SLUG = "bhw-stepzero-2026"
TABLE = "agg_bhw_stepzero_counts"
COLUMNS = [
    "dataset_id",
    "geo_code",
    "geo_level",
    "n_registered",
    "n_registered_accredited",
    "n_non_registered",
    "n_total_bhw",
    "pct_registered_accredited",
    "population",
    "households",
]
BATCH_SIZE = 5000


def load_known_codes():
    """Codes dim_geo was built from (see build_dim_geo() in ingest.py) - used to validate
    this sheet's PSGC codes without needing a live DB connection."""
    pq = pd.read_parquet(
        PARQUET_PATH,
        columns=["REGION CODE", "PROVINCE CODE", "CITY/MUN CODE", "BARANGAY CODE"],
    )
    return {
        "region": {pad(v, 2) for v in pq["REGION CODE"].unique()},
        "province": {pad(v, 5) for v in pq["PROVINCE CODE"].unique()},
        "citymun": {pad(v, 7) for v in pq["CITY/MUN CODE"].unique()},
        "barangay": {pad(v, 10) for v in pq["BARANGAY CODE"].unique()},
    }


def load_source():
    df = pd.read_excel(XLSX_PATH, sheet_name=0)
    df.columns = [c.strip() for c in df.columns]
    return df


def counts_row(dataset_id, geo_code, geo_level, n_registered, n_registered_accredited, n_non_registered, population, households):
    # Cast every numeric input to a plain Python type up front - pandas/numpy scalars
    # (int64/float64) survive arithmetic and round(), and sql_literal()'s repr() of a
    # numpy float64 renders as "np.float64(65.72)", which is invalid SQL.
    n_registered = int(n_registered)
    n_registered_accredited = int(n_registered_accredited)
    n_non_registered = int(n_non_registered)
    n_total = n_registered + n_registered_accredited + n_non_registered
    return {
        "dataset_id": dataset_id,
        "geo_code": geo_code,
        "geo_level": geo_level,
        "n_registered": n_registered,
        "n_registered_accredited": n_registered_accredited,
        "n_non_registered": n_non_registered,
        "n_total_bhw": n_total,
        "pct_registered_accredited": float(round(100.0 * n_registered_accredited / n_total, 2)) if n_total else None,
        "population": nullable_int(population),
        "households": nullable_int(households),
    }


def build_barangay_rows(df, dataset_id, known_codes, qa):
    rows = []
    unmatched = []
    for d in df.to_dict(orient="records"):
        geo_code = pad(d["BGY CODE"], 10)
        if geo_code not in known_codes["barangay"]:
            unmatched.append(
                {
                    "geo_code": geo_code,
                    "bgy_name": d["BGY NAME"],
                    "citymun_name": d["CITYMUN NAME"],
                    "region_name": d["REGION NAME"],
                }
            )
            continue
        rows.append(
            counts_row(
                dataset_id,
                geo_code,
                "barangay",
                d["REGISTERED"],
                d["REGISTERED & ACCREDITED"],
                d["NON-REGISTERED"],
                d["POPULATION"],
                d["HOUSEHOLDS"],
            )
        )

    qa["barangay_rows_matched"] = len(rows)
    qa["barangay_rows_unmatched"] = len(unmatched)
    qa["barangay_unmatched_sample"] = unmatched[:50]
    return rows


def build_rollup_rows(df, dataset_id, geo_col, code_width, geo_level, known_codes, qa):
    """Sum the sheet's own columns grouped by one of its own PSGC code columns - the
    rollup total intentionally includes barangay rows that failed the barangay-level FK
    check above (dropping them would understate the true regional/national count)."""
    grouped = df.groupby(geo_col, as_index=False).agg(
        REGISTERED=("REGISTERED", "sum"),
        REGISTERED_ACCREDITED=("REGISTERED & ACCREDITED", "sum"),
        NON_REGISTERED=("NON-REGISTERED", "sum"),
        POPULATION=("POPULATION", "sum"),
        HOUSEHOLDS=("HOUSEHOLDS", "sum"),
    )

    rows = []
    unmatched = []
    for d in grouped.to_dict(orient="records"):
        geo_code = pad(d[geo_col], code_width)
        if geo_code not in known_codes[geo_level]:
            unmatched.append(geo_code)
            continue
        rows.append(
            counts_row(
                dataset_id,
                geo_code,
                geo_level,
                d["REGISTERED"],
                d["REGISTERED_ACCREDITED"],
                d["NON_REGISTERED"],
                d["POPULATION"],
                d["HOUSEHOLDS"],
            )
        )

    qa[f"{geo_level}_rows_matched"] = len(rows)
    qa[f"{geo_level}_rows_unmatched"] = len(unmatched)
    qa[f"{geo_level}_unmatched_sample"] = unmatched[:50]
    return rows


def build_national_row(df, dataset_id):
    return counts_row(
        dataset_id,
        "PH",
        "national",
        df["REGISTERED"].sum(),
        df["REGISTERED & ACCREDITED"].sum(),
        df["NON-REGISTERED"].sum(),
        df["POPULATION"].sum(),
        df["HOUSEHOLDS"].sum(),
    )


def emit_sql_files(rows, out_dir: Path, start_index=0):
    n = start_index
    for chunk in batched(rows, BATCH_SIZE):
        n += 1
        path = out_dir / f"{n:04d}_{TABLE}.sql"
        path.write_text(insert_statement(TABLE, COLUMNS, chunk))
    return n


def run_via_psycopg2(database_url, rows):
    import psycopg2

    conn = psycopg2.connect(database_url)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            for chunk in batched(rows, BATCH_SIZE):
                cur.execute(insert_statement(TABLE, COLUMNS, chunk))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", help="Postgres connection string (psycopg2 mode)")
    parser.add_argument("--emit-sql-dir", help="Directory to write batched .sql files instead")
    parser.add_argument(
        "--dataset-id",
        type=int,
        help="Pre-existing dim_dataset.dataset_id for slug=bhw-stepzero-2026 "
        "(required with --emit-sql-dir; --database-url mode looks this up itself). "
        "Resolve it with: select dataset_id from dim_dataset where slug = 'bhw-stepzero-2026';",
    )
    args = parser.parse_args()

    if not args.database_url and not args.emit_sql_dir:
        parser.error("pass --database-url or --emit-sql-dir")
    if args.emit_sql_dir and not args.dataset_id:
        parser.error("--emit-sql-dir requires --dataset-id")

    df = load_source()
    known_codes = load_known_codes()

    qa = {
        "source_file": str(XLSX_PATH.relative_to(REPO_ROOT)),
        "dataset_slug": DATASET_SLUG,
        "input_rows": len(df),
    }

    if args.emit_sql_dir:
        ingestion_batch_id = None
        dataset_id = args.dataset_id
        conn = None
    else:
        import psycopg2

        conn = psycopg2.connect(args.database_url)
        with conn, conn.cursor() as cur:
            cur.execute(
                "select dataset_id from dim_dataset where slug = %s", (DATASET_SLUG,)
            )
            row = cur.fetchone()
            if row is None:
                raise SystemExit(
                    f"dim_dataset row for slug={DATASET_SLUG!r} not found - apply "
                    "20260719102100_seed_dim_dataset_stepzero.sql first"
                )
            dataset_id = row[0]
            cur.execute(
                "insert into ingestion_batches (source_file) values (%s) returning batch_id",
                (str(XLSX_PATH.relative_to(REPO_ROOT)),),
            )
            ingestion_batch_id = cur.fetchone()[0]

    barangay_rows = build_barangay_rows(df, dataset_id, known_codes, qa)
    citymun_rows = build_rollup_rows(df, dataset_id, "CITYMUN CODE", 7, "citymun", known_codes, qa)
    province_rows = build_rollup_rows(df, dataset_id, "PROV CODE", 5, "province", known_codes, qa)
    region_rows = build_rollup_rows(df, dataset_id, "REGION CODE", 2, "region", known_codes, qa)
    national_row = build_national_row(df, dataset_id)

    all_rows = barangay_rows + citymun_rows + province_rows + region_rows + [national_row]
    qa["total_rows_to_insert"] = len(all_rows)

    if args.emit_sql_dir:
        out_dir = Path(args.emit_sql_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        n = emit_sql_files(all_rows, out_dir)
        print(f"Wrote {n} batch file(s) to {out_dir}")
    else:
        run_via_psycopg2(args.database_url, all_rows)
        with conn, conn.cursor() as cur:
            cur.execute(
                "update ingestion_batches set finished_at = now(), row_counts = %s, qa_report = %s "
                "where batch_id = %s",
                (json.dumps({"total_rows": len(all_rows)}), json.dumps(qa), ingestion_batch_id),
            )
        conn.close()

    QA_REPORT_PATH.write_text(json.dumps(qa, indent=2, default=str))
    print(f"QA report written to {QA_REPORT_PATH}")
    print(json.dumps(qa, indent=2, default=str))


if __name__ == "__main__":
    main()
