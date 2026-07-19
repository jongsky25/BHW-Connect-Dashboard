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
