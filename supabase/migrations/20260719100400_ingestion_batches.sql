-- Created ahead of the fact tables, rather than grouped with the Phase-2 tables as listed in
-- BUILD_PLAN.md §4.1: fact_bhw_raw.ingestion_batch_id references it, and it is populated
-- starting in Phase 0 increment 0.4, not Phase 2. See docs/DECISIONS.md.
create table ingestion_batches (
  batch_id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  source_file text,
  row_counts jsonb,
  qa_report jsonb
);

alter table ingestion_batches enable row level security;
-- service-role only: no anon/authenticated policies.
