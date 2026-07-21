#!/usr/bin/env python3
"""E4.1 PSGC crosswalk builder (docs/EXPLORE_ENHANCEMENT_PLAN.md §E4.1).

dim_geo is fixed on one PSGC vintage ('2023 series (>=2024 release, includes NIR)').
Every later external load (POPCEN/CPH, SAE poverty, DOF/BLGF income classes, …) is keyed
on *its own* PSGC vintage; a code renumbered/reassigned between vintages would silently
fall out of a naive join. This module builds/maintains `dim_psgc_crosswalk`, which maps a
source-vintage code (old_code) onto dim_geo's current code (new_code), and exposes the
reusable resolution + reconciliation primitives every downstream load calls so unmatched
codes are *reported*, never silently dropped (the 1.6 boundary-reconciliation discipline).

Two sources of crosswalk rows:

  1. derive_nir_crosswalk(dim_geo_rows) — the one large, verifiable PSGC change this repo
     already has hard evidence for: the Negros Island Region (NIR / Region XVIII)
     re-establishment by RA 12000 (2024). Pre-NIR PSGC filed Negros Occidental under
     Region VI (06) and Negros Oriental + Siquijor under Region VII (07); dim_geo files all
     three under Region 18 with re-prefixed codes. Derived FROM dim_geo (the join target of
     truth) by swapping the region prefix back — the same remap in reconcile_boundaries.py's
     NIR_PROVINCE_CROSSWALK. This is what the companion migration
     (supabase/migrations/20260721060000_e4_1_psgc_crosswalk.sql) seeds; running this script
     reproduces it independently as a cross-check and writes the reconciliation report.

  2. diff_psgc_publications(old_records, new_records) — the general quarterly-file path: diff
     two PSA PSGC publication snapshots into created/abolished/renamed/renumbered rows. The
     PSA site is Cloudflare bot-challenged from the build environment (the plan's flagged
     constraint), so no snapshot is bundled; feed real ones with --old-psgc / --new-psgc when
     obtainable. `--selftest` exercises this path on synthetic input.

Run it (mirrors ingest.py / patch_dim_geo_stepzero_gap.py modes):

  # Offline, from a dim_geo CSV export (geo_code, geo_level, geo_name, province_code, region_code):
  python ingestion/build_psgc_crosswalk.py --dim-geo-csv ingestion/data/dim_geo_nir.csv \
      --emit-sql-dir ingestion/_sql_psgc_crosswalk --dataset-id N

  # Direct against Postgres (reads dim_geo itself, looks up the dataset_id):
  python ingestion/build_psgc_crosswalk.py --database-url "$DATABASE_URL"

  # Synthetic self-test of the quarterly-diff path (no DB / no files needed):
  python ingestion/build_psgc_crosswalk.py --selftest

Either build mode writes a QA report to ingestion/_qa_report_psgc_crosswalk.json and can
refresh docs/PSGC_CROSSWALK.md's reconciliation summary via --write-doc-summary.
"""

import argparse
import csv
import json
from pathlib import Path

from ingest import batched, insert_statement

REPO_ROOT = Path(__file__).resolve().parent.parent
QA_REPORT_PATH = REPO_ROOT / "ingestion" / "_qa_report_psgc_crosswalk.json"

DATASET_SLUG = "psa-psgc-crosswalk"

OLD_VINTAGE_PRE_NIR = "pre-NIR (PSGC before RA 12000, 2024)"
NEW_VINTAGE_DIM_GEO = "2023 series (>=2024 release, includes NIR)"

# NIR province -> the pre-NIR 2-digit region prefix its code carried. Same mapping as
# reconcile_boundaries.py's NIR_PROVINCE_CROSSWALK, expressed at province grain: the
# province digits are preserved, only the leading region prefix is swapped back.
NIR_PROVINCE_OLD_REGION = {
    "18045": "06",  # Negros Occidental -> Region VI (Western Visayas)
    "18046": "07",  # Negros Oriental  -> Region VII (Central Visayas)
    "18061": "07",  # Siquijor         -> Region VII (Central Visayas)
}
NIR_NOTE = "NIR (RA 12000, 2024): region prefix re-assigned; place + name unchanged."

CROSSWALK_COLUMNS = [
    "old_code",
    "new_code",
    "geo_level",
    "old_vintage",
    "new_vintage",
    "change_kind",
    "old_name",
    "new_name",
    "note",
    "dataset_id",
]
BATCH_SIZE = 1000


# --------------------------------------------------------------------------- #
# 1. NIR derivation (the seeded, verifiable block)                            #
# --------------------------------------------------------------------------- #
def derive_nir_crosswalk(dim_geo_rows, dataset_id=None):
    """dim_geo_rows: iterable of dicts with geo_code, geo_level, geo_name, province_code.
    Returns crosswalk row dicts for every geo under the three NIR provinces, mapping its
    pre-NIR code (region prefix swapped back) onto its current dim_geo code."""
    rows = []
    for g in dim_geo_rows:
        old_region = NIR_PROVINCE_OLD_REGION.get(g["province_code"])
        if old_region is None:
            continue
        new_code = g["geo_code"]
        old_code = old_region + new_code[2:]
        rows.append(
            {
                "old_code": old_code,
                "new_code": new_code,
                "geo_level": g["geo_level"],
                "old_vintage": OLD_VINTAGE_PRE_NIR,
                "new_vintage": NEW_VINTAGE_DIM_GEO,
                "change_kind": "region_reassignment",
                "old_name": g["geo_name"],  # names unchanged by NIR
                "new_name": g["geo_name"],
                "note": NIR_NOTE,
                "dataset_id": dataset_id,
            }
        )
    return rows


# --------------------------------------------------------------------------- #
# 2. General quarterly-file path (diff two PSA publication snapshots)         #
# --------------------------------------------------------------------------- #
def diff_psgc_publications(old_records, new_records, old_vintage, new_vintage, dataset_id=None):
    """Diff two normalized PSGC publication snapshots into crosswalk rows.

    Each record is a dict: {code, name, level, correspondence_code?}. In a real PSA PSGC
    publication workbook these map to the '10-digit PSGC', 'Name', 'Geographic Level' and
    (where present) the 'Correspondence Code' / 'New PSGC code' columns — pass the workbook
    through a small normalizer (see normalize_psa_workbook, left to the operator per file
    since PSA header spelling drifts between quarters) before calling this.

    Emits:
      - renumbered: a record whose correspondence_code points at a different new code.
      - renamed:    same code present in both snapshots, different name.
      - created:    code only in the new snapshot (new_code = itself, old_code = itself,
                    change_kind 'created' — a no-op for joins but recorded for the audit).
      - abolished:  code only in the old snapshot with no correspondence target
                    (new_code NULL).
    Splits/merges (1:many / many:1 correspondence) are reported in the QA payload for manual
    handling rather than auto-inserted, so the deterministic 1:1 map is never corrupted.
    """
    old_by_code = {r["code"]: r for r in old_records}
    new_by_code = {r["code"]: r for r in new_records}
    rows = []
    splits_or_merges = []

    # correspondence targets seen, to detect many:1 (merge)
    corr_targets = {}
    for r in old_records:
        tgt = r.get("correspondence_code")
        if tgt and tgt != r["code"]:
            corr_targets.setdefault(tgt, []).append(r["code"])

    for code, r in old_by_code.items():
        tgt = r.get("correspondence_code")
        if tgt and tgt != code:
            if len(corr_targets.get(tgt, [])) > 1:
                splits_or_merges.append({"kind": "merge", "old_code": code, "new_code": tgt})
                continue
            rows.append(_row(code, tgt, r, new_by_code.get(tgt), "renumbered",
                             old_vintage, new_vintage, dataset_id))
        elif code not in new_by_code:
            rows.append(_row(code, None, r, None, "abolished",
                             old_vintage, new_vintage, dataset_id))
        else:
            nr = new_by_code[code]
            if (r.get("name") or "").strip().upper() != (nr.get("name") or "").strip().upper():
                rows.append(_row(code, code, r, nr, "renamed",
                                 old_vintage, new_vintage, dataset_id))

    for code, nr in new_by_code.items():
        if code not in old_by_code and code not in corr_targets:
            rows.append(_row(code, code, nr, nr, "created",
                             old_vintage, new_vintage, dataset_id))

    return rows, splits_or_merges


def _row(old_code, new_code, old_rec, new_rec, change_kind, old_vintage, new_vintage, dataset_id):
    return {
        "old_code": old_code,
        "new_code": new_code,
        "geo_level": (new_rec or old_rec).get("level"),
        "old_vintage": old_vintage,
        "new_vintage": new_vintage,
        "change_kind": change_kind,
        "old_name": old_rec.get("name") if old_rec else None,
        "new_name": new_rec.get("name") if new_rec else None,
        "note": None,
        "dataset_id": dataset_id,
    }


# --------------------------------------------------------------------------- #
# 3. Resolution + reconciliation primitives (imported by later loads)         #
# --------------------------------------------------------------------------- #
def index_by_old_code(crosswalk_rows):
    """{old_code: new_code} for the deterministic resolution primitive."""
    idx = {}
    for r in crosswalk_rows:
        if r["change_kind"] == "created":
            continue  # created rows are their own code; not a remap
        idx[r["old_code"]] = r["new_code"]
    return idx


def map_code(code, dim_geo_codes, crosswalk_by_old):
    """The Python twin of the SQL map_psgc_to_dim_geo(): current code passes through, a
    source-vintage code resolves via the crosswalk, an unresolvable code returns None so
    the caller can log it."""
    if code in dim_geo_codes:
        return code
    return crosswalk_by_old.get(code)


def reconcile(crosswalk_rows, dim_geo_codes):
    """Two-way reconciliation report (1.6 discipline)."""
    by_level = {}
    for r in crosswalk_rows:
        by_level[r["geo_level"]] = by_level.get(r["geo_level"], 0) + 1

    orphan_new = sorted(
        r["new_code"] for r in crosswalk_rows
        if r["new_code"] is not None and r["new_code"] not in dim_geo_codes
    )
    old_code_collisions = sorted(
        r["old_code"] for r in crosswalk_rows if r["old_code"] in dim_geo_codes
    )
    return {
        "total_rows": len(crosswalk_rows),
        "rows_by_level": by_level,
        "orphan_new_codes": orphan_new,          # new_code not in dim_geo — a real join target gap
        "orphan_new_count": len(orphan_new),
        "old_code_collisions": old_code_collisions,  # old_code already live in dim_geo — ambiguous
        "old_code_collision_count": len(old_code_collisions),
    }


# --------------------------------------------------------------------------- #
# I/O                                                                          #
# --------------------------------------------------------------------------- #
def load_dim_geo_csv(path):
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        # province_code may be blank for national/region rows in a full export
        r.setdefault("province_code", "")
    return rows


def load_dim_geo_from_db(cur):
    cur.execute("select geo_code, geo_level, geo_name, coalesce(province_code, '') as province_code from dim_geo")
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def emit_sql_files(rows, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    n = 0
    for chunk in batched(rows, BATCH_SIZE):
        n += 1
        (out_dir / f"{n:04d}_dim_psgc_crosswalk.sql").write_text(
            insert_statement("dim_psgc_crosswalk", CROSSWALK_COLUMNS, chunk)
        )
    return n


def run_via_psycopg2(database_url, rows):
    import psycopg2

    conn = psycopg2.connect(database_url)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            cur.execute(
                "delete from dim_psgc_crosswalk where old_vintage = %s and new_vintage = %s",
                (OLD_VINTAGE_PRE_NIR, NEW_VINTAGE_DIM_GEO),
            )
            for chunk in batched(rows, BATCH_SIZE):
                cur.execute(insert_statement("dim_psgc_crosswalk", CROSSWALK_COLUMNS, chunk))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def selftest():
    old = [
        {"code": "12345", "name": "OLDTOWN", "level": "citymun"},
        {"code": "22222", "name": "RENAME ME", "level": "citymun"},
        {"code": "33333", "name": "MOVED", "level": "citymun", "correspondence_code": "44444"},
        {"code": "55555", "name": "GONE", "level": "citymun"},
    ]
    new = [
        {"code": "12345", "name": "OLDTOWN", "level": "citymun"},        # unchanged
        {"code": "22222", "name": "NEWNAME", "level": "citymun"},        # renamed
        {"code": "44444", "name": "MOVED", "level": "citymun"},          # renumbered target
        {"code": "66666", "name": "BRANDNEW", "level": "citymun"},       # created
    ]
    rows, sm = diff_psgc_publications(old, new, "old_v", "new_v")
    kinds = {r["old_code"]: r["change_kind"] for r in rows}
    assert kinds.get("22222") == "renamed", kinds
    assert kinds.get("33333") == "renumbered", kinds
    assert kinds.get("55555") == "abolished", kinds
    assert kinds.get("66666") == "created", kinds
    assert "12345" not in kinds, "unchanged code must not produce a row"
    idx = index_by_old_code(rows)
    assert idx.get("33333") == "44444"
    assert map_code("33333", {"44444"}, idx) == "44444"
    assert map_code("44444", {"44444"}, idx) == "44444"   # direct hit
    assert map_code("00000", {"44444"}, idx) is None       # unresolvable
    print("selftest OK:", json.dumps(kinds))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dim-geo-csv", help="dim_geo export CSV (offline mode)")
    parser.add_argument("--database-url", help="Postgres connection string (psycopg2 mode)")
    parser.add_argument("--emit-sql-dir", help="Write batched INSERT .sql files here")
    parser.add_argument("--dataset-id", type=int, help="dim_dataset.dataset_id for psa-psgc-crosswalk (required with --emit-sql-dir)")
    parser.add_argument("--old-psgc", help="Normalized old-vintage PSGC snapshot JSON (quarterly-diff path)")
    parser.add_argument("--new-psgc", help="Normalized new-vintage PSGC snapshot JSON (quarterly-diff path)")
    parser.add_argument("--selftest", action="store_true", help="Run the quarterly-diff self-test and exit")
    args = parser.parse_args()

    if args.selftest:
        selftest()
        return

    if not args.dim_geo_csv and not args.database_url:
        parser.error("pass --dim-geo-csv (offline) or --database-url")
    if args.emit_sql_dir and not args.dataset_id and not args.database_url:
        parser.error("--emit-sql-dir needs --dataset-id (or --database-url to look it up)")

    qa = {"dataset_slug": DATASET_SLUG}

    # Resolve dim_geo rows + dataset_id.
    dataset_id = args.dataset_id
    if args.database_url:
        import psycopg2

        conn = psycopg2.connect(args.database_url)
        with conn, conn.cursor() as cur:
            cur.execute("select dataset_id from dim_dataset where slug = %s", (DATASET_SLUG,))
            row = cur.fetchone()
            if row is None:
                raise SystemExit(f"dim_dataset row for slug={DATASET_SLUG!r} not found — apply the migration first")
            dataset_id = row[0]
            dim_geo_rows = load_dim_geo_from_db(cur)
        conn.close()
    else:
        dim_geo_rows = load_dim_geo_csv(args.dim_geo_csv)

    dim_geo_codes = {r["geo_code"] for r in dim_geo_rows}

    crosswalk_rows = derive_nir_crosswalk(dim_geo_rows, dataset_id)

    # Optional: fold in a real quarterly diff if snapshots were provided.
    if args.old_psgc and args.new_psgc:
        old_records = json.loads(Path(args.old_psgc).read_text())
        new_records = json.loads(Path(args.new_psgc).read_text())
        diff_rows, splits_or_merges = diff_psgc_publications(
            old_records, new_records, "quarterly-old", "quarterly-new", dataset_id
        )
        crosswalk_rows += [r for r in diff_rows if r["change_kind"] != "created"]
        qa["quarterly_diff_rows"] = len(diff_rows)
        qa["quarterly_splits_or_merges"] = splits_or_merges

    qa["reconciliation"] = reconcile(crosswalk_rows, dim_geo_codes)

    if args.database_url:
        run_via_psycopg2(args.database_url, crosswalk_rows)
        qa["applied"] = "database"
    elif args.emit_sql_dir:
        n = emit_sql_files(crosswalk_rows, Path(args.emit_sql_dir))
        qa["applied"] = f"emitted {n} sql file(s) to {args.emit_sql_dir}"
    else:
        qa["applied"] = "dry-run (no --emit-sql-dir / --database-url)"

    QA_REPORT_PATH.write_text(json.dumps(qa, indent=2, default=str))
    print(json.dumps(qa, indent=2, default=str))
    print(f"QA report written to {QA_REPORT_PATH}")


if __name__ == "__main__":
    main()
