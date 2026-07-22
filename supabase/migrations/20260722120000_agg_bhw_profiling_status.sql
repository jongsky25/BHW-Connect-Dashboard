-- BHW Connect Profiling Status (2026) aggregate — how far the 2026 individual-profiling
-- encoding has progressed, per geo, through the pipeline Encode → Validate → Certify.
--
-- A separate table from agg_bhw_stepzero_counts (and from the 2025 agg_bhw_counts): this
-- is the 2026 encoding-workflow snapshot, not the 2025 headcount baseline nor the
-- per-person profile aggregate. Its five pipeline buckets (drafted / for_validation /
-- back_to_encoder / validated / approved) are the operational status of each record and
-- have no equivalent in the other tables — keeping them apart avoids conflating the 2026
-- workflow with the 2025 datasets (same reasoning as agg_bhw_stepzero_counts' own note).
--
-- n_total_bhw = n_registered + n_accredited + n_unregistered: the 2026 denominator ("total
-- to finish"), since the stated goal is to profile every BHW this year (unlike 2025, where
-- non-registered BHWs were outside the profiling-eligible base). The Encode/Validate/
-- Certify totals are derived in the read layer (lib/db/profiling-status.ts), not stored, so
-- the funnel definition lives in one place.
create table agg_bhw_profiling_status (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),
  geo_code text not null references dim_geo (geo_code),
  geo_level geo_level_enum not null,
  -- BHW universe buckets (mutually exclusive; sum = n_total_bhw = denominator)
  n_registered integer not null default 0,
  n_accredited integer not null default 0,
  n_unregistered integer not null default 0,
  n_total_bhw integer not null default 0,
  -- Encoding-pipeline buckets (current status of each record; mutually exclusive)
  n_drafted integer not null default 0,
  n_for_validation integer not null default 0,
  n_back_to_encoder integer not null default 0,
  n_validated integer not null default 0,
  n_approved integer not null default 0,
  unique (dataset_id, geo_code, geo_level)
);

-- Read paths: by exact (geo_code, geo_level) for a single geo, and by (geo_level within a
-- parent) for the child-unit breakdown (the province → cities table).
create index agg_bhw_profiling_status_geo_idx
  on agg_bhw_profiling_status (geo_code, geo_level);
create index agg_bhw_profiling_status_level_idx
  on agg_bhw_profiling_status (dataset_id, geo_level);

alter table agg_bhw_profiling_status enable row level security;

-- Public, aggregate-only (no personal data): anyone may read; no client writes.
create policy "agg_bhw_profiling_status public read" on agg_bhw_profiling_status
  for select
  to anon, authenticated
  using (true);
