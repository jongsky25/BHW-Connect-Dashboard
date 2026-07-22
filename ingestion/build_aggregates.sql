-- Aggregate build job (BUILD_PLAN.md §6, increment 0.5).
--
-- Computes all agg_* tables at all four real geo levels plus the 'national' sentinel
-- ('PH' in dim_geo), from the already-ingested fact_bhw_raw/fact_honorarium tables.
-- Idempotent: safe to re-run (each section deletes its own dataset_id's rows first).
--
-- Suppression (per the privacy model in BUILD_PLAN.md §4.1):
-- agg_demographics: any (geo_code, geo_level='barangay', dimension, category) cell with
-- 0 < n < 5 is nulled (n and pct set to NULL), is_suppressed set true, and
-- rollup_geo_code/rollup_geo_level point to the nearest ancestor (citymun -> province ->
-- region -> national) whose same-cell n >= 5. n = 0 is left visible (a true zero reveals
-- nothing about any individual).
-- agg_honorarium: distribution columns (min/p25/median/p75/max_amount) are nulled and
-- is_suppressed set true for any (geo_code, geo_level, payer_level) cell with
-- 0 < n_receiving < 5 — a literal min/max at that n can reveal an individual's amount.
-- No rollup here (unlike agg_demographics): n_receiving/pct_receiving/avg_monthly_amount
-- stay visible since an average of <5 values is far less disclosive.
--
-- Disk budget (Supabase free tier, 500 MB): agg_training is built at national/region/
-- province/citymun only, not barangay (see §6 below) - the barangay x topic cross-product
-- is what pushed the database over the cap on the first attempt. Everything else
-- (agg_bhw_counts, agg_demographics, agg_certification) is kept at all 5 levels.
--
-- Run this after ingest.py / after any re-ingestion (bump dataset_id's data_version first).


-- 0. Clean slate for this dataset (idempotent re-run).
delete from agg_bhw_counts where dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');
delete from agg_demographics where dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');
delete from agg_training where dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');
delete from agg_certification where dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');
delete from agg_honorarium where dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');
delete from agg_geo_summary where dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');
delete from agg_data_completeness where dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');

-- 1. Working table: one row per (BHW x geo level), fanned out national/region/province/citymun/barangay.
drop table if exists _agg_base;
create table _agg_base as
with base as (
  select
    f.bhw_id, f.accredited, f.active_years_count, f.sex, f.civil_status, f.age, f.bloodtype,
    f.educational_attainment, f.ip_status, f.tesda_nc2, f.tesda_certified, f.ref_manual_trained,
    f.training,
    dg.geo_code as barangay_code, dg.region_code, dg.province_code, dg.citymun_code
  from fact_bhw_raw f
  join dim_geo dg on dg.geo_code = f.geo_code and dg.geo_level = 'barangay'
)
select b.*, lvl.geo_level, lvl.geo_code
from base b
cross join lateral (values
  ('barangay'::geo_level_enum, b.barangay_code),
  ('citymun'::geo_level_enum, b.citymun_code),
  ('province'::geo_level_enum, b.province_code),
  ('region'::geo_level_enum, b.region_code),
  ('national'::geo_level_enum, 'PH')
) as lvl(geo_level, geo_code);

create index on _agg_base (geo_code, geo_level);

-- 2. agg_bhw_counts
with honorarium_any as (
  select distinct bhw_id from fact_honorarium
)
insert into agg_bhw_counts (dataset_id, geo_code, geo_level, n_total, n_accredited, pct_accredited, avg_active_years, any_honorarium_pct)
select
  (select dataset_id from dim_dataset where slug = 'bhw-2025'),
  b.geo_code, b.geo_level,
  count(*),
  count(*) filter (where b.accredited),
  round(100.0 * count(*) filter (where b.accredited) / nullif(count(*), 0), 2),
  round(avg(b.active_years_count), 2),
  round(100.0 * count(*) filter (where ha.bhw_id is not null) / nullif(count(*), 0), 2)
from _agg_base b
left join honorarium_any ha on ha.bhw_id = b.bhw_id
group by b.geo_code, b.geo_level;

-- 3. agg_demographics (six dimensions, unioned)
insert into agg_demographics (dataset_id, geo_code, geo_level, dimension, category, n, pct)
select (select dataset_id from dim_dataset where slug = 'bhw-2025'),
  b.geo_code, b.geo_level, 'sex'::demographic_dimension_enum, b.sex,
  count(*), round(100.0 * count(*) / nullif(t.n_total, 0), 2)
from _agg_base b
join agg_bhw_counts t on t.geo_code = b.geo_code and t.geo_level = b.geo_level
  and t.dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025')
where b.sex is not null
group by b.geo_code, b.geo_level, b.sex, t.n_total

union all
select (select dataset_id from dim_dataset where slug = 'bhw-2025'),
  b.geo_code, b.geo_level, 'civil_status'::demographic_dimension_enum, b.civil_status,
  count(*), round(100.0 * count(*) / nullif(t.n_total, 0), 2)
from _agg_base b
join agg_bhw_counts t on t.geo_code = b.geo_code and t.geo_level = b.geo_level
  and t.dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025')
where b.civil_status is not null
group by b.geo_code, b.geo_level, b.civil_status, t.n_total

union all
select (select dataset_id from dim_dataset where slug = 'bhw-2025'),
  b.geo_code, b.geo_level, 'bloodtype'::demographic_dimension_enum, b.bloodtype,
  count(*), round(100.0 * count(*) / nullif(t.n_total, 0), 2)
from _agg_base b
join agg_bhw_counts t on t.geo_code = b.geo_code and t.geo_level = b.geo_level
  and t.dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025')
where b.bloodtype is not null
group by b.geo_code, b.geo_level, b.bloodtype, t.n_total

union all
select (select dataset_id from dim_dataset where slug = 'bhw-2025'),
  b.geo_code, b.geo_level, 'education'::demographic_dimension_enum, b.educational_attainment,
  count(*), round(100.0 * count(*) / nullif(t.n_total, 0), 2)
from _agg_base b
join agg_bhw_counts t on t.geo_code = b.geo_code and t.geo_level = b.geo_level
  and t.dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025')
where b.educational_attainment is not null
group by b.geo_code, b.geo_level, b.educational_attainment, t.n_total

union all
select (select dataset_id from dim_dataset where slug = 'bhw-2025'),
  b.geo_code, b.geo_level, 'ip_status'::demographic_dimension_enum, b.ip_status,
  count(*), round(100.0 * count(*) / nullif(t.n_total, 0), 2)
from _agg_base b
join agg_bhw_counts t on t.geo_code = b.geo_code and t.geo_level = b.geo_level
  and t.dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025')
where b.ip_status is not null
group by b.geo_code, b.geo_level, b.ip_status, t.n_total

union all
select (select dataset_id from dim_dataset where slug = 'bhw-2025'),
  b.geo_code, b.geo_level, 'age_band'::demographic_dimension_enum,
  case
    when b.age < 30 then '<30'
    when b.age between 30 and 39 then '30-39'
    when b.age between 40 and 49 then '40-49'
    when b.age between 50 and 59 then '50-59'
    else '60+'
  end,
  count(*), round(100.0 * count(*) / nullif(t.n_total, 0), 2)
from _agg_base b
join agg_bhw_counts t on t.geo_code = b.geo_code and t.geo_level = b.geo_level
  and t.dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025')
where b.age is not null
group by b.geo_code, b.geo_level,
  case
    when b.age < 30 then '<30'
    when b.age between 30 and 39 then '30-39'
    when b.age between 40 and 49 then '40-49'
    when b.age between 50 and 59 then '50-59'
    else '60+'
  end,
  t.n_total;

-- 4. Suppression + roll-up (barangay-level cells only, per the privacy model).
-- Postgres forbids an UPDATE's FROM-clause (even LATERAL) from referencing the update
-- target, so the rollup mapping is materialized into a plain table first, then joined.
drop table if exists _suppression_rollup;
create table _suppression_rollup as
select ad.geo_code, ad.geo_level, ad.dimension, ad.category, ad.dataset_id,
  coalesce(pick.geo_code, 'PH') as rollup_geo_code,
  coalesce(pick.geo_level, 'national'::geo_level_enum) as rollup_geo_level
from agg_demographics ad
join dim_geo dg on dg.geo_code = ad.geo_code and dg.geo_level = 'barangay'
left join lateral (
  select a2.geo_code, a2.geo_level
  from agg_demographics a2
  where a2.dataset_id = ad.dataset_id and a2.dimension = ad.dimension and a2.category = ad.category
    and a2.n >= 5
    and (
      (a2.geo_level = 'citymun' and a2.geo_code = dg.citymun_code) or
      (a2.geo_level = 'province' and a2.geo_code = dg.province_code) or
      (a2.geo_level = 'region' and a2.geo_code = dg.region_code)
    )
  order by case a2.geo_level when 'citymun' then 1 when 'province' then 2 when 'region' then 3 end
  limit 1
) pick on true
where ad.geo_level = 'barangay' and ad.n > 0 and ad.n < 5;

update agg_demographics ad
set is_suppressed = true, n = null, pct = null,
    rollup_geo_code = sr.rollup_geo_code, rollup_geo_level = sr.rollup_geo_level
from _suppression_rollup sr
where ad.geo_code = sr.geo_code and ad.geo_level = sr.geo_level and ad.dimension = sr.dimension
  and ad.category = sr.category and ad.dataset_id = sr.dataset_id;

drop table _suppression_rollup;

-- 5. agg_certification
insert into agg_certification (dataset_id, geo_code, geo_level, cert_type, n, pct)
select (select dataset_id from dim_dataset where slug = 'bhw-2025'), b.geo_code, b.geo_level,
  'tesda_nc2', count(*) filter (where b.tesda_nc2), round(100.0 * count(*) filter (where b.tesda_nc2) / nullif(count(*), 0), 2)
from _agg_base b group by b.geo_code, b.geo_level
union all
select (select dataset_id from dim_dataset where slug = 'bhw-2025'), b.geo_code, b.geo_level,
  'tesda_certified', count(*) filter (where b.tesda_certified), round(100.0 * count(*) filter (where b.tesda_certified) / nullif(count(*), 0), 2)
from _agg_base b group by b.geo_code, b.geo_level
union all
select (select dataset_id from dim_dataset where slug = 'bhw-2025'), b.geo_code, b.geo_level,
  'ref_manual_trained', count(*) filter (where b.ref_manual_trained), round(100.0 * count(*) filter (where b.ref_manual_trained) / nullif(count(*), 0), 2)
from _agg_base b group by b.geo_code, b.geo_level;

-- _agg_base (a ~390 MB scratch table, given the training JSONB fanned out 5x per BHW) is not
-- needed past this point - drop it now rather than at the very end. This matters on Supabase's
-- free tier: building agg_training's full cross-product (all geo levels x 44 topics) while
-- _agg_base was still alive pushed the database over its 500 MB disk cap and Postgres flipped
-- to read-only. See docs/DECISIONS.md.
drop table if exists _agg_base;

-- 6. agg_training (topic slug/label list generated from ingestion/ingest.py's training_topics()).
--
-- Deliberately excludes geo_level='barangay': at 39,276 barangays x 44 topics that's the
-- single biggest contributor to the disk-cap overrun above, for a granularity that a place page
-- doesn't need per-topic (it shows agg_geo_summary.top_training_gap instead). Kept at
-- national/region/province/citymun (~4,776 geos x 44 topics). Built directly from
-- fact_bhw_raw/dim_geo (not the now-dropped _agg_base) so this never re-creates that scratch
-- table's footprint.
with topics(topic_slug, topic_label) as (
  values
    ('burns_choking_neck_head_spinal_injuries_poisoning', 'Burns/Choking/Neck-Head-Spinal Injuries/Poisoning'),
    ('basic_life_support', 'Basic Life Support'),
    ('basic_nutrition_malnutrition_nutrition_in_emergencies_and_disasters', 'Basic Nutrition/Malnutrition, Nutrition in Emergencies and Disasters'),
    ('blood_pressure_bp_apparatus_measurement', 'Blood Pressure (BP) Apparatus Measurement'),
    ('breastfeeding_lactation', 'Breastfeeding/Lactation'),
    ('chronic_respiratory_diseases_chronic_obstructive_pulmonary_disease_copd_asthma', 'Chronic Respiratory Diseases/Chronic Obstructive Pulmonary Disease(COPD)/Asthma'),
    ('cardiovascular_diseases_heart_attack_stroke', 'Cardiovascular Diseases/Heart Attack/Stroke'),
    ('child_growth_standard_growth_development', 'Child Growth Standard/Growth Development'),
    ('cancer', 'Cancer'),
    ('cardio_pulmonary_resuscitation_cpr', 'Cardio Pulmonary Resuscitation (CPR)'),
    ('dengue', 'Dengue'),
    ('diabetes', 'Diabetes'),
    ('disaster_risk_assessment_disaster_risk_preparedness', 'Disaster Risk Assessment/Disaster Risk Preparedness'),
    ('early_childhood_care_and_development', 'Early Childhood Care and Development'),
    ('emergency_reponse_rescue', 'Emergency Reponse/Rescue'),
    ('emerging_and_re_emerging_infectious_diseases', 'Emerging and Re-emerging Infectious Diseases'),
    ('environment_sanitation_solid_ecologic_waste_management', 'Environment Sanitation, Solid/Ecologic Waste Management'),
    ('filariasis', 'Filariasis'),
    ('fire_safety', 'Fire Safety'),
    ('flu', 'Flu'),
    ('food_preparation_food_safety', 'Food Preparation/Food Safety'),
    ('family_planning_responsible_parenthood', 'Family Planning/Responsible Parenthood'),
    ('first_1000_days', 'First 1000 Days'),
    ('hepatitis', 'Hepatitis'),
    ('hiv_aids', 'HIV/AIDS'),
    ('healthy_lifestyle', 'Healthy Lifestyle'),
    ('infant_and_young_child_feeding_practices', 'Infant and Young Child Feeding Practices'),
    ('leprosy', 'Leprosy'),
    ('mental_health', 'Mental Health'),
    ('measles', 'Measles'),
    ('malaria', 'Malaria'),
    ('maternal_care', 'Maternal Care'),
    ('others_please_specify', 'Others please specify'),
    ('pneumonia', 'Pneumonia'),
    ('polio', 'Polio'),
    ('rabies', 'Rabies'),
    ('standard_first_aid_training', 'Standard First Aid Training'),
    ('sexually_transmitted_disease', 'Sexually Transmitted Disease'),
    ('traditional_alternative_herbal_medicine', 'Traditional/Alternative/Herbal Medicine'),
    ('tuberculosis', 'Tuberculosis'),
    ('uhc_phc_f1_plus_for_health_sdn', 'UHC, PHC, F1 Plus for Health, SDN'),
    ('water_sanitation_and_hygiene_wash', 'Water Sanitation and Hygiene (WASH)'),
    ('women_s_health', 'Women’s Health'),
    ('zero_open_defecation_zod', 'Zero Open Defecation (ZOD)')
),
geo_expanded as (
  select f.bhw_id, f.training, lvl.geo_level, lvl.geo_code
  from fact_bhw_raw f
  join dim_geo dg on dg.geo_code = f.geo_code and dg.geo_level = 'barangay'
  cross join lateral (values
    ('citymun'::geo_level_enum, dg.citymun_code),
    ('province'::geo_level_enum, dg.province_code),
    ('region'::geo_level_enum, dg.region_code),
    ('national'::geo_level_enum, 'PH')
  ) as lvl(geo_level, geo_code)
),
trained_expanded as (
  select e.geo_code, e.geo_level, kv.key as topic_slug, (kv.value->>'year')::numeric as year
  from geo_expanded e
  cross join lateral jsonb_each(coalesce(e.training, '{}'::jsonb)) as kv(key, value)
),
per_topic as (
  select geo_code, geo_level, topic_slug, count(*) as n_trained,
    percentile_cont(0.5) within group (order by year) as median_year
  from trained_expanded
  group by geo_code, geo_level, topic_slug
)
insert into agg_training (dataset_id, geo_code, geo_level, topic_slug, topic_label, n_trained, n_total, coverage_pct, median_training_year)
select
  (select dataset_id from dim_dataset where slug = 'bhw-2025'),
  c.geo_code, c.geo_level, t.topic_slug, t.topic_label,
  coalesce(p.n_trained, 0),
  c.n_total,
  round(100.0 * coalesce(p.n_trained, 0) / nullif(c.n_total, 0), 2),
  round(p.median_year)
from agg_bhw_counts c
cross join topics t
left join per_topic p on p.geo_code = c.geo_code and p.geo_level = c.geo_level and p.topic_slug = t.topic_slug
where c.dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025')
  and c.geo_level != 'barangay';

-- 7. agg_honorarium
drop table if exists _agg_honorarium_base;
create table _agg_honorarium_base as
with fh as (
  select h.bhw_id, h.payer_level, h.normalized_monthly_amount, h.frequency,
    dg.geo_code as barangay_code, dg.region_code, dg.province_code, dg.citymun_code
  from fact_honorarium h
  join fact_bhw_raw f on f.bhw_id = h.bhw_id
  join dim_geo dg on dg.geo_code = f.geo_code and dg.geo_level = 'barangay'
)
select fh.*, lvl.geo_level, lvl.geo_code
from fh
cross join lateral (values
  ('barangay'::geo_level_enum, fh.barangay_code),
  ('citymun'::geo_level_enum, fh.citymun_code),
  ('province'::geo_level_enum, fh.province_code),
  ('region'::geo_level_enum, fh.region_code),
  ('national'::geo_level_enum, 'PH')
) as lvl(geo_level, geo_code);

insert into agg_honorarium (dataset_id, geo_code, geo_level, payer_level, n_receiving, pct_receiving, avg_monthly_amount, modal_frequency, min_amount, p25_amount, median_amount, p75_amount, max_amount)
select
  (select dataset_id from dim_dataset where slug = 'bhw-2025'),
  hb.geo_code, hb.geo_level, hb.payer_level,
  count(*),
  round(100.0 * count(*) / nullif(c.n_total, 0), 2),
  round(avg(hb.normalized_monthly_amount), 2),
  mode() within group (order by hb.frequency),
  round(min(hb.normalized_monthly_amount), 2),
  round((percentile_cont(0.25) within group (order by hb.normalized_monthly_amount))::numeric, 2),
  round((percentile_cont(0.5) within group (order by hb.normalized_monthly_amount))::numeric, 2),
  round((percentile_cont(0.75) within group (order by hb.normalized_monthly_amount))::numeric, 2),
  round(max(hb.normalized_monthly_amount), 2)
from _agg_honorarium_base hb
join agg_bhw_counts c on c.geo_code = hb.geo_code and c.geo_level = hb.geo_level
  and c.dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025')
group by hb.geo_code, hb.geo_level, hb.payer_level, c.n_total;

-- Suppress the distribution columns (not n_receiving/pct_receiving/avg_monthly_amount)
-- for small-n cells, per the n<5 privacy convention (see §4 above) — with 1-4
-- recipients, a literal min/median/max can reveal an individual's amount.
update agg_honorarium
set is_suppressed = true, min_amount = null, p25_amount = null,
    median_amount = null, p75_amount = null, max_amount = null
where dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025')
  and n_receiving > 0 and n_receiving < 5;

-- 8. agg_geo_summary
-- top_training_gap is NULL for barangay-level rows (agg_training doesn't cover that level - see §6).
insert into agg_geo_summary (dataset_id, geo_code, geo_level, geo_name, parent_chain, n_total, pct_accredited, top_training_gap, any_honorarium_pct, search_text)
select
  c.dataset_id, dg.geo_code, dg.geo_level, dg.geo_name,
  jsonb_strip_nulls(jsonb_build_object('region', reg.geo_name, 'province', prov.geo_name, 'citymun', cm.geo_name)),
  c.n_total, c.pct_accredited,
  (
    select at.topic_label from agg_training at
    where at.dataset_id = c.dataset_id and at.geo_code = c.geo_code and at.geo_level = c.geo_level and at.n_total > 0
    order by at.coverage_pct asc nulls last limit 1
  ),
  c.any_honorarium_pct,
  to_tsvector('simple', dg.geo_name || ' ' || coalesce(reg.geo_name, '') || ' ' || coalesce(prov.geo_name, '') || ' ' || coalesce(cm.geo_name, ''))
from dim_geo dg
join agg_bhw_counts c on c.geo_code = dg.geo_code and c.geo_level = dg.geo_level
  and c.dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025')
left join dim_geo reg on reg.geo_code = dg.region_code and reg.geo_level = 'region'
left join dim_geo prov on prov.geo_code = dg.province_code and prov.geo_level = 'province'
left join dim_geo cm on cm.geo_code = dg.citymun_code and cm.geo_level = 'citymun';

-- 9. agg_data_completeness (per-geo, over the demographic fields expected on every row).
-- Built at national/region/province/citymun; barangay is omitted for the same disk-budget
-- reason as agg_training (see the preamble) — barangay place pages point at their
-- citymun's figures instead. The national rows equal the old dataset-wide figures
-- (every fact_bhw_raw row joins to a barangay in dim_geo).
insert into agg_data_completeness (dataset_id, geo_level, geo_code, field_name, n_missing, pct_missing)
with fanned as (
  select
    f.sex, f.civil_status, f.age, f.bloodtype, f.educational_attainment, f.ip_status,
    f.household, f.active_years,
    lvl.geo_level, lvl.geo_code
  from fact_bhw_raw f
  join dim_geo dg on dg.geo_code = f.geo_code and dg.geo_level = 'barangay'
  cross join lateral (values
    ('citymun'::geo_level_enum, dg.citymun_code),
    ('province'::geo_level_enum, dg.province_code),
    ('region'::geo_level_enum, dg.region_code),
    ('national'::geo_level_enum, 'PH')
  ) as lvl(geo_level, geo_code)
)
select
  (select dataset_id from dim_dataset where slug = 'bhw-2025'),
  f.geo_level, f.geo_code, fld.field_name,
  count(*) filter (where fld.is_missing),
  round(100.0 * count(*) filter (where fld.is_missing) / nullif(count(*), 0), 2)
from fanned f
cross join lateral (values
  ('sex', f.sex is null),
  ('civil_status', f.civil_status is null),
  ('age', f.age is null),
  ('bloodtype', f.bloodtype is null),
  ('educational_attainment', f.educational_attainment is null),
  ('ip_status', f.ip_status is null),
  ('household', f.household is null),
  ('active_years', f.active_years is null)
) as fld(field_name, is_missing)
group by f.geo_level, f.geo_code, fld.field_name;

-- 9b. Wilson 95% confidence intervals on the proportion aggregates (E2.2).
-- Closed-form from each row's success/total counts; the ci_low/ci_high columns
-- are added by supabase/migrations. Runs last, once every table is populated
-- (agg_honorarium's denominator is agg_bhw_counts.n_total). The helpers are
-- (re)defined here so a from-scratch build doesn't depend on migration order.
create or replace function wilson_low(k numeric, n numeric) returns numeric
  language sql immutable as $$
  select case when n is null or n <= 0 then null
    else greatest(0, round(100 * (
      (k + 1.9208) / (n + 3.8416)
      - 1.96 * (n / (n + 3.8416)) * sqrt(k * (n - k) / power(n, 3) + 0.9604 / power(n, 2))
    ), 2)) end;
$$;
create or replace function wilson_high(k numeric, n numeric) returns numeric
  language sql immutable as $$
  select case when n is null or n <= 0 then null
    else least(100, round(100 * (
      (k + 1.9208) / (n + 3.8416)
      + 1.96 * (n / (n + 3.8416)) * sqrt(k * (n - k) / power(n, 3) + 0.9604 / power(n, 2))
    ), 2)) end;
$$;

update agg_bhw_counts set ci_low = wilson_low(n_accredited, n_total),
                          ci_high = wilson_high(n_accredited, n_total);
update agg_training set ci_low = wilson_low(n_trained, n_total),
                        ci_high = wilson_high(n_trained, n_total);
update agg_honorarium h set ci_low = wilson_low(h.n_receiving, c.n_total),
                            ci_high = wilson_high(h.n_receiving, c.n_total)
from agg_bhw_counts c
where c.dataset_id = h.dataset_id and c.geo_code = h.geo_code and c.geo_level = h.geo_level;

-- 9c. agg_peer_ranks (E2.3/E2.4): each geo's rank + percentile among its
-- same-level siblings for the six base indicators, plus a MAD outlier flag.
-- Region/province/citymun only (barangay excluded, as agg_training is). The
-- table itself is created by supabase/migrations. Requires the StepZero counts
-- (agg_bhw_stepzero_counts) to already be loaded.
delete from agg_peer_ranks
where dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');

with ds as (
  select
    (select dataset_id from dim_dataset where slug = 'bhw-2025') as main_id,
    (select dataset_id from dim_dataset where slug = 'bhw-stepzero-2026') as sz_id
),
base as (
  select c.geo_code, c.geo_level, dg.parent_code, 'pct_accredited' as ind, c.pct_accredited as val
  from agg_bhw_counts c
  join dim_geo dg on dg.geo_code = c.geo_code and dg.geo_level = c.geo_level
  where c.dataset_id = (select main_id from ds) and c.geo_level in ('region','province','citymun')
    and c.pct_accredited is not null
  union all
  select c.geo_code, c.geo_level, dg.parent_code, 'avg_active_years', c.avg_active_years
  from agg_bhw_counts c
  join dim_geo dg on dg.geo_code = c.geo_code and dg.geo_level = c.geo_level
  where c.dataset_id = (select main_id from ds) and c.geo_level in ('region','province','citymun')
    and c.avg_active_years is not null
  union all
  select c.geo_code, c.geo_level, dg.parent_code, 'any_honorarium_pct', c.any_honorarium_pct
  from agg_bhw_counts c
  join dim_geo dg on dg.geo_code = c.geo_code and dg.geo_level = c.geo_level
  where c.dataset_id = (select main_id from ds) and c.geo_level in ('region','province','citymun')
    and c.any_honorarium_pct is not null
  union all
  select s.geo_code, s.geo_level, dg.parent_code, 'households_per_bhw',
    round(s.households::numeric / s.n_total_bhw, 1)
  from agg_bhw_stepzero_counts s
  join dim_geo dg on dg.geo_code = s.geo_code and dg.geo_level = s.geo_level
  where s.dataset_id = (select sz_id from ds) and s.geo_level in ('region','province','citymun')
    and s.households > 0 and s.n_total_bhw > 0
  union all
  select s.geo_code, s.geo_level, dg.parent_code, 'bhw_per_1000',
    round(1000.0 * s.n_total_bhw / s.population, 1)
  from agg_bhw_stepzero_counts s
  join dim_geo dg on dg.geo_code = s.geo_code and dg.geo_level = s.geo_level
  where s.dataset_id = (select sz_id from ds) and s.geo_level in ('region','province','citymun')
    and s.n_total_bhw > 0 and s.population > 0
  union all
  select c.geo_code, c.geo_level, dg.parent_code, 'coverage_pct',
    least(100, round(100.0 * c.n_total / nullif(s.n_registered + s.n_registered_accredited, 0), 1))
  from agg_bhw_counts c
  join agg_bhw_stepzero_counts s on s.geo_code = c.geo_code and s.geo_level = c.geo_level
    and s.dataset_id = (select sz_id from ds)
  join dim_geo dg on dg.geo_code = c.geo_code and dg.geo_level = c.geo_level
  where c.dataset_id = (select main_id from ds) and c.geo_level in ('region','province','citymun')
    and c.n_total is not null and (s.n_registered + s.n_registered_accredited) > 0
),
grp as (
  select parent_code, geo_level, ind, count(*) as n_sib,
    percentile_cont(0.5) within group (order by val) as med
  from base group by parent_code, geo_level, ind
),
dev as (
  select b.*, g.n_sib, g.med, abs(b.val - g.med) as adev
  from base b join grp g on g.parent_code = b.parent_code and g.geo_level = b.geo_level and g.ind = b.ind
),
madc as (
  select parent_code, geo_level, ind, percentile_cont(0.5) within group (order by adev) as mad
  from dev group by parent_code, geo_level, ind
),
ranked as (
  select d.geo_code, d.geo_level, d.ind, d.val, d.n_sib, d.med, m.mad,
    rank() over (partition by d.parent_code, d.geo_level, d.ind order by d.val desc) as rank_pos,
    round((percent_rank() over (partition by d.parent_code, d.geo_level, d.ind order by d.val asc) * 100)::numeric, 1) as pctile
  from dev d join madc m on m.parent_code = d.parent_code and m.geo_level = d.geo_level and m.ind = d.ind
)
insert into agg_peer_ranks
  (dataset_id, geo_code, geo_level, indicator, value, n_total, rank_position, n_siblings, percentile, median, mad, is_outlier)
select (select main_id from ds), r.geo_code, r.geo_level, r.ind, r.val, cc.n_total,
  r.rank_pos, r.n_sib, r.pctile, r.med, r.mad,
  (r.n_sib >= 8 and r.mad > 0 and abs(r.val - r.med) > 3 * r.mad)
from ranked r
left join agg_bhw_counts cc on cc.geo_code = r.geo_code and cc.geo_level = r.geo_level
  and cc.dataset_id = (select main_id from ds);

-- 11. agg_cohorts (E3.2): one row per (geo × kind × cohort_year) counting how many
-- of today's profiled BHWs reached each milestone (registered / accredited / first
-- active) in that year. National→citymun (barangay skipped, same disk cut as
-- agg_training); only non-zero cells stored. The table is created by
-- supabase/migrations. 2025-snapshot framing: years are as recorded in the 2025
-- dataset, not a workforce time series.
delete from agg_cohorts where dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');

with fanned as (
  select f.registered_year, f.accreditation_year, f.first_active_year,
    lvl.geo_level, lvl.geo_code
  from fact_bhw_raw f
  join dim_geo dg on dg.geo_code = f.geo_code and dg.geo_level = 'barangay'
  cross join lateral (values
    ('citymun'::geo_level_enum, dg.citymun_code),
    ('province'::geo_level_enum, dg.province_code),
    ('region'::geo_level_enum, dg.region_code),
    ('national'::geo_level_enum, 'PH')
  ) as lvl(geo_level, geo_code)
),
unioned as (
  select geo_code, geo_level, 'registered' as kind, registered_year as yr
  from fanned where registered_year between 1995 and 2025
  union all
  select geo_code, geo_level, 'accredited', accreditation_year
  from fanned where accreditation_year between 1995 and 2025
  union all
  select geo_code, geo_level, 'first_active', first_active_year
  from fanned where first_active_year between 1995 and 2025
)
insert into agg_cohorts (dataset_id, geo_code, geo_level, kind, cohort_year, n)
select (select dataset_id from dim_dataset where slug = 'bhw-2025'),
  geo_code, geo_level, kind, yr, count(*)
from unioned
group by geo_code, geo_level, kind, yr;

-- 12. agg_workload (E3.4): per-BHW assigned-household counts summarized per geo
-- (p10/p25/median/p75/p90 + mean + busiest-decile share). National→citymun grain;
-- distribution columns suppressed for geos with < 5 reporting BHWs. household 0/null
-- excluded. Table created by supabase/migrations.
delete from agg_workload where dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');

with fanned as (
  select f.household, lvl.geo_level, lvl.geo_code
  from fact_bhw_raw f
  join dim_geo dg on dg.geo_code = f.geo_code and dg.geo_level = 'barangay'
  cross join lateral (values
    ('citymun'::geo_level_enum, dg.citymun_code),
    ('province'::geo_level_enum, dg.province_code),
    ('region'::geo_level_enum, dg.region_code),
    ('national'::geo_level_enum, 'PH')
  ) as lvl(geo_level, geo_code)
  where f.household is not null and f.household > 0
),
dist as (
  select geo_code, geo_level, count(*) as n_bhw,
    round((percentile_cont(0.10) within group (order by household))::numeric, 1) as p10,
    round((percentile_cont(0.25) within group (order by household))::numeric, 1) as p25,
    round((percentile_cont(0.50) within group (order by household))::numeric, 1) as median,
    round((percentile_cont(0.75) within group (order by household))::numeric, 1) as p75,
    round((percentile_cont(0.90) within group (order by household))::numeric, 1) as p90,
    round(avg(household)::numeric, 1) as mean,
    sum(household) as total_hh
  from fanned group by geo_code, geo_level
),
ranked as (
  select geo_code, geo_level, household,
    percent_rank() over (partition by geo_code, geo_level order by household desc) as pr
  from fanned
),
top_decile as (
  select geo_code, geo_level, sum(household) filter (where pr < 0.10) as top_hh
  from ranked group by geo_code, geo_level
)
insert into agg_workload
  (dataset_id, geo_code, geo_level, n_bhw, p10, p25, median, p75, p90, mean, busiest_decile_share, is_suppressed)
select (select dataset_id from dim_dataset where slug = 'bhw-2025'),
  d.geo_code, d.geo_level, d.n_bhw,
  case when d.n_bhw < 5 then null else d.p10 end,
  case when d.n_bhw < 5 then null else d.p25 end,
  case when d.n_bhw < 5 then null else d.median end,
  case when d.n_bhw < 5 then null else d.p75 end,
  case when d.n_bhw < 5 then null else d.p90 end,
  case when d.n_bhw < 5 then null else d.mean end,
  case when d.n_bhw < 5 then null else round(100.0 * td.top_hh / nullif(d.total_hh, 0), 1) end,
  (d.n_bhw < 5)
from dist d
join top_decile td on td.geo_code = d.geo_code and td.geo_level = d.geo_level;

-- 13. agg_honorarium_inequality (E3.5): Gini + p90:p10 of each BHW's total
-- normalized monthly honorarium among receiving BHWs, per geo. National→citymun;
-- suppressed for < 5 receiving. Table created by supabase/migrations.
delete from agg_honorarium_inequality where dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');

with per_bhw as (
  select h.bhw_id, sum(h.normalized_monthly_amount) as amt,
    dg.region_code, dg.province_code, dg.citymun_code
  from fact_honorarium h
  join fact_bhw_raw f on f.bhw_id = h.bhw_id
  join dim_geo dg on dg.geo_code = f.geo_code and dg.geo_level = 'barangay'
  where h.normalized_monthly_amount is not null and h.normalized_monthly_amount > 0
  group by h.bhw_id, dg.region_code, dg.province_code, dg.citymun_code
),
fanned as (
  select amt, lvl.geo_level, lvl.geo_code
  from per_bhw
  cross join lateral (values
    ('citymun'::geo_level_enum, citymun_code),
    ('province'::geo_level_enum, province_code),
    ('region'::geo_level_enum, region_code),
    ('national'::geo_level_enum, 'PH')
  ) as lvl(geo_level, geo_code)
),
ranked as (
  select geo_code, geo_level, amt,
    row_number() over (partition by geo_code, geo_level order by amt) as rn,
    count(*) over (partition by geo_code, geo_level) as n
  from fanned
),
gini_calc as (
  select geo_code, geo_level, max(n) as n_receiving,
    round(((2.0 * sum(rn * amt)) / nullif(max(n) * sum(amt), 0)
      - (max(n) + 1.0) / max(n))::numeric, 3) as gini
  from ranked group by geo_code, geo_level
),
pcts as (
  select geo_code, geo_level,
    round((percentile_cont(0.10) within group (order by amt))::numeric, 2) as p10,
    round((percentile_cont(0.90) within group (order by amt))::numeric, 2) as p90
  from fanned group by geo_code, geo_level
)
insert into agg_honorarium_inequality
  (dataset_id, geo_code, geo_level, n_receiving, gini, p10_amount, p90_amount, p90_p10_ratio, is_suppressed)
select (select dataset_id from dim_dataset where slug = 'bhw-2025'),
  g.geo_code, g.geo_level, g.n_receiving,
  case when g.n_receiving < 5 then null else g.gini end,
  case when g.n_receiving < 5 then null else p.p10 end,
  case when g.n_receiving < 5 then null else p.p90 end,
  case when g.n_receiving < 5 or p.p10 is null or p.p10 = 0 then null
    else round(p.p90 / p.p10, 1) end,
  (g.n_receiving < 5)
from gini_calc g
join pcts p on p.geo_code = g.geo_code and p.geo_level = g.geo_level;

-- 14. agg_bhw_counts.adjusted_pct (E3.6): empirical-Bayes (DerSimonian-Laird
-- random-effects) shrinkage of each small-area raw accreditation rate toward its
-- parent's pooled rate. Only citymun/barangay grain; region/national stay NULL
-- (shown raw). Column added by supabase/migrations. Runs after §2/§9b populate
-- agg_bhw_counts.
update agg_bhw_counts set adjusted_pct = null
where dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');

with units as (
  select c.geo_code, c.geo_level, dg.parent_code,
    c.n_total::numeric as n_i, c.n_accredited::numeric as k_i,
    c.n_accredited::numeric / c.n_total as p_i
  from agg_bhw_counts c
  join dim_geo dg on dg.geo_code = c.geo_code and dg.geo_level = c.geo_level
  where c.dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025')
    and c.geo_level in ('citymun', 'barangay')
    and c.n_total > 0 and c.n_accredited is not null
),
grp as (
  select parent_code, geo_level, count(*) as g,
    sum(k_i) / nullif(sum(n_i), 0) as m,
    sum(n_i) as sum_n, sum(n_i * n_i) as sum_n2
  from units group by parent_code, geo_level
),
tau as (
  select parent_code, geo_level, m, g, sum_n, sum_n2
  from grp where g >= 2 and m > 0 and m < 1
),
dev as (
  select u.geo_code, u.geo_level, u.parent_code, u.p_i, u.n_i, t.m, t.g, t.sum_n, t.sum_n2,
    u.n_i * power(u.p_i - t.m, 2) as weighted_sq
  from units u
  join tau t on t.parent_code = u.parent_code and t.geo_level = u.geo_level
),
between_var as (
  select parent_code, geo_level, m, g, sum_n, sum_n2,
    greatest(0,
      (sum(weighted_sq) - (g - 1) * m * (1 - m))
      / nullif(sum_n - sum_n2 / nullif(sum_n, 0), 0)
    ) as a_var
  from dev group by parent_code, geo_level, m, g, sum_n, sum_n2
),
adjusted as (
  select u.geo_code, u.geo_level,
    case
      when (bv.a_var + bv.m * (1 - bv.m) / u.n_i) = 0 then bv.m
      else bv.m + (bv.a_var / (bv.a_var + bv.m * (1 - bv.m) / u.n_i)) * (u.p_i - bv.m)
    end as adj
  from units u
  join dim_geo dg on dg.geo_code = u.geo_code and dg.geo_level = u.geo_level
  join between_var bv on bv.parent_code = dg.parent_code and bv.geo_level = u.geo_level
)
update agg_bhw_counts c
set adjusted_pct = round((100.0 * a.adj)::numeric, 2)
from adjusted a
where c.geo_code = a.geo_code and c.geo_level = a.geo_level
  and c.dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');

-- 15. agg_by_income_class (E3.7): national-scope indicator summaries grouped by
-- the LGU (city/municipality) income class each BHW's barangay belongs to. Six
-- rows. Table created by supabase/migrations.
delete from agg_by_income_class where dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');

with hon_bhw as (select distinct bhw_id from fact_honorarium),
base as (
  select f.bhw_id, f.accredited, dg.income_class, (hb.bhw_id is not null) as any_hon
  from fact_bhw_raw f
  join dim_geo dg on dg.geo_code = f.geo_code and dg.geo_level = 'barangay'
  left join hon_bhw hb on hb.bhw_id = f.bhw_id
  where dg.income_class between 1 and 6
),
agg as (
  select income_class, count(*) as n_bhw,
    round(100.0 * count(*) filter (where accredited) / nullif(count(*), 0), 2) as pct_accredited,
    round(100.0 * count(*) filter (where any_hon) / nullif(count(*), 0), 2) as any_honorarium_pct
  from base group by income_class
),
hon_amt as (
  select dg.income_class,
    round((percentile_cont(0.5) within group (order by h.normalized_monthly_amount))::numeric, 2) as med
  from fact_honorarium h
  join fact_bhw_raw f on f.bhw_id = h.bhw_id
  join dim_geo dg on dg.geo_code = f.geo_code and dg.geo_level = 'barangay'
  where dg.income_class between 1 and 6 and h.normalized_monthly_amount > 0
  group by dg.income_class
),
cm as (
  select income_class, count(*) as n_citymun
  from dim_geo where geo_level = 'citymun' and income_class between 1 and 6
  group by income_class
)
insert into agg_by_income_class
  (dataset_id, income_class, n_bhw, n_citymun, pct_accredited, any_honorarium_pct, median_honorarium_amount)
select (select dataset_id from dim_dataset where slug = 'bhw-2025'),
  a.income_class, a.n_bhw, cm.n_citymun, a.pct_accredited, a.any_honorarium_pct, hon_amt.med
from agg a
left join cm on cm.income_class = a.income_class
left join hon_amt on hon_amt.income_class = a.income_class
order by a.income_class;

-- 16. agg_honorarium_cumulative: honorarium sufficiency ("is it enough?"),
-- banded cumulative per-BHW honorarium among ALL profiled BHWs (not just
-- recipients — critical delta vs §13's agg_honorarium_inequality, which is
-- receiving-BHWs-only). Each BHW's total normalized monthly honorarium summed
-- across every paying level they receive from (non-recipients get 0) is
-- banded into 8 buckets (None / ₱1-4,000 / ₱4,001-8,000 / ₱8,001-12,000 /
-- ₱12,001-16,000 / ₱16,001-20,000 / ₱20,001-24,000 / Over ₱24,000) and counted
-- per geo, zero-filled so every geo has all 8 rows. National/region/province/
-- citymun grain (barangay skipped, same disk cut as agg_training/agg_workload;
-- ~14.4k rows). Band cells with 0 < n < 5 are suppressed (n/pct nulled,
-- is_suppressed true); n = 0 stays visible. Geos with fewer than 5 total
-- profiled BHWs have median_cumulative_monthly/pct_below_sufficiency nulled
-- and every band row suppressed (n_total itself stays visible, a plain
-- headcount). pct_below_sufficiency threshold is ₱2,040/month (₱68/day),
-- resolved empirically against this dataset (R5) — see
-- lib/analysis/thresholds.ts and supabase/migrations/20260721100000_honorarium_cumulative.sql.
-- Table created by supabase/migrations.
delete from agg_honorarium_cumulative where dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');

with per_bhw as (
  select f.bhw_id,
    coalesce(sum(h.normalized_monthly_amount) filter (where h.normalized_monthly_amount > 0), 0) as amt,
    dg.region_code, dg.province_code, dg.citymun_code
  from fact_bhw_raw f
  join dim_geo dg on dg.geo_code = f.geo_code and dg.geo_level = 'barangay'
  left join fact_honorarium h on h.bhw_id = f.bhw_id
  group by f.bhw_id, dg.region_code, dg.province_code, dg.citymun_code
),
fanned as (
  select amt, lvl.geo_level, lvl.geo_code
  from per_bhw
  cross join lateral (values
    ('citymun'::geo_level_enum, citymun_code),
    ('province'::geo_level_enum, province_code),
    ('region'::geo_level_enum, region_code),
    ('national'::geo_level_enum, 'PH')
  ) as lvl(geo_level, geo_code)
),
banded as (
  select geo_code, geo_level, amt,
    case
      when amt <= 0 then 0
      when amt <= 4000 then 1
      when amt <= 8000 then 2
      when amt <= 12000 then 3
      when amt <= 16000 then 4
      when amt <= 20000 then 5
      when amt <= 24000 then 6
      else 7
    end as band_order
  from fanned
),
geo_stats as (
  select geo_code, geo_level, count(*) as n_total,
    round((percentile_cont(0.5) within group (order by amt))::numeric, 2) as median_amt,
    round(100.0 * count(*) filter (where amt < 2040) / count(*), 1) as pct_below
  from banded
  group by geo_code, geo_level
),
band_counts as (
  select geo_code, geo_level, band_order, count(*) as n
  from banded
  group by geo_code, geo_level, band_order
),
bands as (
  select * from (values
    (0, 'None'),
    (1, '₱1-4,000'),
    (2, '₱4,001-8,000'),
    (3, '₱8,001-12,000'),
    (4, '₱12,001-16,000'),
    (5, '₱16,001-20,000'),
    (6, '₱20,001-24,000'),
    (7, 'Over ₱24,000')
  ) as b(band_order, band_label)
),
zero_filled as (
  select gs.geo_code, gs.geo_level, b.band_order, b.band_label,
    coalesce(bc.n, 0) as n,
    gs.n_total, gs.median_amt, gs.pct_below
  from geo_stats gs
  cross join bands b
  left join band_counts bc
    on bc.geo_code = gs.geo_code and bc.geo_level = gs.geo_level and bc.band_order = b.band_order
)
insert into agg_honorarium_cumulative
  (dataset_id, geo_code, geo_level, band_order, band_label, n, pct, n_total,
   median_cumulative_monthly, pct_below_sufficiency, is_suppressed)
select (select dataset_id from dim_dataset where slug = 'bhw-2025'),
  z.geo_code, z.geo_level, z.band_order, z.band_label,
  case when z.n_total < 5 then null
       when z.n > 0 and z.n < 5 then null
       else z.n end,
  case when z.n_total < 5 then null
       when z.n > 0 and z.n < 5 then null
       else round(100.0 * z.n / nullif(z.n_total, 0), 1) end,
  z.n_total,
  case when z.n_total < 5 then null else z.median_amt end,
  case when z.n_total < 5 then null else z.pct_below end,
  (z.n_total < 5 or (z.n > 0 and z.n < 5))
from zero_filled z;

-- 17. Cleanup working tables.
drop table if exists _agg_base;
drop table if exists _agg_honorarium_base;
