-- Register agg_bhw_by_uuc_status (docs/UUC_PHC_2025_PLAN.md §9 U12b).
--
-- The rows below are lifted verbatim from the canonical seed,
-- supabase/migrations/20260826090100_seed_dataset_registry.sql, which stays the single source for
-- what the registry says — this file only carries the delta to the live project, on the same
-- pattern as U5's, U7's, U9's and U10's registry applies. `lib/db/dataset-registry-seed.test.ts`
-- guards the canonical file, so the two cannot drift without a test failing.

insert into dataset_registry (
  table_name, title, summary, grain, dataset_slug, exposure, row_estimate,
  source_kind, status, notes_md, doc_path
) values
  ('agg_bhw_by_uuc_status',
   'BHW coverage split by UUC for PHC list membership',
   'How BHW coverage in an area compares between the barangays on the 2025 UUC for PHC list and every other barangay in the same area: barangay counts, the StepZero BHW headcount, households, the profiling-eligible base and the individually-profiled count, on each side.',
   'One geography per dataset.',
   'uuc-phc-2025', 'public', 1788, 'hand_written', 'approved',
   'THIS IS A CONSISTENCY CHECK, NOT A FINDING, AND MUST NEVER BE REPORTED AS ONE IN EITHER DIRECTION. UUC membership is defined partly on distance to a health facility (the physical factor of DOH AO No. 2020-0023), so health-system access is part of what puts a barangay on this list - which makes any BHW coverage difference between the two groups partly definitional and circular to publish as a discovery. What is reportable is the EXCEPTION: an area where listed barangays carry MORE households per BHW than the rest of it, which is the direction the list own criteria do not already account for. Nationally the reverse holds (50.3 households per BHW listed against 98.3 other) and it holds in 76 of the 80 provinces where both sides can be compared. MOST OF THAT DIFFERENCE IS BARANGAY SIZE, NOT DEPLOYMENT: listed barangays hold about 0.58 times the households of the others while carrying about 1.13 times the BHWs each, and households per BHW is a ratio of those two - always state the per-barangay figures beside the headline. OTHER MEANS EVERY OTHER BARANGAY IN THE AREA, NOT ASSESSED AND FOUND ADEQUATE: the source workbook 9,395 assessed-but-unlisted barangays were never loaded, so no such group exists in this database. Built from agg_bhw_stepzero_counts, a headcount covering all 41,958 barangays, and deliberately NOT from agg_bhw_counts - listed barangays are remote by construction and plausibly also less profiled, so splitting a profiled figure by list status would measure profiling progress and report it as BHW supply. NO RATIO IS STORED HERE; every one is derived from the counts. A side with 0 < contributing barangays < 5 is suppressed and its measures are null - read listed_is_suppressed and other_is_suppressed before treating a null as a zero. National / region / province / citymun only.',
   'docs/UUC_PHC_2025_PLAN.md')
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
  -- agg_bhw_by_uuc_status
  ('agg_bhw_by_uuc_status','id',1,'bigint',null,'Surrogate row identifier; carries no meaning.',null,'meta',false,null,false),
  ('agg_bhw_by_uuc_status','dataset_id',2,'bigint',null,'Source dataset this row belongs to. Keyed to uuc-phc-2025 because the row exists only because the list does - but the figures come from bhw-stepzero-2026 and bhw-2025, so a quote of them travels with those datasets vintages too.',null,'key',true,'dim_dataset.dataset_id',true),
  ('agg_bhw_by_uuc_status','geo_code',3,'text',null,'Geography this comparison describes.',null,'key',true,'dim_geo.geo_code',true),
  ('agg_bhw_by_uuc_status','geo_level',4,'geo_level_enum','national|region|province|citymun','Level of the described geography; there are no barangay rows - a barangay is entirely listed or entirely not, so one level down there is no split to draw.',null,'dimension',false,null,true),
  ('agg_bhw_by_uuc_status','n_barangays_listed',5,'integer',null,'Barangays in this area on the 2025 UUC for PHC list. Equal to agg_uuc_phc_counts.n_listed for the same geography, computed by a different path; the migration aborts if they disagree.','count','measure',false,null,true),
  ('agg_bhw_by_uuc_status','n_barangays_other',6,'integer',null,'EVERY OTHER barangay in the area - NOT assessed and found adequate. The source workbook 9,395 assessed-but-unlisted barangays were never loaded, so that group does not exist here. Plus n_barangays_listed this is the area whole barangay count. Say all other barangays, never not listed, which a reader hears as assessed and passed.','count','measure',false,null,true),
  ('agg_bhw_by_uuc_status','n_listed_with_data',7,'integer',null,'Listed barangays here carrying a StepZero row with a BHW count - the denominator the listed-side figures are built from, and the count the suppression rule tests. Equals n_barangays_listed today, since StepZero covers all 41,958 barangays.','count','measure',false,null,true),
  ('agg_bhw_by_uuc_status','n_other_with_data',8,'integer',null,'Other barangays here carrying a StepZero row with a BHW count - the denominator the other-side figures are built from, and the count the suppression rule tests.','count','measure',false,null,true),
  ('agg_bhw_by_uuc_status','n_listed_no_bhw',9,'integer',null,'Listed barangays here reporting zero BHWs. A real zero and a finding in its own right, never suppressed. Nationally 100 of 5,991.','count','measure',false,null,true),
  ('agg_bhw_by_uuc_status','n_other_no_bhw',10,'integer',null,'Other barangays here reporting zero BHWs. A real zero, never suppressed. Nationally 945 of 35,967.','count','measure',false,null,true),
  ('agg_bhw_by_uuc_status','listed_n_bhw',11,'integer',null,'StepZero total BHWs (registered plus registered and accredited plus non-registered) across this area listed barangays. Divide listed_households by this for households per BHW, the site operative workload measure - and always state listed_households divided by n_listed_with_data beside it, because listed barangays are smaller and that is most of any difference. NULL when listed_is_suppressed.','count','measure',false,null,true),
  ('agg_bhw_by_uuc_status','other_n_bhw',12,'integer',null,'StepZero total BHWs across this area other barangays. NULL when other_is_suppressed. See listed_n_bhw.','count','measure',false,null,true),
  ('agg_bhw_by_uuc_status','listed_households',13,'bigint',null,'Households in this area listed barangays, from StepZero - the denominator of households per BHW. NULL when listed_is_suppressed. LISTED BARANGAYS ARE SMALLER ON AVERAGE (about 0.58 times the households of the others nationally), so most of any households-per-BHW gap between the sides is barangay size rather than BHW deployment.','count','measure',false,null,true),
  ('agg_bhw_by_uuc_status','other_households',14,'bigint',null,'Households in this area other barangays, from StepZero. NULL when other_is_suppressed. See listed_households on why barangay size, not deployment, drives most of the difference.','count','measure',false,null,true),
  ('agg_bhw_by_uuc_status','listed_registered_universe',15,'integer',null,'StepZero registered plus registered-and-accredited BHWs on the listed side - the profiling-eligible base, and the ONLY denominator listed_n_profiled may be divided by. NULL when listed_is_suppressed.','count','measure',false,null,true),
  ('agg_bhw_by_uuc_status','other_registered_universe',16,'integer',null,'StepZero registered plus registered-and-accredited BHWs on the other side - the profiling-eligible base, and the ONLY denominator other_n_profiled may be divided by. NULL when other_is_suppressed.','count','measure',false,null,true),
  ('agg_bhw_by_uuc_status','listed_n_profiled',17,'integer',null,'Individually-profiled BHWs (agg_bhw_counts.n_total) on the listed side. CONTEXT, NOT AN INDICATOR: it exists so the difference in PROFILING COVERAGE between the two groups is visible, which is why this table splits the StepZero headcount rather than the per-person census. Never report it as BHW supply and never divide it by households. NULL when listed_is_suppressed.','count','measure',false,null,true),
  ('agg_bhw_by_uuc_status','other_n_profiled',18,'integer',null,'Individually-profiled BHWs on the other side. CONTEXT, NOT AN INDICATOR - see listed_n_profiled. NULL when other_is_suppressed.','count','measure',false,null,true),
  ('agg_bhw_by_uuc_status','unallocated_n_bhw',19,'integer',null,'BHWs in this area own published StepZero row that are in NEITHER group, because StepZero carries them above barangay grain only and there is no barangay to attach a list status to. 16 nationally, in 3 regions, and 0 everywhere else. listed_n_bhw plus other_n_bhw plus this equals agg_bhw_stepzero_counts.n_total_bhw exactly, which is asserted at load - so a split that omits it does not reconcile.','count','measure',false,null,true),
  ('agg_bhw_by_uuc_status','unallocated_households',20,'bigint',null,'Households in this area own published StepZero row that are in neither group. 6,061 nationally, in 3 regions. See unallocated_n_bhw.','count','measure',false,null,true),
  ('agg_bhw_by_uuc_status','listed_is_suppressed',21,'boolean',null,'True when this area has between 1 and 4 listed barangays carrying data, and the listed-side measures were therefore nulled. READ IT BEFORE TREATING A NULL AS A ZERO. A PRESENTATION RULE, NOT A DISCLOSURE CONTROL: agg_bhw_stepzero_counts is public at barangay grain, so nothing here is secret - what it prevents is one, two or three barangays being rendered as a group statistic beside a group of hundreds.',null,'dimension',false,null,true),
  ('agg_bhw_by_uuc_status','other_is_suppressed',22,'boolean',null,'True when this area has between 1 and 4 other barangays carrying data, and the other-side measures were therefore nulled. See listed_is_suppressed.',null,'dimension',false,null,true)
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
