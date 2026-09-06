-- DOH FHSIS 2025 annual release — service-delivery indicators (plan F1, docs/FHSIS_2025_PLAN.md).
--
-- Grain: one row per (dataset, geography, indicator, breakdown). 80,053 rows: 20 indicators
-- across four program areas, at every grain the source publishes — national, region,
-- province/HUC and city/municipality — with the sex and age-band splits the source carries.
--
-- **Long format, not one column per indicator.** Twenty indicators wide would be unreadable and
-- unindexable, and would need a migration every time a program area is added; the deferred Tier 1
-- areas (HIV, leprosy, rabies, the antigen-by-antigen immunisation files) load into this shape
-- with no new DDL at all. `agg_population`'s one-row-per-source×geo×year is the in-repo precedent
-- for a multi-measure companion table.
--
-- **Counts, never an averaged rate (plan Decision 4).** Numerator, denominator and the rate as the
-- source printed it are all stored, so a figure is recomputable against the base it was computed
-- on. NO SURFACE MAY AVERAGE rate_pct. Where a page needs an area's figure it reads that area's
-- own published row — which exists, because every grain is loaded. Rollups are never recomputed
-- from leaves either: the source publishes its own subtotals and its leaf table is incomplete
-- (78 of 83 comparable provinces reconcile exactly with their cities; the other five differ by
-- exactly the figure of an independent city that dim_geo nests under the province and the source's
-- province row excludes). ref_fhsis_reconciliation publishes that gap rather than hiding it.
--
-- **No agg_fhsis_* table exists, deliberately.** The source publishes every grain a page renders,
-- so an aggregate would either duplicate a published row or average a rate.
--
-- **A missing (geo, indicator, breakdown) means NOT REPORTED, never zero (plan Decision 7).**
-- This table deliberately does *not* left join dim_geo to write zeros into existence the way
-- agg_nhfr_counts does, and that is the one considered departure from the NHFR precedent: here
-- the absence means something different. The workbooks' own legend distinguishes them — an
-- asterisk is "incomplete data/no data submitted", a zero is "zero data/zero cases" — so a row
-- with numerator 0 is a place that delivered nothing and must be rendered as such, while no row
-- at all is a place that did not report and must be rendered as that instead. Conflating them
-- invents a zero and defames a city.
--
-- Source and licence: the public Drive archive at https://bit.ly/FHSISPHSannualreports (folder
-- 16z6srVbGODqmgGHU4_Qg1oDBOglqp_XG, owned by fhsisreports@doh.gov.ph, readable with no login),
-- 2025 Annual Excel folder, retrieved 2026-09-06. Public-with-citation is the basis, per the
-- owner decision recorded at docs/EXPLORE_ENHANCEMENT_PLAN.md:19. The archive is mutable and the
-- 2025 release is partial at retrieval, so dim_dataset.source_name says so and a later pull is a
-- new version rather than a correction of this one.
--
-- lineage: table:fact_fhsis_indicator built-by script:ingestion/ingest_fhsis.py
-- lineage: table:fact_fhsis_indicator derived-from doc:docs/FHSIS_2025_CLEANING_REPORT.md
create table fact_fhsis_indicator (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),

  -- Resolved dim_geo code, NOT NULL: the load-time guard. The source's PSGC column is unreliable
  -- in two specific ways — about 70 rows per sheet have their leading zeros stripped and the
  -- value right-padded, and one block has the province's and first municipality's codes swapped
  -- outright — so ingestion/clean_fhsis.py resolves in three stages and the loader re-resolves
  -- through map_psgc_to_dim_geo(). An unresolvable code fails this constraint rather than
  -- silently dropping an area. source_psgc below preserves what the source actually printed.
  geo_code text not null references dim_geo (geo_code),
  -- national | region | province | citymun. Never barangay: the source has no barangay grain,
  -- which is why /health-services/barangay/* 404s by design.
  geo_level geo_level_enum not null,

  indicator_key text not null references ref_fhsis_indicator (indicator_key),

  -- total | male | female | 10-14 | 15-19 | 20-49 | 0-14 | 15+
  --
  -- '10-14' is not a mistake and not an anomaly to be filtered: FHSIS publishes maternal care by
  -- age band including 10-14, i.e. adolescent reproductive-health service counts, at city and
  -- municipality grain. They are loaded because the registry and the assistant need them, and
  -- they are NOT RENDERED on any page until the owner says otherwise — publishing them beside a
  -- place name is a separate decision from loading them. '0-14' and '15+' come from TB's
  -- treatment and preventive-treatment tables, which split by a different pair of bands.
  breakdown text not null default 'total',

  -- As published. NULL where the sheet published nothing for this cell — see the NOT REPORTED
  -- note above. A male/female or 0-14/15+ breakdown usually carries a numerator only, because
  -- the source publishes the denominator and the rate against the total alone.
  numerator integer,
  denominator integer,
  -- As published, unrounded, uncapped. May exceed 100 for a percentage indicator; for the two TB
  -- notification indicators this is per 100,000 population and is normally in the hundreds —
  -- read ref_fhsis_indicator.unit before rendering it.
  rate_pct numeric,

  -- rate_pct > 100 for a *percentage* indicator, set at cleaning and re-derived by the loader.
  -- Rendered with the † and footnote docs/UUC_PHC_2025_PLAN.md U3 established. The value is never
  -- capped: FHSIS publishes the numerator and the denominator, so the overshoot is explainable
  -- ("1,234 children immunised against a projected 1,100 eligible"), which is more honest than a
  -- ceiling. This is the decisive difference from the UUC workbook, whose source-computed values
  -- had to be bounded blind.
  --
  -- Deliberately false for the per-100,000 indicators even when the value exceeds 100: a
  -- notification rate of 473 is ordinary, and a marker that fires on ordinary figures stops being
  -- read on the ones where it matters.
  over_100 boolean not null default false,

  -- What the source printed, before resolution: the code exactly as it appeared, and the area
  -- name exactly as it appeared. Kept because the resolution was not always trivial — these two
  -- columns are what make a repaired row auditable from the data itself rather than only from the
  -- cleaning report. DISPLAY NAMES COME FROM dim_geo, never from source_area_name.
  source_psgc text,
  source_area_name text,

  unique (dataset_id, geo_code, indicator_key, breakdown)
);

-- Read paths: an area's full indicator list (the citymun leaf page), one indicator across areas
-- at a level (the region table and the Relationships axes), and a program area's set.
create index fact_fhsis_indicator_geo_idx on fact_fhsis_indicator (geo_code);
create index fact_fhsis_indicator_dataset_idx on fact_fhsis_indicator (dataset_id);
create index fact_fhsis_indicator_lookup_idx
  on fact_fhsis_indicator (dataset_id, indicator_key, geo_level, breakdown);

comment on table fact_fhsis_indicator is
  'DOH FHSIS 2025 annual release: 20 service-delivery indicators at national, region, province and city/municipality grain, with the source''s own sex and age-band breakdowns. One row per (dataset, geography, indicator, breakdown). NEVER AVERAGE rate_pct — read the published row for the area instead; every grain is loaded. A rate above 100 is stored as published with over_100 = true and is never capped. READ ref_fhsis_indicator.unit FIRST: the TB notification rates are per 100,000, not percentages. A MISSING (geo, indicator, breakdown) MEANS NOT REPORTED, NOT ZERO. Denominators are DOH projections, this dataset''s own base and nothing else''s. See docs/FHSIS_2025_PLAN.md.';

alter table fact_fhsis_indicator enable row level security;

-- Public, non-personal: counts of service events by place, published by DOH for public use. No
-- person-characteristic breakdown of a registry, so no n<5 suppression applies (plan Decision 7;
-- agg_nhfr_counts and agg_uuc_phc_counts are the precedents). Anyone may read; no client writes.
create policy "fact_fhsis_indicator public read" on fact_fhsis_indicator
  for select
  to anon, authenticated
  using (true);
