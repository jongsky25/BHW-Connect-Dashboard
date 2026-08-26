-- Internal AI assistant, Increment 1.1 (docs/AI_ASSISTANT_PLAN.md §8): pgvector + the dataset
-- registry that lets one generic `queryDataset` tool (1.3) replace the hand-written per-dataset
-- tools in lib/ai/tools.ts. Adding a dataset becomes a data operation, not a code change.
--
-- Two tables, both additive; no existing table is touched:
--   dataset_registry — one row per queryable table: what it is, what one row means, how sensitive
--   dataset_column   — the per-column dictionary the model is shown before it composes a query
--
-- RLS is enabled in the same statement block as each CREATE TABLE, never created open and locked
-- later (docs/DECISIONS.md 0.3 guardrail), and both tables are service-role only — no anon or
-- authenticated policy — matching ai_ask_cache. The registry describes tables the public layer
-- already exposes, but it also carries an `exposure` flag whose whole purpose is to keep
-- internal-only tables out of any public path, so it must not itself be publicly readable.
--
-- pgvector is installed here rather than in Phase 2 so the extension question is settled before
-- any embedding work starts; nothing in this increment stores a vector. Version available on this
-- project: 0.8.2 (halfvec present), installed into `extensions` alongside pg_trgm/pgcrypto.
create extension if not exists vector with schema extensions;

create table dataset_registry (
  registry_id bigint generated always as identity primary key,
  -- Physical table in the public schema. Unique: one registry row per table, so a query
  -- allowlist can be built by table name alone.
  table_name text not null unique,
  title text not null,
  -- Plain-language description of the table, written for a reader who has never seen it.
  summary text not null,
  -- What exactly one row is ("one geography × indicator", "one BHW × payment level"). The single
  -- most load-bearing field: a model that misreads the grain double-counts.
  grain text not null,
  -- dim_dataset.slug when the table belongs to one source dataset; null for dimensions that span
  -- datasets (dim_geo) or hold several (agg_population, agg_poverty).
  dataset_slug text,
  -- 'public'  — already readable by anon under RLS; the public tools may use it.
  -- 'internal' — fact_*/raw or otherwise disclosive; the internal assistant only (plan §1).
  exposure text not null default 'internal' check (exposure in ('public', 'internal')),
  -- Advisory row count as of the last profile — lets a planner judge query weight. Never a
  -- source of a stated number; it goes stale by design.
  row_estimate bigint,
  -- 'hand_written' rows are asserted by a human in a migration (Increment 1.2); 'profiled' rows
  -- come from the ingest-time profiling pass (Phase 4) and land status 'auto' for review.
  source_kind text not null default 'profiled' check (source_kind in ('hand_written', 'profiled')),
  -- Only 'approved' rows are citable/queryable (owner decision 5). Mirrors ai_ask_cache.status.
  status text not null default 'auto' check (status in ('auto', 'approved', 'rejected')),
  -- Caveats that change how an answer must be phrased: suppression rules, denominators that
  -- differ from a neighbouring table, levels the table does not cover.
  notes_md text,
  -- docs/ write-up that documents or reconciles this table, where one exists. Restated as a
  -- `reconciled-in` edge in Increment 1.5.
  doc_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index dataset_registry_status_idx on dataset_registry (status, exposure);

alter table dataset_registry enable row level security;
-- service-role only: no anon/authenticated policies.

create table dataset_column (
  column_id bigint generated always as identity primary key,
  registry_id bigint not null references dataset_registry (registry_id) on delete cascade,
  column_name text not null,
  ordinal integer not null,
  -- SQL type as declared (text, integer, numeric, boolean, jsonb, geo_level_enum, ...).
  data_type text not null,
  -- Enum labels, or the closed category set for a text column that behaves like one.
  allowed_values text[],
  -- Plain-language meaning. Hand-written in 1.2; model-inferred (status 'auto') from Phase 4.
  meaning text not null,
  -- 'count', 'percent (0-100)', 'PHP per month', 'year' — what the number is in.
  unit text,
  -- 'key'       — identifies the row / joins to another table
  -- 'dimension' — group or filter by it
  -- 'measure'   — aggregate it; the only role a stated number may come from
  -- 'meta'      — surrogate ids, search vectors, bookkeeping; not for answering
  role text not null check (role in ('key', 'dimension', 'measure', 'meta')),
  is_join_key boolean not null default false,
  -- 'dim_geo.geo_code' — the target of the join. Restated as a `joins-on` edge in Increment 1.5,
  -- so the registry and the graph stay one structure rather than two.
  joins_to text,
  -- False for columns a generic query tool must never select or filter on (tsvector, surrogate
  -- ids). The allowlist is per column, not per table.
  is_queryable boolean not null default true,
  -- Profile statistics: null until a profiling pass fills them (Phase 4). Advisory only.
  distinct_count bigint,
  null_rate numeric check (null_rate is null or (null_rate >= 0 and null_rate <= 1)),
  min_value text,
  max_value text,
  sample_values text[],
  profiled_at timestamptz,
  status text not null default 'auto' check (status in ('auto', 'approved', 'rejected')),
  unique (registry_id, column_name)
);

create index dataset_column_registry_idx on dataset_column (registry_id, ordinal);
create index dataset_column_join_key_idx on dataset_column (joins_to) where is_join_key;

alter table dataset_column enable row level security;
-- service-role only: no anon/authenticated policies.
