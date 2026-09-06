-- Register the three NHFR relations (docs/NHFR_2026_PLAN.md §Deferred, increment N5).
--
-- The rows below are lifted verbatim from the canonical seed,
-- supabase/migrations/20260826090100_seed_dataset_registry.sql, which stays the single source for
-- what the registry says — this file only carries the delta to the live project, on the same
-- pattern as U5's, U7's, U9's, U10's, U12b's, D1.6's and D3.4's registry deltas.
-- `lib/db/dataset-registry-seed.test.ts` guards the canonical file, so the two cannot drift
-- without a test failing.
--
-- WHAT THIS BUYS: fact_nhfr_facility, agg_nhfr_counts and agg_nhfr_by_type were loaded live by
-- plan N1/N2 (44,799 / 1,792 / 10,648 rows) but registered nowhere, so queryDataset refused all
-- three outright regardless of RLS. This migration is the whole cost of making them queryable.
--
-- Wiring an actual chat surface onto /facilities (a DatasetScopeId, a system prompt, a
-- ChatLauncher wrapper — the U8 equivalent) is deliberately NOT this migration's scope; it is
-- recorded as its own remaining item in docs/DECISIONS.md.
insert into dataset_registry (
  table_name, title, summary, grain, dataset_slug, exposure, row_estimate,
  source_kind, status, notes_md, doc_path
) values
  ('fact_nhfr_facility',
   'DOH National Health Facility Registry, September 2026 snapshot',
   'One row per health facility on the public NHFR export retrieved 2026-09-05: its name, major type, type, ownership, service capability, bed capacity, licensing status and the geography it sits in. Contact and street-address columns from the source were never loaded - see the table note.',
   'One health facility.',
   'nhfr-2026-09', 'public', 44799, 'hand_written', 'approved',
   'CONTACT AND ADDRESS COLUMNS DO NOT EXIST IN THIS TABLE, NOT MERELY HIDDEN. The source carried email, alternate email, landline x2, fax, website and street address; none were loaded, because 18,413 of 20,194 source email addresses (91%) were personal gmail/yahoo/hotmail/outlook addresses of individual midwives and proprietors rather than institutional contacts (docs/DECISIONS.md, 2026-09-05). Never say a facility''s contact details are "not available" as though this table withholds them - there is nothing to withhold. LICENSING_STATUS BLANK MEANS NOT STATED, NEVER "UNLICENSED": 28,247 of 44,799 rows (63%) are blank, overwhelmingly Barangay Health Stations, which are not a licensed facility type at all. There is no way to know from this table which facilities are supposed to hold a licence, so NEVER COMPUTE OR IMPLY A "% LICENSED" FIGURE at any level. FACILITY_MAJOR_TYPE IS NOT A RELIABLE GROUPING KEY: 13 of the 45 facility_type values appear under both "Health Facility" and "Health Related Facility" in the source, lopsidedly (Rural Health Unit 2,744 against 1, Birthing Home 3,562 against 3) - this is per-facility encoding noise, not a second classification, which is why it is dropped entirely from agg_nhfr_by_type. Group and filter by facility_type, never facility_major_type. SULU''S 177 FACILITIES: source_region_name reads "REGION IX (ZAMBOANGA PENINSULA)" on every one, but geo_code resolves all of them to BARMM (dim_geo''s placement) - honour geo_code for any rollup and name both the source''s region text and the resolved region when the discrepancy matters, never one alone. geo_code is city/municipality grain and is never null, so it is the only guaranteed rollup path; barangay_geo_code is null on 108 of 44,799 rows (no barangay in the source). source_region_psgc/source_province_psgc/source_citymun_psgc/source_barangay_psgc and their _name counterparts are the codes and names AS THE SOURCE PRINTED THEM, before PSGC resolution - for the geography this dashboard actually files a facility under, read geo_code and barangay_geo_code, not these. Source: public export from nhfr.doh.gov.ph, retrieved 2026-09-05, as of 2026-09-01.',
   'docs/NHFR_2026_PLAN.md'),
  ('agg_nhfr_counts',
   'Health-facility counts by geography',
   'Facility totals per area from the NHFR September 2026 snapshot: the ownership split, the four headline facility types, total bed capacity, and barangay-level facility coverage - at national, region, province and city/municipality grain.',
   'One geography per dataset.',
   'nhfr-2026-09', 'public', 1792, 'hand_written', 'approved',
   'NO SMALL-CELL SUPPRESSION AND NO BARANGAY-LEVEL ROWS: this counts places, not people, so every geo at national/region/province/citymun gets a row including zero - a zero is data, never missing. n_barangay_health_station, n_rural_health_unit, n_hospital and n_birthing_home ARE THE FOUR HEADLINE TYPES ONLY AND DO NOT SUM TO n_facilities - 41 other facility types exist; read agg_nhfr_by_type for the full per-type breakdown. n_barangays_with_facility over n_barangays is the coverage figure (28,490 of 41,958 barangays nationally have at least one facility) - n_barangays is every barangay in the area from dim_geo, not a facility count, and the two must never be swapped. Nothing here supports a "% licensed" figure - see fact_nhfr_facility''s note. Sulu''s facilities are filed under BARMM at every level, same as the fact table.',
   'docs/NHFR_2026_PLAN.md'),
  ('agg_nhfr_by_type',
   'Health-facility counts by geography and facility type',
   'Facility counts by the 45 NHFR facility types, per area, from the September 2026 snapshot - one row per geo x type actually present.',
   'one geography × facility type present',
   'nhfr-2026-09', 'public', 10648, 'hand_written', 'approved',
   'SPARSE BY CONSTRUCTION: a row exists only where the count is non-zero, so a facility type absent from an area has NO ROW, not a zero row - never read a missing (geo_code, facility_type) pair as zero without checking agg_nhfr_counts.n_facilities first. Sum this table''s rows for one geo to reproduce agg_nhfr_counts.n_facilities for the same geo; read the total from there directly rather than summing when only the total is needed. facility_major_type IS DELIBERATELY NOT A COLUMN HERE: an end-to-end run found that 13 of the 45 facility_type values appear under both major-type values in the source, which split one type''s count across two rows sharing the same (geo_code, facility_type) key and broke the aggregate outright (docs/DECISIONS.md, 2026-09-05) - facility_major_type stays on fact_nhfr_facility only, where it describes the facility rather than groups it. n_government + n_private = n_facilities on every row.',
   'docs/NHFR_2026_PLAN.md')
on conflict (table_name) do update set
  title = excluded.title,
  summary = excluded.summary,
  grain = excluded.grain,
  dataset_slug = excluded.dataset_slug,
  exposure = excluded.exposure,
  row_estimate = excluded.row_estimate,
  source_kind = excluded.source_kind,
  status = excluded.status,
  notes_md = excluded.notes_md,
  doc_path = excluded.doc_path,
  updated_at = now();

insert into dataset_column (
  registry_id, column_name, ordinal, data_type, allowed_values,
  meaning, unit, role, is_join_key, joins_to, is_queryable, status
)
select
  r.registry_id, c.column_name, c.ordinal, c.data_type,
  case when c.allowed_values is null then null else string_to_array(c.allowed_values, '|') end,
  c.meaning, c.unit, c.role, c.is_join_key, c.joins_to, c.is_queryable, 'approved'
from (values
  ('fact_nhfr_facility','id',1,'bigint',null,'Surrogate row identifier; carries no meaning.',null,'meta',false,null,false),
  ('fact_nhfr_facility','dataset_id',2,'bigint',null,'Source dataset - nhfr-2026-09 on every row.',null,'key',true,'dim_dataset.dataset_id',true),
  ('fact_nhfr_facility','facility_code',3,'text',null,'The source''s own primary key (DOH0000000000NNNNN). Unique across all 44,799 rows.',null,'key',false,null,true),
  ('fact_nhfr_facility','facility_code_short',4,'text',null,'A shortened form of facility_code used on the site''s facility list. Carries the same identity as facility_code.',null,'dimension',false,null,true),
  ('fact_nhfr_facility','facility_name',5,'text',null,'The facility''s name as the source prints it.',null,'dimension',false,null,true),
  ('fact_nhfr_facility','facility_major_type',6,'text','Health Facility|Health Related Facility','NOT A RELIABLE GROUPING KEY - 13 of the 45 facility_type values appear under both values in the source, lopsidedly, which is per-facility encoding noise rather than a second classification. Never group or filter on this column; use facility_type.',null,'dimension',false,null,true),
  ('fact_nhfr_facility','facility_type',7,'text',null,'One of 45 facility types (Barangay Health Station, Rural Health Unit, Hospital, Clinical Laboratory, Birthing Home, ...). The classification to group and filter on.',null,'dimension',false,null,true),
  ('fact_nhfr_facility','ownership_major',8,'text','Government|Private','Top-level ownership split.',null,'dimension',false,null,true),
  ('fact_nhfr_facility','ownership_sub',9,'text',null,'Finer ownership sub-classification (e.g. LGU, DOH-retained, Single Proprietorship). Null where the source gave none.',null,'dimension',false,null,true),
  ('fact_nhfr_facility','geo_code',10,'text',null,'The facility''s city/municipality, resolved to dim_geo. NEVER NULL - every facility has one, which is why this is the guaranteed rollup grain rather than barangay_geo_code. Sulu''s 177 facilities resolve here to BARMM regardless of what source_region_name says.',null,'key',true,'dim_geo.geo_code',true),
  ('fact_nhfr_facility','barangay_geo_code',11,'text',null,'The facility''s barangay, resolved to dim_geo. NULL ON 108 OF 44,799 ROWS - the source gave no barangay for them. A null here is a real gap, not a resolution failure; geo_code is still populated for every one of those 108.',null,'key',true,'dim_geo.geo_code',true),
  ('fact_nhfr_facility','source_region_psgc',12,'text',null,'The region PSGC code AS THE SOURCE PRINTED IT, before resolution. For the resolved geography, read geo_code instead - this and source_region_name disagree with it for Sulu''s 177 facilities by design (see the table note).',null,'dimension',false,null,true),
  ('fact_nhfr_facility','source_region_name',13,'text',null,'The region name AS THE SOURCE PRINTED IT. Says "REGION IX (ZAMBOANGA PENINSULA)" for all 177 Sulu facilities, which geo_code files under BARMM instead - name both when the discrepancy matters.',null,'dimension',false,null,true),
  ('fact_nhfr_facility','source_province_psgc',14,'text',null,'The province PSGC code AS THE SOURCE PRINTED IT, before resolution.',null,'dimension',false,null,true),
  ('fact_nhfr_facility','source_province_name',15,'text',null,'The province name AS THE SOURCE PRINTED IT.',null,'dimension',false,null,true),
  ('fact_nhfr_facility','source_citymun_psgc',16,'text',null,'The city/municipality PSGC code AS THE SOURCE PRINTED IT, before resolution to geo_code.',null,'dimension',false,null,true),
  ('fact_nhfr_facility','source_citymun_name',17,'text',null,'The city/municipality name AS THE SOURCE PRINTED IT.',null,'dimension',false,null,true),
  ('fact_nhfr_facility','source_barangay_psgc',18,'text',null,'The barangay PSGC code AS THE SOURCE PRINTED IT, before resolution to barangay_geo_code. Null on the same 108 rows barangay_geo_code is null on.',null,'dimension',false,null,true),
  ('fact_nhfr_facility','source_barangay_name',19,'text',null,'The barangay name AS THE SOURCE PRINTED IT.',null,'dimension',false,null,true),
  ('fact_nhfr_facility','service_capability',20,'text',null,'Free-text service capability as the source recorded it. No fixed vocabulary - not for grouping or comparison across facilities.',null,'dimension',false,null,true),
  ('fact_nhfr_facility','bed_capacity',21,'integer',null,'Bed capacity as the source recorded it, thousands separators stripped. 0 where the source gave none or the facility carries no beds (e.g. most Barangay Health Stations).','count','measure',false,null,true),
  ('fact_nhfr_facility','licensing_status',22,'text','With License|Without License','BLANK ON 28,247 OF 44,799 ROWS (63%), OVERWHELMINGLY BARANGAY HEALTH STATIONS, AND BLANK MEANS NOT STATED, NEVER "UNLICENSED". Never compute or imply a percent-licensed figure from this column at any level - there is no way to know from this table which facilities are supposed to hold a licence.',null,'dimension',false,null,true),
  ('fact_nhfr_facility','license_validity_date',23,'date',null,'The licence''s expiry date where the source gave one. Null wherever licensing_status is null or ''Without License''.',null,'dimension',false,null,true),
  ('agg_nhfr_counts','id',1,'bigint',null,'Surrogate row identifier; carries no meaning.',null,'meta',false,null,false),
  ('agg_nhfr_counts','dataset_id',2,'bigint',null,'Source dataset - nhfr-2026-09 on every row.',null,'key',true,'dim_dataset.dataset_id',true),
  ('agg_nhfr_counts','geo_code',3,'text',null,'The geography this row totals.',null,'key',true,'dim_geo.geo_code',true),
  ('agg_nhfr_counts','geo_level',4,'geo_level_enum','national|region|province|citymun','Grain of this row. NO barangay-level rows exist in this table - a city page reads its own facilities from fact_nhfr_facility directly instead.',null,'dimension',false,null,true),
  ('agg_nhfr_counts','n_facilities',5,'integer',null,'Total facilities in this area, all 45 types.','count','measure',false,null,true),
  ('agg_nhfr_counts','n_government',6,'integer',null,'Facilities with ownership_major = Government.','count','measure',false,null,true),
  ('agg_nhfr_counts','n_private',7,'integer',null,'Facilities with ownership_major = Private.','count','measure',false,null,true),
  ('agg_nhfr_counts','n_barangay_health_station',8,'integer',null,'One of the four headline facility_type counts. DOES NOT, with the other three, SUM TO n_facilities - 41 other facility types exist; see agg_nhfr_by_type for the rest.','count','measure',false,null,true),
  ('agg_nhfr_counts','n_rural_health_unit',9,'integer',null,'One of the four headline facility_type counts. See n_barangay_health_station''s note on why the four do not sum to n_facilities.','count','measure',false,null,true),
  ('agg_nhfr_counts','n_hospital',10,'integer',null,'One of the four headline facility_type counts. See n_barangay_health_station''s note on why the four do not sum to n_facilities.','count','measure',false,null,true),
  ('agg_nhfr_counts','n_birthing_home',11,'integer',null,'One of the four headline facility_type counts. See n_barangay_health_station''s note on why the four do not sum to n_facilities.','count','measure',false,null,true),
  ('agg_nhfr_counts','total_bed_capacity',12,'integer',null,'Sum of fact_nhfr_facility.bed_capacity over this area''s facilities.','count','measure',false,null,true),
  ('agg_nhfr_counts','n_barangays_with_facility',13,'integer',null,'Barangays in this area with at least one facility. THE NUMERATOR of the coverage figure - pair with n_barangays, never with n_facilities.','count','measure',false,null,true),
  ('agg_nhfr_counts','n_barangays',14,'integer',null,'Every barangay in this area, from dim_geo - NOT a facility count. THE DENOMINATOR of the coverage figure, paired with n_barangays_with_facility.','count','measure',false,null,true),
  ('agg_nhfr_by_type','id',1,'bigint',null,'Surrogate row identifier; carries no meaning.',null,'meta',false,null,false),
  ('agg_nhfr_by_type','dataset_id',2,'bigint',null,'Source dataset - nhfr-2026-09 on every row.',null,'key',true,'dim_dataset.dataset_id',true),
  ('agg_nhfr_by_type','geo_code',3,'text',null,'The geography this row totals.',null,'key',true,'dim_geo.geo_code',true),
  ('agg_nhfr_by_type','geo_level',4,'geo_level_enum','national|region|province|citymun','Grain of this row. No barangay-level rows, same as agg_nhfr_counts.',null,'dimension',false,null,true),
  ('agg_nhfr_by_type','facility_type',5,'text',null,'One of the 45 NHFR facility types. A (geo_code, facility_type) PAIR WITH NO ROW MEANS ZERO OF THAT TYPE IN THAT AREA - this table is sparse by construction, not incomplete.',null,'dimension',false,null,true),
  ('agg_nhfr_by_type','n_facilities',6,'integer',null,'Facilities of this type in this area. Summing every row for one geo_code reproduces agg_nhfr_counts.n_facilities for that geo.','count','measure',false,null,true),
  ('agg_nhfr_by_type','n_government',7,'integer',null,'Of n_facilities, those with ownership_major = Government.','count','measure',false,null,true),
  ('agg_nhfr_by_type','n_private',8,'integer',null,'Of n_facilities, those with ownership_major = Private. n_government + n_private = n_facilities on every row.','count','measure',false,null,true)
) as c (
  table_name, column_name, ordinal, data_type, allowed_values,
  meaning, unit, role, is_join_key, joins_to, is_queryable
)
join dataset_registry r on r.table_name = c.table_name
on conflict (registry_id, column_name) do update set
  ordinal = excluded.ordinal,
  data_type = excluded.data_type,
  allowed_values = excluded.allowed_values,
  meaning = excluded.meaning,
  unit = excluded.unit,
  role = excluded.role,
  is_join_key = excluded.is_join_key,
  joins_to = excluded.joins_to,
  is_queryable = excluded.is_queryable,
  status = excluded.status;
