-- Enable RLS on agg_peer_ranks to match every other agg_*/dim_* table.
--
-- The E2.3/E2.4 migration (20260721041059_e2_3_peer_ranks.sql) created this table but —
-- unlike agg_bhw_counts, agg_cohorts, agg_workload, etc. — never enabled row level security
-- or added a read policy. With RLS off, PostgREST exposes the table to the anon and
-- authenticated roles with no restriction (read AND write), which the Supabase security
-- advisor flags as `rls_disabled_in_public` (ERROR). agg_peer_ranks holds only public,
-- non-disclosive derived rank/percentile stats (region/province/citymun grain, no
-- individuals), so the correct posture is identical to the other agg_* tables: public read,
-- service-role write (writes happen only via the service role in ingestion/build_aggregates.sql,
-- which bypasses RLS).
--
-- Idempotent. Applied live via the Supabase MCP. See docs/DECISIONS.md.

alter table agg_peer_ranks enable row level security;

drop policy if exists "agg_peer_ranks public read" on agg_peer_ranks;
create policy "agg_peer_ranks public read" on agg_peer_ranks
  for select
  to anon, authenticated
  using (true);
