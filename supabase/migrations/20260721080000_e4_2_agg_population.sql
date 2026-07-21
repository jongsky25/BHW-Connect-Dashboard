-- E4.2 Population: PSA 2024 POPCEN + 2020 CPH (docs/EXPLORE_ENHANCEMENT_PLAN.md §E4.2).
--
-- Long-format census population, one row per source × geo × census year, so each year keeps
-- its own provenance and reloads idempotently by its own dataset (the delete-by-dataset
-- pattern every agg_* table uses). Two sources feed it:
--   * PSA 2024 Census of Population (POPCEN)      -> census_year 2024 (dataset psa-popcen-2024)
--   * PSA 2020 Census of Population and Housing   -> census_year 2020 (dataset psa-cph-2020)
-- Only population is loaded here; the 2020 CPH *household* counts are a separate PSA table and
-- a documented follow-up (docs/DECISIONS.md).
--
-- Grain: national -> region -> province -> citymun. These PSA releases stop at city/
-- municipality (no barangay population), so barangay-level per-capita falls back to citymun,
-- mirroring agg_training's barangay gap. Figures are name-matched to dim_geo and rolled up
-- from the matched city/municipality leaves via dim_geo's post-NIR parentage (which is how the
-- pre-NIR CPH 2020 numbers land on the post-NIR Region XVIII automatically). Reconciliation
-- residuals — LGUs absent from dim_geo (no BHW records), Manila stored at its province node,
-- the 2022 Maguindanao split, Bacolod/Cotabato City — are documented in
-- ingestion/_qa_report_population.json and docs/DECISIONS.md (the 1.6 discipline), never
-- silently dropped. Data is loaded by ingestion/ingest_population.py; this migration is the
-- schema + provenance only. Applied live via the Supabase MCP.

create table if not exists agg_population (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),
  geo_code text not null references dim_geo (geo_code),
  geo_level geo_level_enum not null,
  census_year smallint not null,
  population integer not null,
  unique (dataset_id, geo_code, geo_level, census_year)
);

create index if not exists agg_population_geo_idx on agg_population (geo_code, census_year);

comment on table agg_population is
  'PSA census population (POPCEN 2024, CPH 2020) name-matched to dim_geo and rolled up from citymun leaves. Long format: one row per source × geo × census year. E4.2; see docs/EXPLORE_ENHANCEMENT_PLAN.md.';

alter table agg_population enable row level security;

drop policy if exists "agg_population public read" on agg_population;
create policy "agg_population public read" on agg_population
  for select
  to anon, authenticated
  using (true);

-- Provenance. status 'published' (NOT 'active'): 'active' is the single-dataset sentinel that
-- getActiveDataset() picks for the per-person bhw-2025 dataset; seeding another row 'active' is
-- what blanked the site in E4.3 (see DECISIONS #44). as_of_date = each census's reference date.
insert into dim_dataset (
  slug, name, source_name, source_url, license, geo_join_level, as_of_date, version, status
) values
  (
    'psa-popcen-2024',
    'PSA 2024 Census of Population (POPCEN)',
    'Philippine Statistics Authority — 2024 Census of Population (POPCEN 2024)',
    'https://psa.gov.ph/statistics/population-and-housing',
    'PSA open data terms (attribution)',
    'citymun',
    '2024-07-01',
    '1.0',
    'published'
  ),
  (
    'psa-cph-2020',
    'PSA 2020 Census of Population and Housing (CPH)',
    'Philippine Statistics Authority — 2020 Census of Population and Housing (CPH 2020)',
    'https://psa.gov.ph/statistics/population-and-housing',
    'PSA open data terms (attribution)',
    'citymun',
    '2020-05-01',
    '1.0',
    'published'
  )
on conflict (slug) do nothing;
