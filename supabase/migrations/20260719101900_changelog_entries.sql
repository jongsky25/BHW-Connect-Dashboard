-- BUILD_PLAN.md's RLS summary (§4.1) does not classify changelog_entries. Treated as public-read
-- (like agg_*/dim_*) since it is displayed on public pages (methodology/roadmap), with writes
-- restricted to service-role via the Phase 2 admin panel. See docs/DECISIONS.md.
create table changelog_entries (
  id bigint generated always as identity primary key,
  published_at timestamptz not null default now(),
  title text not null,
  body_md text not null
);

alter table changelog_entries enable row level security;

create policy "changelog_entries public read" on changelog_entries
  for select
  to anon, authenticated
  using (true);
