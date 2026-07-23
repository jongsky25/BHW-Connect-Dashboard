#!/usr/bin/env python3
"""xlsx -> seed SQL generator for the 2026 BHW Connect Profiling Status dataset.

Reads one or more "Encoding Status - <Region>.xlsx" sheets (one row per city/municipality:
REGISTERED / ACCREDITED / UNREGISTERED headcounts plus the five encoding-pipeline buckets
DRAFTED / FOR_VALIDATION / BACK_TO_ENCODER / VALIDATED / APPROVED) and emits an idempotent
seed migration for agg_bhw_profiling_status at every geo level (city/municipality rows plus
province / region / national rollups).

This mirrors ingestion/ingest_stepzero.py: rollups are summed on the sheet's OWN PSGC code
columns (regcode / provcode / citycode) - dim_geo is only consulted to validate that each
geo_code exists before it is written, since agg_bhw_profiling_status.geo_code is a dim_geo
foreign key. n_total_bhw = registered + accredited + unregistered (the 2026 denominator:
the stated goal is to profile every BHW this year, so - unlike the 2025 datasets -
non-registered BHWs are inside the base, not outside it).

The five pipeline buckets are the mutually-exclusive current status of each record; the
Encode/Validate/Certify funnel (Encode = all five, Validate = validated + approved, Certify
= approved) is derived in the read layer (lib/db/profiling-status.ts), not stored here.

Usage:

  # National load (current): every region, from the grouped-by-citymun export. Four City-of-
  # Manila districts (1380602/1380607/1380608/1380609) are absent from dim_geo and all-zero in
  # the source, so they're excluded at the citymun level (still counted in the rollups).
  python ingestion/ingest_encoding_status.py \
      --src ingestion/data/encoding_status_national.csv \
      --out supabase/migrations/20260723010000_seed_bhw_profiling_status_national.sql \
      --exclude 1380602,1380607,1380608,1380609

  # A single region: pass its sheet and a new migration path; the on-conflict upsert means
  # re-running is safe and geos simply upsert their own rows.

The source may be .xlsx or .csv (both carry the same columns). The committed sources ship as
.csv (encoding_status_region08.csv, encoding_status_national.csv); pass an .xlsx directly if
that is what you receive. Use --exclude for citymun codes absent from dim_geo (they'd violate
the geo_code FK); their counts still roll up because the rollups sum the full sheet.
"""

import argparse
from pathlib import Path

import pandas as pd

from ingest import pad

DATASET_SLUG = "bhw-profiling-status-2026"
TABLE = "agg_bhw_profiling_status"

# The eight count columns, in sheet order (total_stepzero, a 0/1 flag, is ignored).
COUNT_COLS = [
    "registered",
    "accredited",
    "unregistered",
    "drafted",
    "for_validation",
    "back_to_encoder",
    "validated",
    "approved",
]

# Insert-column order for the emitted SQL.
INSERT_COLS = [
    "n_registered",
    "n_accredited",
    "n_unregistered",
    "n_total_bhw",
    "n_drafted",
    "n_for_validation",
    "n_back_to_encoder",
    "n_validated",
    "n_approved",
]


def load_source(src_path: Path) -> pd.DataFrame:
    if src_path.suffix.lower() == ".csv":
        df = pd.read_csv(src_path, dtype=str)
    else:
        df = pd.read_excel(src_path, sheet_name=0, dtype=str)
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    for c in COUNT_COLS:
        df[c] = df[c].fillna(0).astype(int)
    # Preserve leading zeros on PSGC codes.
    df["regcode"] = df["regcode"].map(lambda v: pad(v, 2))
    df["provcode"] = df["provcode"].map(lambda v: pad(v, 5))
    df["citycode"] = df["citycode"].map(lambda v: pad(v, 7))
    return df


def counts(row_like) -> dict:
    reg = int(row_like["registered"])
    acc = int(row_like["accredited"])
    unreg = int(row_like["unregistered"])
    return {
        "n_registered": reg,
        "n_accredited": acc,
        "n_unregistered": unreg,
        "n_total_bhw": reg + acc + unreg,
        "n_drafted": int(row_like["drafted"]),
        "n_for_validation": int(row_like["for_validation"]),
        "n_back_to_encoder": int(row_like["back_to_encoder"]),
        "n_validated": int(row_like["validated"]),
        "n_approved": int(row_like["approved"]),
    }


def rollup(df: pd.DataFrame, group_col: str, code_width: int, geo_level: str) -> list:
    grouped = df.groupby(group_col, as_index=False)[COUNT_COLS].sum()
    rows = []
    for d in grouped.to_dict(orient="records"):
        rows.append((pad(d[group_col], code_width), geo_level, counts(d)))
    return rows


def build_rows(df: pd.DataFrame, exclude: set[str] | None = None) -> list:
    exclude = exclude or set()
    rows = []
    # National (PH) — sum of everything on the sheet. Rollups are computed from the FULL
    # sheet (including any `exclude`d citymuns), so excluding a citymun row never changes a
    # province/region/national total — it only omits that one citymun-level row.
    national = df[COUNT_COLS].sum()
    rows.append(("PH", "national", counts(national)))
    # Region / province rollups on the sheet's own code columns.
    rows += rollup(df, "regcode", 2, "region")
    rows += rollup(df, "provcode", 5, "province")
    # City/municipality — each sheet row as-is, minus any excluded codes. `exclude` is for
    # citymun codes the sheet reports but `dim_geo` doesn't have (agg_bhw_profiling_status.
    # geo_code is a dim_geo FK), mirroring ingest_stepzero.py's "skip unmatched citymun, keep
    # in rollups" handling.
    for d in df.to_dict(orient="records"):
        if pad(d["citycode"], 7) in exclude:
            continue
        rows.append((d["citycode"], "citymun", counts(d)))
    return rows


def emit_sql(rows: list) -> str:
    header = (
        "-- Seed agg_bhw_profiling_status with the 2026 BHW Connect encoding-status data.\n"
        "--\n"
        "-- Generated by ingestion/ingest_encoding_status.py from the DOH BHW Connect encoding-\n"
        "-- status sheet(s). Rows are seeded at every geo level: each city/municipality is its own\n"
        "-- row; province, region and national rows are sums of their city/municipality rows.\n"
        "-- n_total_bhw = registered + accredited + unregistered (the 2026 denominator). Idempotent:\n"
        "-- re-running updates in place, and future regions append.\n\n"
        "with ds as (\n"
        f"  select dataset_id from dim_dataset where slug = '{DATASET_SLUG}'\n"
        ")\n"
        f"insert into {TABLE} (\n"
        "  dataset_id, geo_code, geo_level,\n"
        "  n_registered, n_accredited, n_unregistered, n_total_bhw,\n"
        "  n_drafted, n_for_validation, n_back_to_encoder, n_validated, n_approved\n"
        ") values\n"
    )
    lines = []
    for geo_code, geo_level, c in rows:
        vals = ", ".join(str(c[col]) for col in INSERT_COLS)
        lines.append(
            f"  ((select dataset_id from ds), '{geo_code}', '{geo_level}', {vals})"
        )
    footer = (
        "\non conflict (dataset_id, geo_code, geo_level) do update set\n"
        "  n_registered = excluded.n_registered,\n"
        "  n_accredited = excluded.n_accredited,\n"
        "  n_unregistered = excluded.n_unregistered,\n"
        "  n_total_bhw = excluded.n_total_bhw,\n"
        "  n_drafted = excluded.n_drafted,\n"
        "  n_for_validation = excluded.n_for_validation,\n"
        "  n_back_to_encoder = excluded.n_back_to_encoder,\n"
        "  n_validated = excluded.n_validated,\n"
        "  n_approved = excluded.n_approved;\n"
    )
    return header + ",\n".join(lines) + footer


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", required=True, help="Path to the encoding-status sheet (.xlsx or .csv)")
    parser.add_argument("--out", required=True, help="Path to write the seed .sql migration")
    parser.add_argument(
        "--exclude",
        default="",
        help="Comma-separated citymun geo_codes to omit at the citymun level (e.g. codes absent "
        "from dim_geo). They stay in the province/region/national rollups.",
    )
    args = parser.parse_args()

    exclude = {pad(c, 7) for c in args.exclude.split(",") if c.strip()}
    df = load_source(Path(args.src))
    rows = build_rows(df, exclude)
    sql = emit_sql(rows)
    Path(args.out).write_text(sql)
    n_city = sum(1 for _, lvl, _ in rows if lvl == "citymun")
    print(
        f"Wrote {args.out}: {len(rows)} rows ({n_city} city/municipalities + rollups"
        f"{f', {len(exclude)} citymun excluded' if exclude else ''})"
    )


if __name__ == "__main__":
    main()
