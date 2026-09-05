-- Register agg_bhw_by_district (docs/LEGISLATIVE_DISTRICTS_PLAN.md §6 D3.4 §1).
--
-- The row below is lifted verbatim from the canonical seed,
-- supabase/migrations/20260826090100_seed_dataset_registry.sql, which stays the single source for
-- what the registry says — this file only carries the delta to the live project, on the same
-- pattern as U5's, U7's, U9's, U10's, U12b's, D1.6's and D2.6's registry applies.
-- `lib/db/dataset-registry-seed.test.ts` guards the canonical file, so the two cannot drift
-- without a test failing.
--
-- WHAT THIS BUYS, STATED THE WAY THE PLAN STATES IT: "the generic queryDataset tool then answers
-- district questions with no new code". agg_bhw_by_district (D3.1) already exists; this migration
-- is the whole cost of making it queryable, because queryDataset refuses any relation with no
-- approved dictionary. dataset_slug is 'ph-legislative-districts', not 'bhw-2025' — the same
-- choice D2.6's entry for agg_bhw_by_uuc_status made and explained: the table's *rows* are figures
-- from the profiled census, but the *table* exists only because the district mapping resolves
-- them, and dataset_slug is what lets the district chat scope (added alongside this migration in
-- lib/ai/dataset-scope.ts) reach it through `createDatasetTools("public", [DATASET_SLUGS.legislativeDistricts])`.
-- Filed under 'bhw-2025' it would be invisible to that scope and unreachable by the very feature
-- this migration exists to unlock.
insert into dataset_registry (
  table_name, title, summary, grain, dataset_slug, exposure, row_estimate,
  source_kind, status, notes_md, doc_path
) values
  ('agg_bhw_by_district',
   'BHW counts and rates per legislative district',
   'One row per district carrying the same counts and rates agg_bhw_counts gives per geography - total and accredited BHWs, accreditation rate, average years active, and any-honorarium share - rolled up from the barangay grain rather than from a member city''s citymun row.',
   'one district × dataset',
   'ph-legislative-districts', 'public', 249, 'hand_written', 'approved',
   'DERIVED FROM THE DISTRICT MAPPING AND THE PROFILED CENSUS TOGETHER, NOT AN INDEPENDENT COUNT. Every row sums fact_bhw_raw at the LEAF (barangay) grain through geo_district_map''s live rows, never from a member city''s own citymun total - a multi-district city''s headcount would otherwise land on whichever sibling district''s citymun row it hit, or be double-counted across all of them. dataset_id is bhw-2025 on every current row, but the row exists only because the district mapping resolves it - quoting one carries this dataset''s vintage AND the mapping''s own Congress caveat together, the same as agg_bhw_by_uuc_status carries two datasets'' vintages for one row. ABSENCE MEANS AN UNRESOLVED GAP, NEVER ZERO BHWs: a district with no row here has no live geo_district_map member at all (docs/LEGISLATIVE_DISTRICTS.md''s uncovered LGUs and unplaced barangays) - City of Imus, Cavite''s 3rd''s only member, is the standing example. Say the figure cannot be computed for that district; never report or imply a zero. THE DISTRICT-TO-LGU GROUPING THIS TABLE INHERITS IS DERIVED FROM PUBLIC SOURCES FOR THE 20th CONGRESS, single-source and correctable, and is NOT PUBLISHED BY PSA OR COMELEC - name the Congress whenever a figure from this table is quoted, because a later redistricting or an accepted correction changes which places a district counts. Only districts with at least one matching BHW get a row, the same convention agg_bhw_counts uses. Same column shape as agg_bhw_counts, at the district grain instead of geo_level - a district is not a geo_level and is never comparable to a geo_code/geo_level filter on that table.',
   'docs/LEGISLATIVE_DISTRICTS.md')
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
  ('agg_bhw_by_district','id',1,'bigint',null,'Surrogate row identifier; carries no meaning.',null,'meta',false,null,false),
  ('agg_bhw_by_district','dataset_id',2,'bigint',null,'Source dataset this row belongs to - bhw-2025 on every current row. The row exists only because geo_district_map resolves it, so a quote of it carries this dataset''s vintage and the mapping''s own Congress caveat together.',null,'key',true,'dim_dataset.dataset_id',true),
  ('agg_bhw_by_district','district_code',3,'text',null,'The district this total belongs to.',null,'key',true,'dim_legislative_district.district_code',true),
  ('agg_bhw_by_district','n_total',4,'integer',null,'Profiled BHWs (fact_bhw_raw) summed from this district''s LEAF (barangay) members, never from a member city''s citymun row - see the table note for the arithmetic trap. A district absent from this table has an unresolved gap, not zero BHWs.','count','measure',false,null,true),
  ('agg_bhw_by_district','n_accredited',5,'integer',null,'Profiled BHWs in this district carrying a verified per-person accreditation flag, same definition as agg_bhw_counts.n_accredited.','count','measure',false,null,true),
  ('agg_bhw_by_district','pct_accredited',6,'numeric',null,'n_accredited as a share of n_total.','percent (0-100)','measure',false,null,true),
  ('agg_bhw_by_district','avg_active_years',7,'numeric',null,'Mean years active among this district''s profiled BHWs.','years','measure',false,null,true),
  ('agg_bhw_by_district','any_honorarium_pct',8,'numeric',null,'Share of this district''s BHWs receiving an honorarium from any paying level, same definition as agg_bhw_counts.any_honorarium_pct.','percent (0-100)','measure',false,null,true)
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
