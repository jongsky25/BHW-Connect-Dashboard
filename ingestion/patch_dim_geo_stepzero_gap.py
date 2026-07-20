#!/usr/bin/env python3
"""One-time patch: add dim_geo rows for citymuns/barangays that StepZero knows about
but bhw-2025 (and therefore dim_geo, which is built purely from the bhw-2025 parquet
- see build_dim_geo() in ingest.py) has zero individually-profiled BHW rows for yet.

See docs/DECISIONS.md, 2026-07-20 entry: this was originally assumed to be a PSGC
vintage mismatch. Re-investigated: it isn't. 12 citymuns (e.g. City of Imus, Gen.
Mariano Alvarez in Cavite) have zero bhw-2025 parquet rows at all - real LGUs, not
coding artifacts. Of the remaining ~2,689 unmatched barangays, only 7 collide by name
with an existing dim_geo barangay under the same citymun (likely the same place under
a renumbered code); the other ~2,682 (2,351 under already-known citymuns + 331 under
the 12 new ones) have no profiled rows yet. StepZero's LGU-reported headcount reached
every place nationally; individual profiling had not caught up to these ~2,700 places
as of the bhw-2025 snapshot.

Sources the new dim_geo rows entirely from ingestion/data/bhw_connect_stepzero.xlsx's
own hierarchy columns (region/province/citymun/barangay code + name) - the only place
these codes/names exist. income_class stays NULL (the sheet doesn't carry it, unlike
the parquet). psgc_vintage is tagged distinctly ('stepzero_only_v1') so the gap stays
visible in the data itself, not just in this script/docs.

The 7 name-collision barangays are excluded from dim_geo insertion (logged separately
in the QA report) rather than guessed at - they need a manual PSGC cross-check, not an
automatic insert that could create a duplicate identity for an already-known place.

Also builds the matching agg_bhw_stepzero_counts rows for exactly the newly-added
codes - these were silently skipped by ingest_stepzero.py's FK check on the original
load. Citymun-level rollups for the 12 new citymuns sum ALL of that citymun's sheet
rows (including the excluded-from-dim_geo collision barangays), matching how
ingest_stepzero.py's build_rollup_rows already sums over the full sheet rather than
just FK-matched barangay rows.

Two ways to run it (same modes as ingest.py/ingest_stepzero.py):

  python ingestion/patch_dim_geo_stepzero_gap.py --database-url "$DATABASE_URL"
  python ingestion/patch_dim_geo_stepzero_gap.py --emit-sql-dir ingestion/_sql_patch_psgc_gap --dataset-id N

Either mode writes a QA report to ingestion/_qa_report_patch_psgc_gap.json.
"""

import argparse
import json
from pathlib import Path

import pandas as pd

from ingest import batched, insert_statement, nullable_int, pad

REPO_ROOT = Path(__file__).resolve().parent.parent
XLSX_PATH = REPO_ROOT / "ingestion" / "data" / "bhw_connect_stepzero.xlsx"
PARQUET_PATH = REPO_ROOT / "ingestion" / "data" / "dataset.parquet"
QA_REPORT_PATH = REPO_ROOT / "ingestion" / "_qa_report_patch_psgc_gap.json"

STEPZERO_SLUG = "bhw-stepzero-2026"
PSGC_VINTAGE_TAG = "stepzero_only_v1: no bhw-2025 profile rows as of the 2025 snapshot"

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
STEPZERO_COLUMNS = [
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
BATCH_SIZE = 500


def load_parquet_geo():
    pq = pd.read_parquet(
        PARQUET_PATH,
        columns=["REGION CODE", "PROVINCE CODE", "CITY/MUN CODE", "BARANGAY CODE", "CITY/MUN NAME"],
    )
    known = {
        "region": {pad(v, 2) for v in pq["REGION CODE"].unique()},
        "province": {pad(v, 5) for v in pq["PROVINCE CODE"].unique()},
        "citymun": {pad(v, 7) for v in pq["CITY/MUN CODE"].unique()},
        "barangay": {pad(v, 10) for v in pq["BARANGAY CODE"].unique()},
    }
    return known


def load_dim_geo_barangay_names_by_citymun():
    """geo_name set already in dim_geo for each citymun code - used to detect a
    same-name barangay under a different code (likely renumbering, not new)."""
    from ingest import build_dim_geo  # local import: only needed for this check

    pq = pd.read_parquet(PARQUET_PATH)
    rows = build_dim_geo(pq)
    by_citymun = {}
    for r in rows:
        if r["geo_level"] != "barangay":
            continue
        by_citymun.setdefault(r["citymun_code"], set()).add(r["geo_name"].strip().upper())
    return by_citymun


def load_sheet():
    df = pd.read_excel(XLSX_PATH, sheet_name=0)
    df.columns = [c.strip() for c in df.columns]
    df["REGION_PAD"] = df["REGION CODE"].apply(lambda v: pad(v, 2))
    df["PROV_PAD"] = df["PROV CODE"].apply(lambda v: pad(v, 5))
    df["CITYMUN_PAD"] = df["CITYMUN CODE"].apply(lambda v: pad(v, 7))
    df["BGY_PAD"] = df["BGY CODE"].apply(lambda v: pad(v, 10))
    return df


def counts_row(dataset_id, geo_code, geo_level, n_registered, n_registered_accredited, n_non_registered, population, households):
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


def build_patch(df, known, dim_geo_names_by_citymun, dataset_id, qa):
    # --- 1. The 12 missing citymuns: one dim_geo row each, first-seen name/parents. ---
    citymun_first = df.drop_duplicates(subset="CITYMUN_PAD", keep="first")
    missing_citymuns = citymun_first[~citymun_first["CITYMUN_PAD"].isin(known["citymun"])]
    assert set(missing_citymuns["PROV_PAD"]).issubset(known["province"]), "a missing citymun's province isn't in dim_geo - unexpected, stop and investigate"

    new_citymun_geo_rows = []
    for d in missing_citymuns.to_dict(orient="records"):
        new_citymun_geo_rows.append(
            {
                "geo_code": d["CITYMUN_PAD"],
                "geo_level": "citymun",
                "geo_name": d["CITYMUN NAME"],
                "parent_code": d["PROV_PAD"],
                "region_code": d["REGION_PAD"],
                "province_code": d["PROV_PAD"],
                "citymun_code": d["CITYMUN_PAD"],
                "income_class": None,
                "psgc_vintage": PSGC_VINTAGE_TAG,
            }
        )
    new_citymun_codes = {r["geo_code"] for r in new_citymun_geo_rows}
    qa["new_citymuns"] = sorted(new_citymun_codes)

    # --- 2. Unmatched barangays: exclude ones whose name already exists in dim_geo
    #     under the same (already-known) citymun - those are likely the same place
    #     under a different/renumbered code, not a genuinely new one. ---
    unmatched_bgy = df[~df["BGY_PAD"].isin(known["barangay"])].drop_duplicates(subset="BGY_PAD", keep="first")

    def is_name_collision(row):
        if row["CITYMUN_PAD"] in new_citymun_codes:
            return False  # brand-new citymun: no existing dim_geo barangays to collide with
        names = dim_geo_names_by_citymun.get(row["CITYMUN_PAD"], set())
        return row["BGY NAME"].strip().upper() in names

    unmatched_bgy = unmatched_bgy.copy()
    unmatched_bgy["name_collision"] = unmatched_bgy.apply(is_name_collision, axis=1)
    collisions = unmatched_bgy[unmatched_bgy["name_collision"]]
    to_insert = unmatched_bgy[~unmatched_bgy["name_collision"]]

    qa["barangay_name_collisions_excluded"] = collisions[
        ["BGY_PAD", "BGY NAME", "CITYMUN_PAD", "CITYMUN NAME"]
    ].to_dict(orient="records")

    new_barangay_geo_rows = []
    for d in to_insert.to_dict(orient="records"):
        new_barangay_geo_rows.append(
            {
                "geo_code": d["BGY_PAD"],
                "geo_level": "barangay",
                "geo_name": d["BGY NAME"],
                "parent_code": d["CITYMUN_PAD"],
                "region_code": d["REGION_PAD"],
                "province_code": d["PROV_PAD"],
                "citymun_code": d["CITYMUN_PAD"],
                "income_class": None,
                "psgc_vintage": PSGC_VINTAGE_TAG,
            }
        )
    new_barangay_codes = {r["geo_code"] for r in new_barangay_geo_rows}
    qa["new_citymun_count"] = len(new_citymun_geo_rows)
    qa["new_barangay_count"] = len(new_barangay_geo_rows)
    qa["excluded_collision_count"] = len(collisions)

    dim_geo_rows = new_citymun_geo_rows + new_barangay_geo_rows

    # --- 3. agg_bhw_stepzero_counts rows for exactly the newly-unblocked codes. ---
    stepzero_rows = []
    for d in to_insert.to_dict(orient="records"):
        stepzero_rows.append(
            counts_row(
                dataset_id,
                d["BGY_PAD"],
                "barangay",
                d["REGISTERED"],
                d["REGISTERED & ACCREDITED"],
                d["NON-REGISTERED"],
                d["POPULATION"],
                d["HOUSEHOLDS"],
            )
        )

    # Citymun-level rollup sums ALL sheet rows under that citymun (including the
    # excluded-from-dim_geo collision barangays) - same convention as
    # ingest_stepzero.py's build_rollup_rows, so the citymun total isn't deflated.
    citymun_group = (
        df[df["CITYMUN_PAD"].isin(new_citymun_codes)]
        .groupby("CITYMUN_PAD", as_index=False)
        .agg(
            REGISTERED=("REGISTERED", "sum"),
            REGISTERED_ACCREDITED=("REGISTERED & ACCREDITED", "sum"),
            NON_REGISTERED=("NON-REGISTERED", "sum"),
            POPULATION=("POPULATION", "sum"),
            HOUSEHOLDS=("HOUSEHOLDS", "sum"),
        )
    )
    for d in citymun_group.to_dict(orient="records"):
        stepzero_rows.append(
            counts_row(
                dataset_id,
                d["CITYMUN_PAD"],
                "citymun",
                d["REGISTERED"],
                d["REGISTERED_ACCREDITED"],
                d["NON_REGISTERED"],
                d["POPULATION"],
                d["HOUSEHOLDS"],
            )
        )

    qa["stepzero_rows_to_insert"] = len(stepzero_rows)
    return dim_geo_rows, stepzero_rows


def emit_sql_files(table, columns, rows, out_dir: Path, start_index=0):
    n = start_index
    for chunk in batched(rows, BATCH_SIZE):
        n += 1
        path = out_dir / f"{n:04d}_{table}.sql"
        path.write_text(insert_statement(table, columns, chunk))
    return n


def run_via_psycopg2(database_url, dim_geo_rows, stepzero_rows):
    import psycopg2

    conn = psycopg2.connect(database_url)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            for chunk in batched(dim_geo_rows, BATCH_SIZE):
                cur.execute(insert_statement("dim_geo", DIM_GEO_COLUMNS, chunk))
            for chunk in batched(stepzero_rows, BATCH_SIZE):
                cur.execute(insert_statement("agg_bhw_stepzero_counts", STEPZERO_COLUMNS, chunk))
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
        "(required with --emit-sql-dir; --database-url mode looks this up itself).",
    )
    args = parser.parse_args()

    if not args.database_url and not args.emit_sql_dir:
        parser.error("pass --database-url or --emit-sql-dir")
    if args.emit_sql_dir and not args.dataset_id:
        parser.error("--emit-sql-dir requires --dataset-id")

    known = load_parquet_geo()
    dim_geo_names_by_citymun = load_dim_geo_barangay_names_by_citymun()
    df = load_sheet()

    qa = {"source_file": str(XLSX_PATH.relative_to(REPO_ROOT)), "dataset_slug": STEPZERO_SLUG}

    dataset_id = args.dataset_id
    if args.database_url:
        import psycopg2

        conn = psycopg2.connect(args.database_url)
        with conn, conn.cursor() as cur:
            cur.execute("select dataset_id from dim_dataset where slug = %s", (STEPZERO_SLUG,))
            row = cur.fetchone()
            if row is None:
                raise SystemExit(f"dim_dataset row for slug={STEPZERO_SLUG!r} not found")
            dataset_id = row[0]

    dim_geo_rows, stepzero_rows = build_patch(df, known, dim_geo_names_by_citymun, dataset_id, qa)

    if args.emit_sql_dir:
        out_dir = Path(args.emit_sql_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        n_geo = emit_sql_files("dim_geo", DIM_GEO_COLUMNS, dim_geo_rows, out_dir)
        emit_sql_files("agg_bhw_stepzero_counts", STEPZERO_COLUMNS, stepzero_rows, out_dir, n_geo)
        print(f"Wrote SQL batch files to {out_dir}")
    else:
        run_via_psycopg2(args.database_url, dim_geo_rows, stepzero_rows)
        print("Applied directly via --database-url")

    QA_REPORT_PATH.write_text(json.dumps(qa, indent=2, default=str))
    print(f"QA report written to {QA_REPORT_PATH}")
    print(json.dumps({k: v for k, v in qa.items() if k != "barangay_name_collisions_excluded"}, indent=2, default=str))


if __name__ == "__main__":
    main()
