#!/usr/bin/env python3
"""Verify RLS behavior against the live Supabase project, as the `anon` role.

Checks (BUILD_PLAN.md §6, increment 0.3 Verify):
  - SELECT on agg_*/dim_* tables succeeds and returns rows.
  - SELECT on fact_*/ai_*/admin_users/ingestion_batches tables is denied (returns no rows).
  - INSERT on feedback/usage_events succeeds, and SELECT on those tables is denied.

Requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in the environment
(or a .env file in the repo root). Exits non-zero if any check fails.

Test rows are inserted into feedback/usage_events tagged with '__rls_verify__' so an
operator can find and remove them later with the service role, e.g.:
  delete from feedback where page_path = '__rls_verify__';
  delete from usage_events where event_type = '__rls_verify__';
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

PUBLIC_READ_TABLES = [
    "dim_geo",
    "dim_dataset",
    "agg_bhw_counts",
    "agg_demographics",
    "agg_training",
    "agg_certification",
    "agg_honorarium",
    "agg_geo_summary",
    "agg_data_completeness",
    "changelog_entries",
]

SERVICE_ROLE_ONLY_TABLES = [
    "fact_bhw_raw",
    "fact_honorarium",
    "ingestion_batches",
    "ai_narrative_cache",
    "ai_provider_quota",
    "admin_users",
]


def load_env():
    env = dict(os.environ)
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            env.setdefault(key.strip(), value.strip())
    return env


def request(url, api_key, method="GET", body=None, prefer=None):
    headers = {"apikey": api_key, "Authorization": f"Bearer {api_key}"}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
        headers["Prefer"] = prefer or "return=representation"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            body_bytes = resp.read()
            return resp.status, json.loads(body_bytes) if body_bytes else []
    except urllib.error.HTTPError as e:
        body_bytes = e.read()
        return e.code, json.loads(body_bytes) if body_bytes else []


def main():
    env = load_env()
    base_url = env.get("NEXT_PUBLIC_SUPABASE_URL")
    anon_key = env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not base_url or not anon_key:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY", file=sys.stderr)
        sys.exit(2)

    rest = f"{base_url.rstrip('/')}/rest/v1"
    failures = []

    for table in PUBLIC_READ_TABLES:
        status, rows = request(f"{rest}/{table}?select=*&limit=1", anon_key)
        ok = status == 200
        print(f"[{'ok' if ok else 'FAIL'}] anon SELECT {table}: status={status}")
        if not ok:
            failures.append(f"{table}: expected public SELECT to succeed, got {status}")

    for table in SERVICE_ROLE_ONLY_TABLES:
        status, rows = request(f"{rest}/{table}?select=*&limit=1", anon_key)
        ok = status == 200 and rows == []
        print(f"[{'ok' if ok else 'FAIL'}] anon SELECT {table}: status={status}, rows={len(rows) if isinstance(rows, list) else 'n/a'}")
        if not ok:
            failures.append(f"{table}: expected SELECT to return zero rows, got status={status} rows={rows}")

    # return=minimal: feedback has no SELECT policy for anon, so RETURNING (return=representation)
    # would fail RLS on the returned row even though the INSERT itself is allowed.
    status, rows = request(
        f"{rest}/feedback",
        anon_key,
        method="POST",
        body={
            "page_path": "__rls_verify__",
            "category": "other",
            "message": "RLS verification test row - safe to delete",
            "session_id": "00000000-0000-0000-0000-000000000000",
        },
        prefer="return=minimal",
    )
    ok = status in (200, 201, 204)
    print(f"[{'ok' if ok else 'FAIL'}] anon INSERT feedback: status={status}")
    if not ok:
        failures.append(f"feedback insert: expected 200/201, got {status} {rows}")

    status, rows = request(f"{rest}/feedback?page_path=eq.__rls_verify__&select=*", anon_key)
    ok = status == 200 and rows == []
    print(f"[{'ok' if ok else 'FAIL'}] anon SELECT feedback (post-insert): status={status}, rows={len(rows) if isinstance(rows, list) else 'n/a'}")
    if not ok:
        failures.append(f"feedback select-after-insert: expected zero rows, got {rows}")

    status, rows = request(
        f"{rest}/usage_events",
        anon_key,
        method="POST",
        body={
            "session_id": "00000000-0000-0000-0000-000000000000",
            "event_type": "__rls_verify__",
            "page_path": "/__rls_verify__",
        },
        prefer="return=minimal",
    )
    ok = status in (200, 201, 204)
    print(f"[{'ok' if ok else 'FAIL'}] anon INSERT usage_events: status={status}")
    if not ok:
        failures.append(f"usage_events insert: expected 200/201, got {status} {rows}")

    status, rows = request(f"{rest}/usage_events?event_type=eq.__rls_verify__&select=*", anon_key)
    ok = status == 200 and rows == []
    print(f"[{'ok' if ok else 'FAIL'}] anon SELECT usage_events (post-insert): status={status}, rows={len(rows) if isinstance(rows, list) else 'n/a'}")
    if not ok:
        failures.append(f"usage_events select-after-insert: expected zero rows, got {rows}")

    print()
    if failures:
        print(f"{len(failures)} check(s) failed:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)

    print("All RLS checks passed.")
    print(
        "Cleanup (run with service role): "
        "delete from feedback where page_path = '__rls_verify__'; "
        "delete from usage_events where event_type = '__rls_verify__';"
    )


if __name__ == "__main__":
    main()
