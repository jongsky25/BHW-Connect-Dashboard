-- UUC for PHC 2025 — the published list of Unserved and Underserved Communities for Primary
-- Health Care (docs/UUC_PHC_2025_PLAN.md increment U1).
--
-- Grain: one row per barangay ON the 2025 list. Membership is presence: a barangay in this
-- table is UUC for PHC, one absent from it is not. The source workbook's `NEW` sheet also
-- carries the barangays it assessed and did NOT list ('NOT UUA'), and those are deliberately not
-- loaded — the owner scoped this dataset to the listed barangays. So
-- there is no `decision` column: it would read 'UUA' on every row. Anything needing "share of
-- barangays in this area" takes its denominator from dim_geo, which is the complete universe
-- (41,958 barangays), not from the workbook's partial assessed set.
--
-- Why a fact table and not an aggregate: the list is the unit of analysis here, and U2's
-- agg_uuc_phc_counts rolls these rows up to citymun/province/region/national. Indicators
-- (the 12 cleaned columns in ingestion/data/uuc_phc_2025_cleaned.csv) are U3 and are NOT
-- loaded here — U3 needs a display rule for capped values first, since 886 Water and 456 FIC
-- values read as exactly 100% (docs/UUC_PHC_2025_CLEANING_REPORT.md §6).
--
-- Policy basis: DOH AO No. 2020-0023 defines the criteria; DC No. 2025-0549 issues the 2025
-- list. Published total is 5,987 — the source office's final list, which is also what cue cards
-- p37 reports. The workbook this table was first built from said 5,991; the six-barangay
-- difference is reconciled in 20260828180000_uuc_phc_final_list_alignment.sql
-- (docs/UUC_PHC_2025_PLAN.md §3).
create table fact_uuc_phc_barangay (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),
  -- Resolved dim_geo code. NOT NULL is the load-time guard: the 87 Sulu codes only resolve
  -- through dim_psgc_crosswalk, so a missing crosswalk row fails the insert instead of
  -- silently dropping a barangay.
  geo_code text not null references dim_geo (geo_code),
  -- The code exactly as the workbook supplies it. Differs from geo_code for Sulu's 87
  -- barangays (source '09066…' under Region IX vs dim_geo's '19066…' under BARMM), so the
  -- remap stays visible in the data rather than only in the loader.
  source_geo_code text not null,
  -- Names as given, kept for provenance and for auditing the name-based PSGC join that
  -- produced source_geo_code. Display names come from dim_geo, never from these.
  source_region text,
  source_province text,
  source_citymun text,
  source_barangay text,
  unique (dataset_id, geo_code)
);

-- Read paths: membership lookup for one barangay, and "all listed barangays under X" for the
-- U2 rollups and the drill-down (dim_geo carries the parent chain, so the join is on geo_code).
create index fact_uuc_phc_barangay_geo_idx on fact_uuc_phc_barangay (geo_code);
create index fact_uuc_phc_barangay_dataset_idx on fact_uuc_phc_barangay (dataset_id);

comment on table fact_uuc_phc_barangay is
  'The 5,987 barangays on the 2025 Unserved and Underserved Communities for Primary Health Care list (DC No. 2025-0549; criteria per DOH AO No. 2020-0023). Presence = listed. See docs/UUC_PHC_2025_PLAN.md.';

alter table fact_uuc_phc_barangay enable row level security;

-- Public, non-personal (a published list of places): anyone may read; no client writes.
create policy "fact_uuc_phc_barangay public read" on fact_uuc_phc_barangay
  for select
  to anon, authenticated
  using (true);
