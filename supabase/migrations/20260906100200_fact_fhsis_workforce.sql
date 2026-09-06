-- DOH FHSIS 2025 — the public health workforce, minus BHWs by construction (plan F1).
--
-- Grain: one row per (dataset, geography, cadre). 13,952 rows: 8 cadres × 1,744 geographies
-- (national, 18 regions, 115 provinces/HUCs, 1,610 cities and municipalities), from the
-- `Health Workers` sheet of Demographic_2025_EB_Final.xlsx.
--
-- ===========================================================================================
-- THE BHW CADRE DOES NOT EXIST IN THIS TABLE. NOT HIDDEN — IT DOES NOT EXIST.
-- ===========================================================================================
--
-- FHSIS never supplies a BHW count for this site. That is an owner decision (plan Decision 2),
-- not a preference, and the source's own numbers are the argument: the Demographics workbook's
-- `Active Barangay Health Workers (BHW)` column reports 270,766 nationally, 4,454 for the whole
-- of NCR, and **1 for Las Piñas**. It is a tally of what LGUs happened to file through their
-- RHUs, not a census. This site's BHW figure is the `bhw-2025` census with the StepZero
-- quick-count as the universe, and publishing FHSIS's column beside it would undercut a census
-- with a source known to be under-reported.
--
-- So the column is dropped at cleaning — it exists in no CSV and therefore in no table — exactly
-- as ingestion/clean_nhfr.py drops the contact columns. The rule is enforced three times over,
-- independently, because a rule enforced once is a rule that survives until someone edits one
-- file:
--
--   1. ingestion/clean_fhsis.py drops columns 36 and 37 and asserts no BHW cadre reaches the CSV;
--   2. the `check (cadre <> 'bhw')` below, so the database refuses the row even if a future
--      loader tried;
--   3. ingestion/ingest_fhsis.py asserts `count(*) where cadre = 'bhw'` is 0 before it commits.
--
-- The assistant must therefore never answer "FHSIS's BHW count is unavailable", as though
-- something were being withheld. There is no such figure here, and the census is the answer.
--
-- The one derived figure that touches BHWs at all — BHWs per midwife, per nurse, per doctor —
-- takes its NUMERATOR from agg_bhw_counts, this site's own census, and only its denominator from
-- this table.
--
-- ===========================================================================================
--
-- **population_2025 and households_2025 are the SOURCE'S denominators, never the site's**
-- (plan Decision 5). They are DOH projections, carried here for two narrow reasons: a published
-- rate must be recomputable against the base it was computed on, and they are the denominators of
-- the workforce ratios this dataset publishes. NO PER-CAPITA OR PER-HOUSEHOLD FIGURE ANYWHERE
-- ELSE ON THIS SITE MOVES ONTO THEM — not the map, not getBhwOverview, not householdsPerBhw. The
-- site's per-capita denominator is StepZero's own self-reported population, permanently, with
-- agg_population as the fallback and cross-check (owner decision, docs/DECISIONS.md 2026-09-06,
-- which explicitly reverses E4.2's swap and asks not to be re-litigated). "FHSIS is more recent"
-- is "census is more official" wearing a different hat, and that decision already answered it.
--
-- The source's own Ratio columns (population ÷ total, one per cadre) are not carried: they are
-- recomputable from two columns that are, and Decision 4's rule is to store the counts.
--
-- lineage: table:fact_fhsis_workforce built-by script:ingestion/ingest_fhsis.py
-- lineage: table:fact_fhsis_workforce derived-from doc:docs/FHSIS_2025_CLEANING_REPORT.md
create table fact_fhsis_workforce (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),

  geo_code text not null references dim_geo (geo_code),
  geo_level geo_level_enum not null,

  -- physician | nurse | midwife | dentist | med_tech | nutritionist | sanitary_engineer |
  -- sanitary_inspector. Eight cadres, and never a ninth: see the header.
  cadre text not null,

  -- The source splits every cadre by who pays for the post. Both are published; total is the
  -- source's own total rather than lgu_hired + doh_hired recomputed, so a source that disagrees
  -- with itself is visible rather than silently reconciled.
  lgu_hired integer,
  doh_hired integer,
  total integer,

  -- The source's own denominators. See the header: loaded, never promoted.
  population_2025 integer,
  households_2025 integer,

  source_psgc text,
  source_area_name text,

  unique (dataset_id, geo_code, cadre),

  -- Belt and braces. The cleaner already dropped the column, so nothing should ever reach this;
  -- it is here so that "FHSIS supplies no BHW count" is a property of the schema and not only of
  -- a Python file someone could edit.
  constraint fact_fhsis_workforce_never_bhw check (cadre <> 'bhw')
);

create index fact_fhsis_workforce_geo_idx on fact_fhsis_workforce (geo_code);
create index fact_fhsis_workforce_dataset_idx on fact_fhsis_workforce (dataset_id);
create index fact_fhsis_workforce_cadre_idx on fact_fhsis_workforce (dataset_id, cadre, geo_level);

comment on table fact_fhsis_workforce is
  'DOH FHSIS 2025: the public health workforce by city/municipality, province, region and nationally — 8 cadres, each split LGU-hired and DOH-hired. THE BHW CADRE DOES NOT EXIST IN THIS TABLE, AND IS NOT MERELY HIDDEN: FHSIS never supplies a BHW count for this site (owner decision). The source''s BHW column reports 1 for Las Piñas and 4,454 for all of NCR — a tally of LGU filings, not a census. This site''s BHW figure is the bhw-2025 census with the StepZero quick-count as the universe; never answer that a FHSIS BHW count is unavailable, because there is no such figure here. population_2025 and households_2025 are the SOURCE''S OWN DOH projections, this dataset''s base and nothing else''s — BHW-per-capita figures on this site read StepZero''s population (agg_bhw_stepzero_counts) with agg_population as the fallback, never these columns. See docs/FHSIS_2025_PLAN.md.';

alter table fact_fhsis_workforce enable row level security;

-- Public, non-personal: counts of posts by place, not people. Anyone may read; no client writes.
create policy "fact_fhsis_workforce public read" on fact_fhsis_workforce
  for select
  to anon, authenticated
  using (true);
