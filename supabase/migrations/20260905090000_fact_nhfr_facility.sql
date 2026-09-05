-- DOH National Health Facility Registry — the September 2026 snapshot of the public facility
-- universe (plan N1, docs/NHFR_2026_PLAN.md).
--
-- Grain: one row per registered health facility. 44,799 of them, across all 18 regions.
--
-- Why a fact table and not an aggregate: the facility is the unit, and N2's agg_nhfr_counts /
-- agg_nhfr_by_type roll these rows up to citymun/province/region/national. A city/municipality
-- page reads its own facilities from this table directly, which is why there are no
-- barangay-level aggregate rows (agg_uuc_phc_counts's precedent).
--
-- Source and licence: exported from the public site nhfr.doh.gov.ph, retrieved 2026-09-05.
-- Public-with-citation is the basis, per the owner decision recorded at
-- docs/EXPLORE_ENHANCEMENT_PLAN.md:19 ("NHFR/FHSIS: use whatever is publicly available online,
-- with citation") and confirmed as FOI-covered. The retrieval date lives in dim_dataset.
--
-- NHFR is a *live* registry, not a periodic publication, so this table holds a point-in-time
-- snapshot: the dataset slug carries its month (nhfr-2026-09) and a later export is a new
-- version rather than a correction of this one.
--
-- Contact and street-address columns are deliberately NOT carried. Of the 20,194 email addresses
-- in the export, 18,413 (91%) are free webmail — the personal addresses of individual midwives
-- and proprietors, not institutional contacts. This table is anon-readable over PostgREST and
-- its derivatives publish under CC BY 4.0, so loading them would republish ~18,000 personal
-- email addresses. docs/BUILD_PLAN.md pitfall P16 sets the precedent. See ingestion/clean_nhfr.py
-- for the full excluded list, each with its reason.
create table fact_nhfr_facility (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),

  -- The registry's own key (DOH0000000000NNNNN). Unique across all 44,799 rows in the source,
  -- so it is the natural key rather than a surrogate: a re-export can be diffed against it.
  facility_code text not null,
  -- The same code without its padding, as the export also supplies it. Kept because the public
  -- NHFR site addresses facilities by the short form.
  facility_code_short text,
  facility_name text not null,

  -- 'Health Facility' (44,586) or 'Health Related Facility' (213).
  facility_major_type text not null,
  -- 45 distinct values. Barangay Health Station alone is 27,186 of the 44,799.
  facility_type text not null,

  -- 'Government' (33,524) or 'Private' (11,275).
  ownership_major text not null,
  -- The source's two sub-classification columns folded into one. They are meant to be mutually
  -- exclusive and are for 44,784 rows; 15 carry both, and the loader resolves those by honouring
  -- ownership_major (docs/BUILD_PLAN.md P15's reconcile-by-rule-and-log discipline).
  ownership_sub text,

  -- Resolved dim_geo codes. geo_code is city/municipality grain and NOT NULL: every facility in
  -- the export carries a city/municipality code, so every facility has a guaranteed rollup path,
  -- and NOT NULL is the load-time guard — an unresolvable code fails the insert rather than
  -- silently dropping a facility.
  geo_code text not null references dim_geo (geo_code),
  -- Barangay grain, nullable: 108 of 44,799 facilities carry no barangay code in the source.
  -- Requiring it would mean either dropping those 108 or inventing a code for them.
  barangay_geo_code text references dim_geo (geo_code),

  -- The codes and names exactly as the export prints them, before resolution. These matter for
  -- Sulu, where the export is internally inconsistent: all 177 Sulu facilities are *named* under
  -- Region IX, while 152 carry BARMM-vintage '19066…' codes and 25 carry Region IX '09066…'
  -- ones. Both resolve onto dim_geo's BARMM placement — the 152 directly, the 25 through the
  -- existing 20260826121200_crosswalk_sulu_region_ix.sql — so the rollups file Sulu under BARMM
  -- while these columns preserve what the source said. Display names come from dim_geo, never
  -- from these.
  source_region_psgc text,
  source_region_name text,
  source_province_psgc text,
  source_province_name text,
  source_citymun_psgc text,
  source_citymun_name text,
  source_barangay_psgc text,
  source_barangay_name text,

  service_capability text,
  bed_capacity integer not null default 0,

  -- 'With License' (15,441), 'Without License' (1,111), or NULL (28,247). The source stores the
  -- field name inside the value ("Licensing Status:With License"); the loader strips it.
  --
  -- NULL means *not stated*, never "unlicensed". The blanks are overwhelmingly Barangay Health
  -- Stations, which are not a licensed facility type. Any surface rendering this column must
  -- honour that distinction.
  licensing_status text,
  license_validity_date date,

  unique (dataset_id, facility_code)
);

-- Read paths: "all facilities in this city/municipality" (the drill-down leaf and the N2
-- rollups), the barangay-coverage count, and type/ownership breakdowns per area.
create index fact_nhfr_facility_geo_idx on fact_nhfr_facility (geo_code);
create index fact_nhfr_facility_barangay_idx on fact_nhfr_facility (barangay_geo_code);
create index fact_nhfr_facility_dataset_idx on fact_nhfr_facility (dataset_id);
create index fact_nhfr_facility_type_idx on fact_nhfr_facility (dataset_id, facility_type);

comment on table fact_nhfr_facility is
  'The 44,799 health facilities on the DOH National Health Facility Registry as of September 2026 (public export from nhfr.doh.gov.ph, retrieved 2026-09-05). One row per facility. Contact and street-address columns are deliberately excluded — see ingestion/clean_nhfr.py. See docs/NHFR_2026_PLAN.md.';

alter table fact_nhfr_facility enable row level security;

-- Public, non-personal (a published register of places, with the personal contact fields left
-- out at ingestion): anyone may read; no client writes.
create policy "fact_nhfr_facility public read" on fact_nhfr_facility
  for select
  to anon, authenticated
  using (true);
