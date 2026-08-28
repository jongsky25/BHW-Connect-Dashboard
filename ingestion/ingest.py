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

  # Exercise the profiling hook's pure logic without a database or a source file:
  python ingestion/ingest.py --selftest

Either mode also writes a QA report to ingestion/_qa_report.json.

After a direct-mode load commits, the pipeline profiles the tables it just wrote into the
dataset registry (`profile_dataset()`, AI_ASSISTANT_PLAN.md §8 Increment 4.1) so a newly loaded
table is queryable by the internal assistant without a code change. That pass can never fail the
load; see the header above PROFILE_TARGETS for what it does, refuses and records.
"""

import argparse
import ast
import json
import math
import re
import sys
from decimal import Decimal
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


# ---------------------------------------------------------------------------------------------
# Ingest-time profiling (docs/AI_ASSISTANT_PLAN.md §8, Increment 4.1)
# ---------------------------------------------------------------------------------------------
#
# 4.1 built `profile_dataset()` and proved the plan's success condition with it, but left the call
# out of this file on purpose: the line could not be run in that session — no database credentials
# and no source extract — and "typed and unrun is not a safety property". This is that line, and
# the run behind it (see DECISIONS.md, 2026-08-28).
#
# WHY THE HOOK BELONGS HERE AND NOWHERE ELSE. §3 makes ingest-time understanding load-bearing:
# `queryDataset` reads the registry, so a table with no registry row is invisible to every tool the
# assistant has. Ingest is the one moment when the rows that need describing have just arrived and
# the process describing them is already connected to the database — which is also 4.1's argument
# for why the pass calls no provider: a profiling pass that cannot run without an API key would not
# run at ingest time, which is the one time it has to.
#
# A REGISTRY PASS MUST NOT BE ABLE TO LOSE A GOOD LOAD. A load that succeeds and a profile that
# fails is not the same event as a failed load, and the exit code must not conflate them. So:
#
#   * the hook runs *after* `run_via_psycopg2()` has committed, on its own connection, so no
#     failure here can roll back the facts;
#   * each table is profiled in its own transaction (`autocommit`), so a refusal or an error on one
#     table cannot poison the next;
#   * a failure is recorded in the QA report — which is written to `ingestion_batches.qa_report`,
#     so it is durable in the database rather than only in a terminal someone may not be watching —
#     printed as a warning, and **does not change the exit status**.
#
# That last choice is the arguable one, so: the load is the expensive, irreversible half and the
# profile is a cheap catch-up that any operator can run by hand as
# `select * from profile_dataset('<table>')`. A failed profile leaves the database in exactly the
# state 4.1 shipped — the dataset is simply not registered yet — which is the status quo, not a
# corruption. Exiting non-zero would report a successful load as a failed one, and the obvious
# response to a failed ingest is to run the ingest again.
#
# IDEMPOTENCE: THE HOOK NEVER FORCES. `profile_dataset()` refuses a table whose registry row is
# already `approved` unless called with `p_force`, and that refusal is the whole safety property
# here. Measured on a local Postgres 16 against the committed migration: with `p_force => true` a
# re-profile sets the registry row and every column row back to `status = 'auto'`. The reviewer's
# `meaning` text survives — the function lifts approved meanings forward — but their *approval*
# does not, and `lib/db/dataset-registry.ts` filters both tables to `approved`. A forcing hook
# would therefore make a reviewed dataset silently vanish from the assistant on the next re-load.
# So the hook calls the function at its default and treats the refusal as success: re-profiling an
# approved dictionary is a reviewer's decision, never a side effect of re-running ingest.
#
# Re-loading is otherwise safe. `dataset_registry` upserts on `table_name` and the column
# dictionary is replaced rather than appended to, so profiling the same table three times leaves
# one registry row and one row per column — verified by repetition, not by reading the SQL.
#
# GUARDRAIL 4 APPLIES TO THE PROFILER TOO. 4.1 reads `pg_stats` after an ANALYZE rather than
# scanning, and this hook must not undo that from the outside. It adds no scan of its own: per
# table it issues exactly one catalogue query and one `profile_dataset()` call, and the numbers it
# reports are read out of the rows that call already returned. In particular it never counts rows
# to report how many were profiled — `row_estimate` exists precisely so that nobody has to.
#
# WHAT THE FIRST REAL RUN FOUND, AND WHY IT IS WRITTEN HERE RATHER THAN ONLY IN THE LOG. This hook
# now writes registry rows automatically, so two limitations of what it writes belong next to the
# code that writes them (both measured on a full 270,917-row load; see DECISIONS.md, 2026-08-28):
#
#   * `fact_honorarium.bhw_id` is profiled `role = 'measure'`. 4.1 fixed exactly this defect on
#     `fact_bhw_raw` with the rule "a numeric column with about as many distinct values as the
#     table has rows is a row identity, not a quantity" — but on the *child* side of a one-to-many
#     join the ratio is 229,428/577,069 = 0.40 and the rule does not fire. `role = 'measure'` is
#     what tells the model a column may be summed, so this is 4.1's own "the mean of bhw_id is a
#     number that would eventually be reported to someone", recurring on the next table loaded.
#     Nothing here works around it: it is `profile_dataset()`'s rule to fix, and a reviewer sees
#     the role beside the distinct count. But an unreviewed `auto` row now arrives by itself.
#   * No join was proposed between `fact_honorarium` and `fact_bhw_raw`, which is the one join
#     this pipeline most obviously has. Not a failed measurement — an empty candidate set: the
#     pass proposes joins only toward columns some *approved* row already names as a join target,
#     and the whole registry names two (`dim_geo.geo_code`, `dim_dataset.dataset_id`). The
#     profiler extends the join graph outward from existing hubs; it cannot create one.
#
# THE REFUSAL SET IS CONSULTED, NOT REIMPLEMENTED. Which tables may be profiled is a question
# `profile_dataset_refusal()` already answers, so the hook asks it rather than keeping a second
# copy of the list in Python that would drift from the first. That is also why `dim_geo` is in the
# target list below despite having a hand-written dictionary since 1.2: the pipeline loads it, so
# it is offered, and the approved-row rule declines it. An exclusion hardcoded here would be a
# second source of truth for a decision the database already owns.

PROFILE_TARGETS = ("dim_geo", "fact_bhw_raw", "fact_honorarium")


def summarize_profile(rows):
    """Reduce profile_dataset()'s returned rows to the few numbers worth keeping.

    Pure, and deliberately asks the database nothing further: every question worth asking about a
    table that was just profiled is one the returned rows already answer.
    """
    borrowed = [r for r in rows if r["meaning_source"] and r["meaning_source"] != "placeholder"]
    return {
        "columns": len(rows),
        # The 4.1 leftover this number exists to measure: how much of the dictionary the approved
        # registry actually supplies, against how much still needs a human sentence.
        "meanings_from_dictionary": len(borrowed),
        "meanings_needing_review": len(rows) - len(borrowed),
        "join_keys_proposed": [
            {
                "column": r["column_name"],
                "joins_to": r["joins_to"],
                # float() rather than the Decimal psycopg2 returns: this dict is written to
                # ingestion_batches.qa_report with a plain json.dumps() that has no `default=`.
                "overlap": float(r["overlap_rate"]) if r["overlap_rate"] is not None else None,
            }
            for r in rows
            if r["is_join_key"]
        ],
    }


def profile_loaded_tables(database_url, tables=PROFILE_TARGETS):
    """Profile each table this run loaded. Returns one outcome per table; raises only if the
    connection itself cannot be opened."""
    import psycopg2
    import psycopg2.extras

    outcomes = {}
    conn = psycopg2.connect(database_url)
    # One transaction per statement: a refusal on one table must not abort the next.
    conn.autocommit = True
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            for table in tables:
                try:
                    cur.execute(
                        "select profile_dataset_refusal(%s) as refusal, "
                        "exists (select 1 from dataset_registry "
                        "        where table_name = %s and status = 'approved') as approved",
                        (table, table),
                    )
                    guard = cur.fetchone()
                    if guard["refusal"] is not None:
                        outcomes[table] = {"skipped": guard["refusal"]}
                        continue
                    if guard["approved"]:
                        outcomes[table] = {
                            "skipped": "it already has an approved registry row; re-profiling an "
                            "approved dictionary is a reviewer's decision (p_force), never a side "
                            "effect of re-running ingest"
                        }
                        continue
                    cur.execute("select * from profile_dataset(%s)", (table,))
                    outcomes[table] = summarize_profile(cur.fetchall())
                except Exception as exc:  # noqa: BLE001 - see the header: never fails the load
                    outcomes[table] = {"failed": str(exc).strip()}
    finally:
        conn.close()
    return outcomes


def report_profile(profile):
    """Print the profiling outcome. Warnings go to stderr so a failed profile is visible in a log
    that only captures it, without being mistaken for a failed load."""
    if profile.get("error"):
        print(f"WARNING: profiling did not run: {profile['error']}", file=sys.stderr)
        print("         The load committed. Run profile_dataset() by hand.", file=sys.stderr)
        return
    for table, outcome in profile.get("tables", {}).items():
        if "failed" in outcome:
            print(f"WARNING: profiling {table} failed: {outcome['failed']}", file=sys.stderr)
        elif "skipped" in outcome:
            print(f"  {table}: not profiled — {outcome['skipped']}")
        else:
            joins = ", ".join(
                f"{j['column']}->{j['joins_to']} ({j['overlap']})"
                for j in outcome["join_keys_proposed"]
            )
            print(
                f"  {table}: {outcome['columns']} columns at status=auto, "
                f"{outcome['meanings_from_dictionary']} meanings from the dictionary, "
                f"{outcome['meanings_needing_review']} needing review"
                + (f"; join keys: {joins}" if joins else "; no join key proposed")
            )


def selftest():
    """Exercise the pure half of the profiling hook (the `--selftest` convention the other
    ingestion scripts follow). The database half is exercised by running the pipeline."""
    rows = [
        {"column_name": "geo_code", "meaning_source": "borrowed from the approved dictionary",
         "is_join_key": True, "joins_to": "dim_geo.geo_code", "overlap_rate": Decimal("1.0000")},
        {"column_name": "bhw_id", "meaning_source": "kept from this table's approved dictionary",
         "is_join_key": False, "joins_to": None, "overlap_rate": None},
        {"column_name": "tesda_nc2_year", "meaning_source": "placeholder",
         "is_join_key": False, "joins_to": None, "overlap_rate": None},
    ]
    s = summarize_profile(rows)
    assert s["columns"] == 3, s
    # Both dictionary routes count as answered; only the placeholder is outstanding.
    assert s["meanings_from_dictionary"] == 2, s
    assert s["meanings_needing_review"] == 1, s
    assert s["join_keys_proposed"] == [
        {"column": "geo_code", "joins_to": "dim_geo.geo_code", "overlap": 1.0}
    ], s
    # The summary is written into ingestion_batches.qa_report by a json.dumps() with no `default=`
    # fallback, so a Decimal reaching it would fail the update *after* the load had committed.
    json.dumps(s)

    # A profile that borrowed nothing must not look like one that borrowed everything.
    empty = summarize_profile([])
    assert empty == {"columns": 0, "meanings_from_dictionary": 0, "meanings_needing_review": 0,
                     "join_keys_proposed": []}, empty

    # The hook must never call profile_dataset() with p_force. Measured against the committed
    # migration: forcing sets the registry row and every column row back to status = 'auto', and
    # `lib/db/dataset-registry.ts` reads only `approved` — so a forcing hook makes a reviewed
    # dataset vanish from the assistant on the next re-load, silently and with no error anywhere.
    # That is a one-word change away, so it is pinned here.
    #
    # Pinned by PARSING this module and reading the literals inside that one function, not by
    # scanning the file for a string: five times in this repository a raw text scan has been the
    # wrong instrument for an assertion about code, and a grep for "p_force" would be satisfied by
    # this very comment.
    tree = ast.parse(Path(__file__).read_text())
    hook = next(
        n for n in ast.walk(tree)
        if isinstance(n, ast.FunctionDef) and n.name == "profile_loaded_tables"
    )
    statements = [
        n.args[0].value
        for n in ast.walk(hook)
        if isinstance(n, ast.Call)
        and isinstance(n.func, ast.Attribute)
        and n.func.attr == "execute"
        and n.args
        and isinstance(n.args[0], ast.Constant)
        and isinstance(n.args[0].value, str)
    ]
    calls = [s for s in statements if "profile_dataset(" in s]
    assert len(calls) == 1, f"expected exactly one profile_dataset() call, found {len(calls)}"
    assert "p_force" not in calls[0], f"the ingest hook must not force a re-profile: {calls[0]}"
    print("ingest selftest: OK")



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
        "--no-profile",
        action="store_true",
        help="Skip the post-load dataset-registry profiling pass (direct mode only)",
    )
    parser.add_argument(
        "--selftest", action="store_true", help="Run the profiling hook's assertions and exit"
    )
    parser.add_argument(
        "--ingestion-batch-id",
        type=int,
        help="Pre-existing ingestion_batches.batch_id to attach fact_bhw_raw rows to "
        "(required with --emit-sql-dir, since that mode can't INSERT ... RETURNING itself)",
    )
    args = parser.parse_args()

    if args.selftest:
        selftest()
        return

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
        # --emit-sql-dir exists for environments with no database connection, which is exactly
        # what profiling needs. The pass is not emitted as another batch file: these files are
        # applied one at a time by hand, and a profile that ran before the last INSERT landed
        # would describe a partially loaded table. Say so rather than shipping a call that
        # depends on the operator's ordering.
        qa["profile"] = {
            "tables": {},
            "error": "--emit-sql-dir mode has no database connection; profiling was not run",
        }
        print(
            "Profiling not run (no database connection). After applying every batch file, run:\n"
            + "\n".join(f"  select * from profile_dataset('{t}');" for t in PROFILE_TARGETS),
            file=sys.stderr,
        )
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

        # The facts are committed. Nothing below this line may change that: the profiling pass
        # gets its own connection, and its failure is recorded and warned about rather than
        # raised. See the header above PROFILE_TARGETS.
        if args.no_profile:
            qa["profile"] = {"tables": {}, "error": "skipped by --no-profile"}
        else:
            try:
                qa["profile"] = {"tables": profile_loaded_tables(args.database_url)}
            except Exception as exc:  # noqa: BLE001 - a registry pass must not lose a good load
                qa["profile"] = {"tables": {}, "error": str(exc).strip()}
        print("Dataset registry:")
        report_profile(qa["profile"])

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
