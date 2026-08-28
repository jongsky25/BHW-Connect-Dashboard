-- Carry the final-list alignment through the dataset registry (docs/UUC_PHC_2025_PLAN.md §3).
--
-- The rows below are lifted verbatim from the canonical seed,
-- supabase/migrations/20260826090100_seed_dataset_registry.sql, which stays the single source for
-- what the registry says — this file only carries the delta to the live project, on the same
-- pattern as U5's, U7's, U9's, U10's and U12b's registry applies. `lib/db/dataset-registry-seed
-- .test.ts` guards the canonical file, so the two cannot drift without a test failing.
--
-- What changed, and why: 20260828120000_uuc_phc_final_list_alignment.sql moved the dataset from
-- the reconciled workbook's 5,991 barangays to the source office's final 5,987. That changes three
-- row estimates, the national figures four column dictionaries quote, and — most consequentially
-- for anything reading the registry — what ref_uuc_phc_published_delta means. It used to hold the
-- 5,991-vs-5,987 gap. It is now empty, because the gap has closed, and an assistant that read
-- "no rows" as "no data" would report the reconciliation as unavailable rather than as settled.
--
-- fact_uuc_phc_indicators.health_indicators gains the other half of that: it is now NULL on one
-- row, and a null there is not a zero.
--
-- agg_bhw_by_uuc_status is here for a second-order reason worth stating: moving six barangays
-- between the two sides moved the national households-per-BHW figures its notes quote, and it took
-- Cavite out of the comparable set entirely — three listed barangays is below the suppression
-- threshold — so the province tally is now 76 of 80 rather than 76 of 81.

insert into dataset_registry (
  table_name, title, summary, grain, dataset_slug, exposure, row_estimate,
  source_kind, status, notes_md, doc_path
) values
  ('fact_uuc_phc_barangay',
   'Unserved and underserved communities for PHC (2025)',
   'The barangays on the 2025 Unserved and Underserved Communities for Primary Health Care list, with the source name fields they were matched from. Presence in this table means listed.',
   'One listed barangay.',
   'uuc-phc-2025', 'public', 5987, 'hand_written', 'approved',
   'Presence is the fact - there is no listed flag column, so absence means not on the list, not missing data. Built by supabase/migrations/20260826121000_fact_uuc_phc_barangay.sql and loaded by ingestion/ingest_uuc_phc.py. The 9,395 barangays the source workbook assessed and did NOT list were deliberately not loaded, so this table answers "is it on the 2025 list" and cannot answer "was it assessed". Any share of barangays takes its denominator from dim_geo, never from the workbook.',
   'docs/UUC_PHC_2025_PLAN.md'),
  ('fact_uuc_phc_indicators',
   'UUC for PHC 2025 indicator values',
   'The measurements each listed barangay was assessed on: the qualifying factors of DOH AO No. 2020-0023 section VI.A, the 12 cleaned health indicators, and the provincial benchmarks criterion (d) compares each barangay against.',
   'One listed barangay.',
   'uuc-phc-2025', 'public', 5987, 'hand_written', 'approved',
   'CAPPED VALUES. 1,584 values across 1,397 barangays were recorded outside any possible range (Water as high as 9,594 percent, FIC 18,088) and were bounded during cleaning - coverage percentages at 100, rates at 1,000. capped_indicators names, per barangay, which of its values were bounded; 886 Water and 456 FIC values now read as exactly 100 and are indistinguishable from genuine full coverage without it. Never state a value from this table without checking capped_indicators for that barangay, and never average or rank a capped indicator: the marker travels with a single value and cannot survive a mean, which is why this dataset publishes no indicator aggregates at all. Covers the 5,987 listed barangays only - there is no row for an unlisted barangay. health_indicators is the source office own criterion (d) score and IS loaded (U7), but it is a recorded classification rather than a derived one: it cannot be recomputed from the columns in this table, because the source scored it against the values before cleaning bounded them. Recomputing it from the published columns disagrees on 664 of the rows the source scored, and leaves 98 listed barangays qualifying on no route at all, which the AO makes impossible. IT IS NULL ON ONE ROW - SUMISIP CENTRAL, added by the final-list alignment from a sheet that carries no score column - and a null there means no score was ever recorded, not a score of zero. Report it as the source score, never as something checkable against imr/fic/water and their benchmarks.',
   'docs/UUC_PHC_2025_CLEANING_REPORT.md'),
  ('ref_uuc_phc_published_delta',
   'UUC for PHC published-total reconciliation',
   'Every geography where the 2027 Budget Cue Cards p37 distribution of UUC for PHC barangays differs from the figure this dashboard publishes. Currently none: the two agree everywhere, so the table is empty.',
   'One geography that differs.',
   'uuc-phc-2025', 'public', 0, 'hand_written', 'approved',
   'EMPTY, AND EMPTY IS THE ANSWER - the reconciliation this table exists to report has closed. The dashboard now publishes the source office final 2025 UUC for PHC list, 5,987 barangays, which is the figure cue cards p37 reports, so all 17 regions and the national total agree to the unit and no row is stored. ABSENCE FROM A GEOGRAPHY MEANS THE TWO SOURCES AGREE THERE - matching geographies are deliberately not stored, so this is a list of discrepancies rather than a comparison table, and no rows must never be read as no data. It stayed populated until the final-list alignment: the dashboard published 5,991 then, from the reconciled submission workbook, a delta of +4 sitting in CALABARZON (+5) and BARMM (-1). The final list resolved both, by removing five Cavite barangays and adding one in Basilan. Parsed from the doc_chunk copy of p37 rather than transcribed, so any row that ever appears here is a real discrepancy rather than a typo. source_as_of carries the date p37 speaks as of, and any quote of n_published must travel with it.',
   'docs/UUC_PHC_2025_PLAN.md'),
  ('ref_uuc_phc_list',
   'UUC for PHC 2025 list, one row per listed barangay',
   'The 2025 list as rows: every listed barangay with its geography resolved against dim_geo, the source workbook own codes and names, the four qualifying routes, the 12 indicators, the 7 provincial benchmarks and capped_indicators. This is what the CSV and XLSX downloads emit.',
   'One listed barangay.',
   'uuc-phc-2025', 'public', 5987, 'hand_written', 'approved',
   'A view joining fact_uuc_phc_barangay (the record) to fact_uuc_phc_indicators (the evidence) and dim_geo; security_invoker, so those tables own public-read policies decide access. IT IS THE ONLY RELATION IN THIS DATASET THAT CARRIES BOTH BARANGAY VALUES AND THE ANCESTOR CODES ABOVE THEM, which is what lets one query answer the listed barangays of a named province or city - filter on region_code, province_code or citymun_code, never on a prefix of geo_code. ALWAYS READ capped_indicators BESIDE THE SEVEN BOUNDABLE INDICATORS AND NEVER AVERAGE THEM: 1,584 values across 1,397 barangays were bounded during cleaning, and a bounded value is a ceiling the source overshot rather than a measurement. THE FOUR ROUTE FLAGS OVERLAP and must never be summed or used to derive a remainder; route_health is only meaningful where health_evaluable is true, and false there means the comparison was never made rather than that it failed. Presence is membership: every row is a barangay ON the list, and barangays assessed and not listed were never loaded, so an absent barangay is unlisted rather than adequate.',
   'docs/UUC_PHC_2025_PLAN.md'),
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
  ('agg_uuc_phc_criteria','n_route_conflict',7,'integer',null,'Criterion (b): listed barangays where armed conflict and displacement together reach 10 percent, OR the barangay is ELCAC-designated. The two shares are summed rather than read as the order literal "or" - that is what reproduces the source own Pass/Fail on every row it scored. Overlaps the other three route counts - do not add them.','count','measure',false,null,true),
  ('agg_uuc_phc_criteria','n_health_evaluable',10,'integer',null,'Listed barangays in this area whose provincial benchmarks can support criterion (d). Nationally 5,761 of 5,987: 226 barangays in 5 provinces carry benchmarks that are placeholders, zeroes, missing, or fractions, and criterion (d) cannot be evaluated for them at all. n_listed minus this is the excluded count. One further barangay, SUMISIP CENTRAL, counts as evaluable but carries no recorded criterion (d) score of its own, so route (d) does not count it. Their place on the list is not in doubt - the socio-economic test passes on any one of the four routes.','count','measure',false,null,true),
  ('agg_uuc_phc_indicator_dist','n_comparable',12,'integer',null,'Listed barangays here whose criterion (d) comparison can actually be made for this indicator: a value is recorded, the province supplied a benchmark, the benchmark does not exceed value_max, and the province benchmark set is not a placeholder. Nationally 5,761 of 5,987 for six health indicators and 5,648 for FIC. Always 0 for the five socio-economic indicators.','count','measure',false,null,true),
  ('ref_uuc_phc_list','route_conflict',16,'boolean','true|false','Criterion (b): armed_conf plus idp reach 10 percent, or the barangay is ELCAC-designated. The two percentages are SUMMED rather than read as the order or - that is what reproduces the source own Pass/Fail on every row it scored. THE FOUR ROUTE FLAGS OVERLAP - a barangay can qualify on several - so they never sum to the listed count and a remainder cannot be derived from them. A ROUTE FLAG IS FALSE WHERE THE VALUE BEHIND IT IS MISSING as well as where it is below the threshold - absence of evidence is counted as not qualifying, which is what makes these flags add up to the counts on /uuc-phc/criteria. Read ip_pop, armed_conf, idp and four_ps in the same row to tell the two apart.',null,'dimension',false,null,true),
  ('agg_bhw_by_uuc_status','n_listed_no_bhw',9,'integer',null,'Listed barangays here reporting zero BHWs. A real zero and a finding in its own right, never suppressed. Nationally 100 of 5,987.','count','measure',false,null,true),
  ('fact_uuc_phc_indicators','health_indicators',25,'smallint','0-7','NULL ON ONE ROW AND A NULL HERE IS NOT A ZERO - it means no score was ever recorded for that barangay. SUMISIP CENTRAL was added by the final-list alignment from a sheet that carries no score column, so route (d) does not count it; its listing rests on criterion (a). The source office own criterion (d) score: how many of the seven health assessments this barangay failed against its province. Loaded as supplied and NOT recomputable from the indicator and benchmark columns in this table - the source scored it before cleaning bounded the values, using Pass/Fail columns the extract drops. A recomputation from the published columns disagrees on 664 rows. 4 or more is the qualifying threshold, and it is the fourth of the four socio-economic routes. Not evaluable for 226 barangays in 5 provinces whose provincial benchmarks are placeholders, zeroes, missing or fractions; exclude those before quoting any share of this route.','count of 7','measure',false,null,true)
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
