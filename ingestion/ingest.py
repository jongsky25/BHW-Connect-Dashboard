#!/usr/bin/env python3
"""Parquet -> Postgres ingestion pipeline (BUILD_PLAN.md §6, increment 0.4).

Loads ingestion/data/dataset.parquet into dim_geo, fact_bhw_raw, and
fact_honorarium, following the reconciliation/parsing rules in BUILD_PLAN.md §3.

Two ways to run it:

  # Direct execution against Postgres (needs the transaction-pooler DATABASE_URL,
  # port 6543, and psycopg2 installed):
  python ingestion/ingest.py --database-url "$DATABASE_URL"

  # Emit batched .sql files instead of connecting to a database (for environments
  # without a direct DB connection - e.g. sandboxes where only an HTTP-based SQL
  # execution tool is available). Each file is a single self-contained statement
  # that can be run independently and in order.
  python ingestion/ingest.py --emit-sql-dir ingestion/_sql_batches

Either mode also writes a QA report to ingestion/_qa_report.json.
"""

import argparse
import json
import math
import re
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
PARQUET_PATH = REPO_ROOT / "ingestion" / "data" / "dataset.parquet"
QA_REPORT_PATH = REPO_ROOT / "ingestion" / "_qa_report.json"

DATASET_SLUG = "bhw-2025"

FREQUENCY_MAP = {
    "Monthly": "monthly",
    "Quarterly": "quarterly",
    "Semi-Annual": "semi_annual",
    "Annually": "annual",
}

HONORARIUM_LEVELS = [
    ("REGION", "region"),
    ("PROVINCE", "province"),
    ("CITY/MUNICIPALITY", "citymun"),
    ("BARANGAY", "barangay"),
]

OTHERS_TOPIC_COLUMN = "TRAINING: Others please specify"
OTHERS_DETAILS_COLUMN = "TRAINING DETAILS: Others please specify"


def slugify(label: str) -> str:
    s = label.lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_")


def training_topics(columns):
    topics = []
    for col in columns:
        if not col.startswith("TRAINING: "):
            continue
        label = col[len("TRAINING: ") :]
        topics.append((col, slugify(label), label))
    return topics


def pad(value, width) -> str:
    return str(int(value)).zfill(width)


def parse_year_list(value):
    if value is None or (isinstance(value, float) and math.isnan(value)) or value == "":
        return None, False
    years = []
    unparseable = False
    for part in str(value).split(","):
        part = part.strip()
        if not part:
            continue
        try:
            years.append(int(part))
        except ValueError:
            unparseable = True
    return (years or None), unparseable


def nullable_int(value):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    return int(value)


def sql_literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, float) and math.isnan(value):
        return "NULL"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, list):
        if not value:
            return "NULL"
        return "ARRAY[" + ",".join(str(int(v)) for v in value) + "]::smallint[]"
    if isinstance(value, dict):
        return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"
    return "'" + str(value).replace("'", "''") + "'"


def insert_statement(table, columns, rows, overriding_system_value=False):
    col_list = ", ".join(columns)
    values = ",\n".join(
        "(" + ", ".join(sql_literal(row.get(c)) for c in columns) + ")" for row in rows
    )
    overriding = " OVERRIDING SYSTEM VALUE" if overriding_system_value else ""
    return f"INSERT INTO {table} ({col_list}){overriding} VALUES\n{values};\n"


def build_dim_geo(df):
    rows = [
        {
            "geo_code": "PH",
            "geo_level": "national",
            "geo_name": "Philippines",
            "parent_code": None,
            "region_code": None,
            "province_code": None,
            "citymun_code": None,
            "income_class": None,
            "psgc_vintage": None,
        }
    ]

    regions = df[["REGION CODE", "REGION NAME"]].drop_duplicates()
    for _, r in regions.iterrows():
        code = pad(r["REGION CODE"], 2)
        rows.append(
            {
                "geo_code": code,
                "geo_level": "region",
                "geo_name": r["REGION NAME"],
                "parent_code": "PH",
                "region_code": code,
                "province_code": None,
                "citymun_code": None,
                "income_class": None,
                "psgc_vintage": "2023 series (>=2024 release, includes NIR)",
            }
        )

    provinces = df[["PROVINCE CODE", "PROVINCE NAME", "REGION CODE"]].drop_duplicates()
    for _, r in provinces.iterrows():
        code = pad(r["PROVINCE CODE"], 5)
        region_code = pad(r["REGION CODE"], 2)
        rows.append(
            {
                "geo_code": code,
                "geo_level": "province",
                "geo_name": r["PROVINCE NAME"],
                "parent_code": region_code,
                "region_code": region_code,
                "province_code": code,
                "citymun_code": None,
                "income_class": None,
                "psgc_vintage": "2023 series (>=2024 release, includes NIR)",
            }
        )

    citymuns = df[
        ["CITY/MUN CODE", "CITY/MUN NAME", "PROVINCE CODE", "REGION CODE", "INCOME CLASS"]
    ].drop_duplicates()
    for _, r in citymuns.iterrows():
        code = pad(r["CITY/MUN CODE"], 7)
        province_code = pad(r["PROVINCE CODE"], 5)
        region_code = pad(r["REGION CODE"], 2)
        rows.append(
            {
                "geo_code": code,
                "geo_level": "citymun",
                "geo_name": r["CITY/MUN NAME"],
                "parent_code": province_code,
                "region_code": region_code,
                "province_code": province_code,
                "citymun_code": code,
                "income_class": nullable_int(r["INCOME CLASS"]),
                "psgc_vintage": "2023 series (>=2024 release, includes NIR)",
            }
        )

    barangays = df[
        [
            "BARANGAY CODE",
            "BARANGAY NAME",
            "CITY/MUN CODE",
            "PROVINCE CODE",
            "REGION CODE",
            "INCOME CLASS",
        ]
    ].drop_duplicates()
    for _, r in barangays.iterrows():
        code = pad(r["BARANGAY CODE"], 10)
        citymun_code = pad(r["CITY/MUN CODE"], 7)
        province_code = pad(r["PROVINCE CODE"], 5)
        region_code = pad(r["REGION CODE"], 2)
        rows.append(
            {
                "geo_code": code,
                "geo_level": "barangay",
                "geo_name": r["BARANGAY NAME"],
                "parent_code": citymun_code,
                "region_code": region_code,
                "province_code": province_code,
                "citymun_code": citymun_code,
                "income_class": nullable_int(r["INCOME CLASS"]),
                "psgc_vintage": "2023 series (>=2024 release, includes NIR)",
            }
        )

    return rows


def build_fact_bhw_raw(df, topics, ingestion_batch_id, qa):
    rows = []
    unparseable_active = 0
    unparseable_inactive = 0

    for i, d in enumerate(df.to_dict(orient="records"), start=1):
        active_years, bad_active = parse_year_list(d["ACTIVE YEARS OF SERVICE"])
        inactive_years, bad_inactive = parse_year_list(d["INACTIVE YEARS OF SERVICE"])
        if bad_active:
            unparseable_active += 1
        if bad_inactive:
            unparseable_inactive += 1

        training = {}
        for col, slug, _label in topics:
            if d.get(col) == "YES":
                entry = {"trained": True, "year": nullable_int(d.get(f"TRAINING YEAR: {col[len('TRAINING: '):]}"))}
                if col == OTHERS_TOPIC_COLUMN:
                    details = d.get(OTHERS_DETAILS_COLUMN)
                    if isinstance(details, str) and details.strip():
                        entry["details"] = details.strip()
                training[slug] = entry

        rows.append(
            {
                "bhw_id": i,
                "geo_code": pad(d["BARANGAY CODE"], 10),
                "sex": d["SEX"],
                "civil_status": d["CIVIL STATUS"],
                "age": nullable_int(d["AGE"]),
                "bloodtype": d["BLOODTYPE"],
                "educational_attainment": d["EDUCATIONAL ATTAINMENT"],
                "ip_status": d["IP"],
                "household": nullable_int(d["HOUSEHOLD"]),
                "registered_year": nullable_int(d["REGISTERED YEAR"]),
                "accredited": d["ACCREDITED BHW"] == "YES",
                "accreditation_year": nullable_int(d["ACCREDITATION YEAR"]),
                "tesda_nc2": d["TESDA BHS NC II"] == "YES",
                "tesda_nc2_year": nullable_int(d["TESDA BHS NC II YEAR"]),
                "tesda_certified": d["TESDA BHS NC II CERTIFIED"] == "YES",
                "tesda_certified_year": nullable_int(d["TESDA BHS NC II CERTIFIED YEAR"]),
                "ref_manual_trained": d["BHW REFERENCE MANUAL TRAINING"] == "YES",
                "ref_manual_year": nullable_int(d["BHW REFERENCE MANUAL TRAINING YEAR"]),
                "active_years": active_years,
                "active_years_count": len(active_years) if active_years else None,
                "first_active_year": min(active_years) if active_years else None,
                "last_active_year": max(active_years) if active_years else None,
                "inactive_years": inactive_years,
                "inactive_years_count": len(inactive_years) if inactive_years else None,
                "training": training or None,
                "ingestion_batch_id": ingestion_batch_id,
            }
        )

    qa["unparseable_active_years"] = unparseable_active
    qa["unparseable_inactive_years"] = unparseable_inactive
    return rows


def build_fact_honorarium(df, qa):
    rows = []
    exceptions = []

    for i, d in enumerate(df.to_dict(orient="records"), start=1):
        for prefix, level in HONORARIUM_LEVELS:
            flag = d[f"HONORARIUM: {prefix}"] == "YES"
            amount = d[f"HONORARIUM AMOUNT: {prefix}"]
            amount = None if (amount is None or (isinstance(amount, float) and math.isnan(amount))) else float(amount)
            has_amount = bool(amount and amount > 0)
            receives = flag or has_amount

            if flag != has_amount:
                exceptions.append(
                    {"bhw_id": i, "payer_level": level, "flag": flag, "amount": amount}
                )

            if not receives:
                continue

            raw_freq = d[f"HONORARIUM FREQUENCY: {prefix}"]
            frequency = FREQUENCY_MAP.get(raw_freq) if isinstance(raw_freq, str) else None
            if isinstance(raw_freq, str) and raw_freq not in FREQUENCY_MAP:
                frequency = "other"

            normalized = None
            if amount is not None:
                if frequency == "monthly":
                    normalized = amount
                elif frequency == "quarterly":
                    normalized = amount / 3
                elif frequency == "semi_annual":
                    normalized = amount / 6
                elif frequency == "annual":
                    normalized = amount / 12

            rows.append(
                {
                    "bhw_id": i,
                    "payer_level": level,
                    "receives": True,
                    "amount": amount,
                    "frequency": frequency,
                    "normalized_monthly_amount": normalized,
                    "source_note": (
                        f"reconciled: flag={flag} amount={amount}"
                        if flag != has_amount
                        else None
                    ),
                }
            )

    qa["honorarium_flag_amount_mismatches"] = len(exceptions)
    qa["honorarium_exceptions_sample"] = exceptions[:50]
    return rows


def batched(rows, size):
    for i in range(0, len(rows), size):
        yield rows[i : i + size]


TABLE_SPECS = {
    "dim_geo": {
        "columns": [
            "geo_code",
            "geo_level",
            "geo_name",
            "parent_code",
            "region_code",
            "province_code",
            "citymun_code",
            "income_class",
            "psgc_vintage",
        ],
        "batch_size": 5000,
        "overriding": False,
    },
    "fact_bhw_raw": {
        "columns": [
            "bhw_id",
            "geo_code",
            "sex",
            "civil_status",
            "age",
            "bloodtype",
            "educational_attainment",
            "ip_status",
            "household",
            "registered_year",
            "accredited",
            "accreditation_year",
            "tesda_nc2",
            "tesda_nc2_year",
            "tesda_certified",
            "tesda_certified_year",
            "ref_manual_trained",
            "ref_manual_year",
            "active_years",
            "active_years_count",
            "first_active_year",
            "last_active_year",
            "inactive_years",
            "inactive_years_count",
            "training",
            "ingestion_batch_id",
        ],
        "batch_size": 2000,
        "overriding": True,
    },
    "fact_honorarium": {
        "columns": [
            "bhw_id",
            "payer_level",
            "receives",
            "amount",
            "frequency",
            "normalized_monthly_amount",
            "source_note",
        ],
        "batch_size": 5000,
        "overriding": False,
    },
}


def emit_sql_files(table, rows, out_dir: Path, start_index=0):
    spec = TABLE_SPECS[table]
    n = start_index
    for chunk in batched(rows, spec["batch_size"]):
        n += 1
        path = out_dir / f"{n:04d}_{table}.sql"
        path.write_text(insert_statement(table, spec["columns"], chunk, spec["overriding"]))
    return n


def run_via_psycopg2(database_url, dim_geo_rows, bhw_rows, honorarium_rows, ingestion_batch_id):
    import psycopg2

    conn = psycopg2.connect(database_url)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            for table, rows in (
                ("dim_geo", dim_geo_rows),
                ("fact_bhw_raw", bhw_rows),
                ("fact_honorarium", honorarium_rows),
            ):
                spec = TABLE_SPECS[table]
                for chunk in batched(rows, spec["batch_size"]):
                    cur.execute(insert_statement(table, spec["columns"], chunk, spec["overriding"]))
            cur.execute(
                "select setval(pg_get_serial_sequence('fact_bhw_raw','bhw_id'), "
                "(select coalesce(max(bhw_id), 1) from fact_bhw_raw));"
            )
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
        "--ingestion-batch-id",
        type=int,
        help="Pre-existing ingestion_batches.batch_id to attach fact_bhw_raw rows to "
        "(required with --emit-sql-dir, since that mode can't INSERT ... RETURNING itself)",
    )
    args = parser.parse_args()

    if not args.database_url and not args.emit_sql_dir:
        parser.error("pass --database-url or --emit-sql-dir")
    if args.emit_sql_dir and not args.ingestion_batch_id:
        parser.error("--emit-sql-dir requires --ingestion-batch-id")

    df = pd.read_parquet(PARQUET_PATH)
    topics = training_topics(df.columns)

    qa = {
        "source_file": str(PARQUET_PATH.relative_to(REPO_ROOT)),
        "input_rows": len(df),
        "dataset_slug": DATASET_SLUG,
        "geo_counts": {
            "region": df["REGION CODE"].nunique(),
            "province": df["PROVINCE CODE"].nunique(),
            "citymun": df["CITY/MUN CODE"].nunique(),
            "barangay": df["BARANGAY CODE"].nunique(),
        },
        "null_profile": {c: int(df[c].isna().sum()) for c in df.columns},
    }

    dim_geo_rows = build_dim_geo(df)
    qa["dim_geo_rows"] = len(dim_geo_rows)

    if args.emit_sql_dir:
        ingestion_batch_id = args.ingestion_batch_id
        bhw_rows = build_fact_bhw_raw(df, topics, ingestion_batch_id, qa)
        honorarium_rows = build_fact_honorarium(df, qa)
        qa["fact_bhw_raw_rows"] = len(bhw_rows)
        qa["fact_honorarium_rows"] = len(honorarium_rows)

        out_dir = Path(args.emit_sql_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        n = 0
        n = emit_sql_files("dim_geo", dim_geo_rows, out_dir, n)
        n = emit_sql_files("fact_bhw_raw", bhw_rows, out_dir, n)
        n = emit_sql_files("fact_honorarium", honorarium_rows, out_dir, n)
        print(f"Wrote {n} batch file(s) to {out_dir}")
    else:
        # Direct mode creates its own ingestion_batches row first.
        import psycopg2

        conn = psycopg2.connect(args.database_url)
        with conn, conn.cursor() as cur:
            cur.execute(
                "insert into ingestion_batches (source_file) values (%s) returning batch_id",
                (str(PARQUET_PATH.relative_to(REPO_ROOT)),),
            )
            ingestion_batch_id = cur.fetchone()[0]
        conn.close()

        bhw_rows = build_fact_bhw_raw(df, topics, ingestion_batch_id, qa)
        honorarium_rows = build_fact_honorarium(df, qa)
        qa["fact_bhw_raw_rows"] = len(bhw_rows)
        qa["fact_honorarium_rows"] = len(honorarium_rows)

        run_via_psycopg2(args.database_url, dim_geo_rows, bhw_rows, honorarium_rows, ingestion_batch_id)

        conn = psycopg2.connect(args.database_url)
        with conn, conn.cursor() as cur:
            cur.execute(
                "update ingestion_batches set finished_at = now(), row_counts = %s, qa_report = %s "
                "where batch_id = %s",
                (json.dumps(qa["geo_counts"] | {"fact_bhw_raw": qa["fact_bhw_raw_rows"]}), json.dumps(qa), ingestion_batch_id),
            )
        conn.close()

    QA_REPORT_PATH.write_text(json.dumps(qa, indent=2, default=str))
    print(f"QA report written to {QA_REPORT_PATH}")
    print(json.dumps({k: v for k, v in qa.items() if k != "null_profile"}, indent=2, default=str))


if __name__ == "__main__":
    main()
