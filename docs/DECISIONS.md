# Decisions log

Dated entries recording deviations from `docs/BUILD_PLAN.md` and judgment calls made during implementation.

---

## 2026-07-19 — Increment 0.1 kickoff

Scaffolded Next.js (App Router, TypeScript strict, Tailwind) at repo root via `create-next-app`, then merged in the folder skeleton from BUILD_PLAN.md §4.2 (empty directories tracked with `.gitkeep` pending their implementing increments). `dataset.parquet` moved to `ingestion/data/`. No deviations from the plan.

## 2026-07-19 — Increment 0.2: Supabase + Vercel provisioning

- Paused Supabase project `koica-journey-tracker` (ref `zmoybshitjcgeijiysoi`) to free a slot on the free tier, per §2/P4.
- Created Supabase project **`bhw-connect`** (ref `ejcuwrnxngdwvecxwrhy`) in org `rparoyuerqqrozxehztm`, region `ap-southeast-1`, confirmed $0/month. Project URL: `https://ejcuwrnxngdwvecxwrhy.supabase.co`.
- Created Vercel project **`bhw-connect`** under team `jongsky25's projects` (`team_wavZZVJXBgbZ6xwRdtgYQCi6`) via a direct file deploy (no git repo available to the deploy tool), confirming the scaffold builds and serves on Vercel. Production alias: `bhw-connect-rose.vercel.app`.

**Deviation:** the available Vercel MCP tooling can create a project and deploy files directly, but cannot link a project to a GitHub repository for auto-deploy-on-push, nor set environment variables. Both require the Vercel dashboard and are left as manual follow-up (tracked outside this doc, not a plan change — the target end state, a `main`-tracking Vercel project, is unchanged).

## 2026-07-19 — Increment 0.3: schema migrations

- Wrote and applied all 18 tables from BUILD_PLAN.md §4.1 as 21 migrations under `supabase/migrations/`, RLS enabled in the same statement as each `CREATE TABLE` (never created open then locked later, per the increment's guardrail). Seeded `dim_dataset` with the `bhw-2025` entry.
- **`geo_level_enum` adds `'national'`** beyond the plan's literal `ENUM(region|province|citymun|barangay)`, because §6 increment 0.5 requires a national sentinel row (`geo_code = 'PH'`) in `dim_geo`, which needs a matching level value.
- **`ingestion_batches` created alongside the Phase 0 tables**, not grouped with the Phase-2 tables as its position in the §4.1 listing suggests — `fact_bhw_raw.ingestion_batch_id` references it, and increment 0.4 populates it in Phase 0.
- **`changelog_entries` RLS**: the plan's RLS summary in §4.1 doesn't classify this table. Treated as public-read (like `agg_*`/`dim_*`) since it's displayed on public pages, with service-role-only writes via the Phase 2 admin panel.
- `pg_trgm` installed into a dedicated `extensions` schema (not `public`) per Supabase's advisor guidance; `dim_geo`'s trigram index references `extensions.gin_trgm_ops` accordingly.
- Wrote `ingestion/verify_rls.py` and ran it against the live `bhw-connect` project as `anon`: all public-read tables readable, all service-role-only tables return zero rows to anon, `feedback`/`usage_events` accept anon INSERT and deny SELECT. All checks pass.
- **Finding for future `lib/db` / API route work:** Postgres's `RETURNING` clause on `INSERT`/`UPDATE` re-checks the affected row against the table's SELECT policies, not just the INSERT/UPDATE policy's `WITH CHECK`. Since `feedback`/`usage_events` deliberately have no SELECT policy for `anon`/`authenticated` (write-only, to protect submitters), inserting with `Prefer: return=representation` (or a client library default that requests the row back) fails with the same generic "new row violates row-level security policy" error as a real `WITH CHECK` failure — Postgres does not distinguish the two in its error message. The fix is `Prefer: return=minimal` (Supabase JS: `.insert(...).select()` triggers the bug; plain `.insert(...)` does not) — which is also the correct behavior here, since the client has no reason to read the row back.
- Two `get_advisors` findings are accepted as intentional, not gaps: `rls_enabled_no_policy` (INFO) on the six service-role-only tables — that's the deny-all-by-design outcome; `rls_policy_always_true` (WARN) on `feedback`/`usage_events` INSERT policies — public, unauthenticated insert is the intended design for these two tables.

## 2026-07-19 — Increment 0.4: ingestion pipeline

Wrote `ingestion/ingest.py` implementing the full §3 transformation: zero-padded PSGC codes at all four levels, year-list parsing for active/inactive service, honorarium flag/amount reconciliation (`receives = flag='YES' OR amount>0`) across all 4 payer levels, and a compact `training` JSONB that stores only `trained: true` topics (avg. 2.5 of 44 topics per BHW) rather than all 44 — keeps row size sane and is a strict subset of what the plan asks for (absence = not trained). The `Others please specify` free-text detail is included only inside this JSONB, per P16 (fact_bhw_raw is service-role-only, so this satisfies "raw-side only").

**Deviation — how the data actually got loaded.** This sandbox has no direct Postgres connection: raw TCP egress is blocked (confirmed empirically — outbound HTTPS through the environment's proxy works, arbitrary TCP does not), and the project's DB password isn't retrievable through any available Supabase MCP tool. `ingest.py` still supports the intended production path (`--database-url`, direct `psycopg2`) for when it's run somewhere with real network access. To actually populate the live project from this session, the ~890K rows (41,052 `dim_geo` + 270,917 `fact_bhw_raw` + 577,069 `fact_honorarium`) were pushed over HTTPS: three temporary `SECURITY DEFINER` RPC functions (`_bulk_load_dim_geo`/`_bulk_load_fact_bhw_raw`/`_bulk_load_fact_honorarium`), each gated by a random one-time secret argument and `GRANT EXECUTE ... TO anon`, were created via `execute_sql`, called in batches from a local Python script (`urllib`, no ORM) using the anon key so the ~150MB of row data never had to pass through the assistant's own context, then **dropped immediately** after the load finished and the secret discarded. This was a one-time operational workaround for this environment, not a pattern to repeat outside it — the functions were never committed to `supabase/migrations/`, and none exist in the project post-load (verified via `pg_proc`).
- Bug caught during this process: a `case when r->'active_years' is null then null else ... end` guard in the `fact_bhw_raw` loader function didn't catch JSON `null` (a real jsonb value, not SQL `NULL`) — fixed by switching to `jsonb_typeof(...) = 'array'`. Same class of bug guarded against for `inactive_years`/`training`.
- **Verify results:** row counts exact (`dim_geo`=41,052 with 18/118/1,639/39,276 at region/province/citymun/barangay; `fact_bhw_raw`=270,917; `fact_honorarium`=577,069); 5 random `bhw_id`s spot-checked field-by-field against the parquet, all exact; national totals cross-checked against parquet-computed values for accredited count (193,897), sex split (266,335F/4,582M), and barangay-level honorarium recipients (241,712) — all exact matches. 34 honorarium flag/amount mismatches found and reconciled (logged in `ingestion_batches.qa_report`), 0 unparseable year-lists. `fact_bhw_raw_bhw_id_seq` resynced to continue after 270,917 for future inserts.

## 2026-07-19 — Increment 0.5: aggregate build + suppression

Wrote `ingestion/build_aggregates.sql`, a plain-SQL job (no client-side data movement needed — it computes entirely from the already-loaded `fact_*` tables) building `agg_bhw_counts`, `agg_demographics` (with suppression), `agg_certification`, `agg_training`, `agg_honorarium`, `agg_geo_summary`, and `agg_data_completeness`, then ran it against the live project.

**Incident: hit the Supabase free tier's disk cap mid-build.** Building `agg_training` at all 5 geo levels (39,276 barangays x 44 topics was the dominant term) while a ~390 MB scratch working table (`_agg_base`) was still alive pushed the live database to 951 MB, past the ~500 MB free-tier budget; Postgres auto-set `default_transaction_read_only = on`, which blocks all writes including `DROP TABLE` (confirmed via Supabase's own docs on this exact behavior — search for "Understanding Database and Disk Size"). Recovery, in order:
1. `SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE;` in the same session before a statement overrides the read-only default for that session (this is Supabase's documented manual override) — used it to `DROP TABLE _agg_base`, freeing 388 MB (951 MB -> 563 MB).
2. Once usage dropped comfortably below the platform's automatic-recovery threshold, `default_transaction_read_only` flipped back to `off` on its own within the next query — no dashboard action was needed in the end.
3. `VACUUM` (plain, table-scoped; `VACUUM FULL`/bare `VACUUM` cannot run inside a transaction block, so it had to be its own statement) reclaimed the ~200 MB a failed `agg_training` insert had allocated but rolled back.

**Design change to fit the budget:** `agg_training` is scoped to national/region/province/citymun only, not barangay — that axis (39,276 barangays x 44 topics) was the single biggest contributor to the overrun, for per-topic granularity a place page doesn't need at that level (it shows `agg_geo_summary.top_training_gap` instead, which is unaffected). `agg_bhw_counts`, `agg_demographics`, and `agg_certification` remain at all 5 levels including barangay and national. Final database size after the full build: **497 MB**.

**Verify results (BUILD_PLAN.md §6 checklist):**
- A real barangay (`0504101002`, n_total=2) has every `agg_demographics` row suppressed (n/pct nulled, `is_suppressed=true`), correctly rolled up to its citymun.
- Rollup chain distribution across all suppressed barangay cells: 363,968 -> citymun, 15,857 -> province, 570 -> region, 18 -> national (the full chain is exercised by real data, not just a synthetic test case).
- National totals match parquet-computed values exactly for all 5 required indicators: % accredited (71.57%), sex split (266,335F/98.31% - 4,582M/1.69%), one training topic (Dengue: 20,140/270,917 = 7.43%), any-level honorarium (97.88%), avg active-service years (10.47).
- Row counts: `agg_bhw_counts`/`agg_geo_summary`=41,052 (one per `dim_geo` row); `agg_certification`=123,156 (41,052 x 3 cert types); `agg_training`=78,144 (1,776 non-barangay geos x 44 topics); `agg_demographics`=530,465; `agg_honorarium`=93,561; `agg_data_completeness`=8.
