-- E4.4 PSA Small Area Estimates of poverty (docs/EXPLORE_ENHANCEMENT_PLAN.md §E4.4).
--
-- City/municipal poverty incidence with the coefficient of variation, standard error, and the
-- 90% confidence interval, exactly as PSA publishes them. Source: PSA "Annex 1. Statistical
-- Table on 2018, 2021 and 2023 City- and Municipal-Level Poverty Estimates" (owner-supplied,
-- PSGC-stamped). Long format: one row per (geo_code, sae_year); the single 2023 release carries
-- back-estimates for 2018 and 2021 on consistent methodology, so all three years share one
-- dim_dataset row and reload idempotently by dataset (the delete/upsert-by-dataset pattern every
-- agg_* table uses).
--
-- Grain: city/municipality ONLY. Poverty incidence is a rate, not summable, so it is NOT rolled
-- up to province/region/national (that would need population weighting PSA does not publish
-- here). Poverty therefore surfaces in the Relationships view only where the children are
-- cities/municipalities (a province view) — external variables live in Relationships, never on
-- the workforce map (identity rule, owner Q1). This is a deliberate deviation from the plan's
-- "province/citymun grain" wording; the source stops at city/municipality.
--
-- Join is to dim_geo (2020+ PSGC). The source uses the classic pre-2020 PSGC, so the loader
-- (ingestion/build_poverty.py) derives dim_geo's province code from the old PSGC then name-
-- matches within it (NIR re-regioning, ARMM->BARMM, Manila's province recode + district split,
-- the 2022 Maguindanao split all handled). Coverage 1,607/1,651 dim_geo city/municipalities;
-- the residual is the source's "noHUC" scope (Highly Urbanized Cities + all Metro Manila outside
-- the City of Manila are a separate SAE domain, absent here), 8 BARMM Special Geographic Areas,
-- Kalayaan (Palawan — "not generated", the source's footnote 3), and four City-of-Manila
-- districts dim_geo folds together. Every residual is enumerated in ingestion/_qa_report_poverty.json
-- and docs/POVERTY_SAE.md (the 1.6 discipline), never silently dropped. This migration is schema
-- + provenance only; build_poverty.py loads the rows. Applied live via the Supabase MCP.

create table if not exists agg_poverty (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),
  geo_code text not null references dim_geo (geo_code),
  geo_level geo_level_enum not null,
  sae_year smallint not null,
  poverty_incidence real not null,   -- % of population below the poverty threshold
  cv real,                           -- coefficient of variation (%)
  se real,                           -- standard error (percentage points)
  ci_low real,                       -- 90% confidence interval, lower limit (%)
  ci_high real,                      -- 90% confidence interval, upper limit (%)
  unique (dataset_id, geo_code, sae_year)
);

create index if not exists agg_poverty_geo_idx on agg_poverty (geo_code, sae_year);

comment on table agg_poverty is
  'PSA Small Area Estimates of poverty (2018/2021/2023) at city/municipality grain, PSGC-matched to dim_geo. One row per geo × SAE year; no rollup (poverty incidence is a rate). E4.4; see docs/EXPLORE_ENHANCEMENT_PLAN.md.';

alter table agg_poverty enable row level security;

drop policy if exists "agg_poverty public read" on agg_poverty;
create policy "agg_poverty public read" on agg_poverty
  for select
  to anon, authenticated
  using (true);

-- Provenance. status 'published' (NOT 'active'): 'active' is the single-dataset sentinel
-- getActiveDataset() pins to bhw-2025; seeding another row 'active' is what blanked the site in
-- E4.3 (see DECISIONS #44). as_of_date = the latest reference year in the release (FY2023).
insert into dim_dataset (
  slug, name, source_name, source_url, license, geo_join_level, as_of_date, version, status
) values (
  'psa-sae-poverty-2023',
  'PSA 2023 Small Area Estimates of Poverty (city/municipal)',
  'Philippine Statistics Authority — 2023 City- and Municipal-Level Small Area Estimates of Poverty (national government-funded SAE project)',
  'https://psa.gov.ph/statistics/poverty-sae',
  'PSA open data terms (attribution)',
  'citymun',
  '2023-12-31',
  '1.0',
  'published'
)
on conflict (slug) do nothing;
