-- The FHSIS 2025 indicator dictionary (plan F1, docs/FHSIS_2025_PLAN.md).
--
-- Grain: one row per indicator this dataset publishes. Twenty of them, across four program areas.
--
-- Why a hand-written dictionary rather than a distinct-values view over the fact table: the fact
-- table stores `indicator_key`, and a key on its own tells a reader nothing about what was counted
-- or what it was divided by. `numerator_def` and `denominator_def` carry the workbook's own header
-- text, so a figure on a page can always be traced back to the column it came from — which is
-- what makes the >100% values explainable rather than merely flagged.
--
-- `fact_fhsis_indicator.indicator_key` references this table, so an indicator cannot be loaded
-- before it is defined. The seed below and `INDICATORS` in ingestion/clean_fhsis.py are the same
-- list; the loader re-checks every key against this table before it writes a row.
--
-- **`unit` is load-bearing, not documentation.** Not every rate in FHSIS is a percentage. TB case
-- notification and drug-resistant notification are published *per 100,000 population* — the
-- national CNR is 473.06, which is 535,254 notified cases against a projected 113,146,216 people,
-- not a 473% overshoot. Everything else here is a percentage that may exceed 100. Any surface
-- rendering `rate_pct` must read this column first: `over_100` is set only for percentage
-- indicators, and putting a † on a normal notification rate would teach readers to ignore the
-- marker on the values where it means something.
--
-- lineage: table:ref_fhsis_indicator derived-from doc:docs/FHSIS_2025_CLEANING_REPORT.md
create table ref_fhsis_indicator (
  indicator_key text primary key,

  -- 'immunization' | 'maternal' | 'envi' | 'tb'. The five program areas of plan Decision 3 minus
  -- demographics, whose figures are workforce rather than indicators and live in
  -- fact_fhsis_workforce.
  program_area text not null,

  label text not null,

  -- The workbook's own header text for the counted thing and for what it is divided by. Two of
  -- these are worth reading before quoting a rate: tb_tsr_dstb and tb_tsr_mdrtb divide by a
  -- *case count*, not a population, because a treatment success rate is a proportion of patients
  -- treated rather than of people living in the area.
  numerator_def text not null,
  denominator_def text not null,

  -- 'percent (0-100, may exceed)' or 'cases per 100,000 population'. See the header comment.
  unit text not null,

  source_workbook text not null,

  -- FIC, 4ANC and 8ANC, and basic safe water: the indicators /uuc-phc already publishes and
  -- explains at /uuc-phc/criteria for its 5,987 listed barangays. FHSIS is the same indicator
  -- family for all 1,610 cities and municipalities, uncapped and with the numerators and
  -- denominators the UUC workbook never had — so this flag is what lets a page say so.
  uuc_criterion_d boolean not null default false
);

comment on table ref_fhsis_indicator is
  'The 20 indicators the DOH FHSIS 2025 annual release supplies to this site, with the numerator and denominator definitions taken from each workbook''s own header. READ unit BEFORE RENDERING rate_pct: the TB notification rates are per 100,000 population and are normally in the hundreds, while every other indicator is a percentage that may exceed 100. See docs/FHSIS_2025_PLAN.md and docs/FHSIS_2025_CLEANING_REPORT.md.';

alter table ref_fhsis_indicator enable row level security;

-- Public, non-personal: a dictionary of published indicator definitions. Anyone may read; no
-- client writes. Stated in the same migration as the create table, never opened then locked
-- (docs/BUILD_PLAN.md increment 0.3 guardrail).
create policy "ref_fhsis_indicator public read" on ref_fhsis_indicator
  for select
  to anon, authenticated
  using (true);

insert into ref_fhsis_indicator (
  indicator_key, program_area, label, numerator_def, denominator_def, unit, source_workbook,
  uuc_criterion_d
) values
  ('fic', 'immunization',
   'Fully immunised children (FIC)',
   'Fully Immunized Children, annual 2025',
   'Projected Population (0-12 months old) (Previous cohort)',
   'percent (0-100, may exceed)',
   '9 10 FIC _ CIC_MunCity EB 2025_FInal Annual 2025_NF.xlsx', true),

  ('cic', 'immunization',
   'Completely immunised children (CIC)',
   'Completely Immunized Children, annual 2025',
   'Projected population 0-12 months (previous cohort) minus previous FIC',
   'percent (0-100, may exceed)',
   '9 10 FIC _ CIC_MunCity EB 2025_FInal Annual 2025_NF.xlsx', false),

  ('anc4', 'maternal',
   'Women who completed at least 4 antenatal care visits',
   'Total No. of women who delivered and completed at least 4ANC',
   'Total Deliveries',
   'percent (0-100, may exceed)',
   '1. 4ANC_2025_EB_1_nofml.xlsx', true),

  -- The period is in the label, not only in the definition, because this figure is not
  -- year-comparable with anc4 and every surface that renders it has to say so. The source sheet
  -- is titled "Philippines, Q3-Q4 2025": 8ANC was introduced mid-year, so its "annual" sheet is
  -- a half year. Loaded because it is the published 2025 figure; never set beside anc4 as though
  -- both covered twelve months.
  ('anc8', 'maternal',
   'Women who completed at least 8 antenatal care visits (Q3-Q4 2025 only)',
   'Total No. of women who delivered and completed at least 8ANC (d+e). The source sheet is titled ''Philippines, Q3-Q4 2025'': it covers the second half of 2025 only, because 8ANC was introduced mid-year. Not comparable with anc4''s full year.',
   'Total No. of women who delivered and were tracked during pregnancy (a+b)-c, Q3-Q4 2025',
   'percent (0-100, may exceed)',
   '1. 8ANC_2025_PH_nofml.xlsx', true),

  ('water_basic', 'envi',
   'Households with access to basic safe water supply',
   'Households with Access to Basic Safe Water Supply, Total (Levels I-III)',
   'Projected Number of Households',
   'percent (0-100, may exceed)', 'water_nofml.xlsx', true),

  ('water_level1', 'envi',
   'Households with Level I water supply (point source)',
   'Households with Access to Basic Safe Water Supply, Level 1',
   'Projected Number of Households',
   'percent (0-100, may exceed)', 'water_nofml.xlsx', false),

  ('water_level2', 'envi',
   'Households with Level II water supply (communal faucet)',
   'Households with Access to Basic Safe Water Supply, Level 2',
   'Projected Number of Households',
   'percent (0-100, may exceed)', 'water_nofml.xlsx', false),

  ('water_level3', 'envi',
   'Households with Level III water supply (waterworks)',
   'Households with Access to Basic Safe Water Supply, Level 3',
   'Projected Number of Households',
   'percent (0-100, may exceed)', 'water_nofml.xlsx', false),

  ('water_safely_managed', 'envi',
   'Households using safely managed drinking water services',
   'Households using Safely Managed Drinking Water Services',
   'Projected Number of Households',
   'percent (0-100, may exceed)', 'water_nofml.xlsx', false),

  ('sanitation_basic', 'envi',
   'Households with a basic sanitation facility',
   'Households with Basic Sanitation Facility, Total',
   'Projected Number of Households',
   'percent (0-100, may exceed)', 'sanitation_nofml.xlsx', false),

  ('sanitation_septic', 'envi',
   'Households with a pour/flush toilet to a septic tank',
   'Households with Basic Sanitation Facility, Pour/Flush Toilet - Septic Tank',
   'Projected Number of Households',
   'percent (0-100, may exceed)', 'sanitation_nofml.xlsx', false),

  ('sanitation_sewer', 'envi',
   'Households with a pour/flush toilet to a community sewer',
   'Households with Basic Sanitation Facility, Pour/Flush Toilet - Community Sewer/Sewerage System',
   'Projected Number of Households',
   'percent (0-100, may exceed)', 'sanitation_nofml.xlsx', false),

  ('sanitation_vip', 'envi',
   'Households with a ventilated improved pit latrine',
   'Households with Basic Sanitation Facility, Ventilated Improved Pit (VIP) Latrine',
   'Projected Number of Households',
   'percent (0-100, may exceed)', 'sanitation_nofml.xlsx', false),

  ('sanitation_safely_managed', 'envi',
   'Households using safely managed sanitation services',
   'Households using Safely Managed Sanitation Service',
   'Projected Number of Households',
   'percent (0-100, may exceed)', 'sanitation_nofml.xlsx', false),

  -- Per 100,000, not percent. 473.06 nationally.
  ('tb_notified', 'tb',
   'TB case notification rate, all forms',
   'No. of notified TB cases, all forms',
   'Projected Population (All Ages)',
   'cases per 100,000 population', 'FINAL Tuberculosis_EB_2025.xlsx', false),

  ('tb_dr_notified', 'tb',
   'Drug-resistant TB notification rate (RR/MDR-TB)',
   'No. registered bacteriologically confirmed drug-resistant TB (RR/MDR-TB Cases)',
   'Projected Population (All Ages)',
   'cases per 100,000 population', 'FINAL Tuberculosis_EB_2025.xlsx', false),

  ('tb_presumptive_tested', 'tb',
   'Presumptive TB tested with a bacteriologic test',
   'No. of presumptive Tuberculosis tested with bacteriologic test',
   'Projected Population (All Ages)',
   'percent (0-100, may exceed)', 'FINAL Tuberculosis_EB_2025.xlsx', false),

  ('tb_tpt', 'tb',
   'TB preventive treatment (TPT) coverage for TB contacts',
   'No. of TB contacts given TB Preventive Treatment (All Ages)',
   'Eligible Population (Notified TB cases x 4 contacts x 70%)',
   'percent (0-100, may exceed)', 'FINAL Tuberculosis_EB_2025.xlsx', false),

  -- The two whose denominator is a case count rather than a population.
  ('tb_tsr_dstb', 'tb',
   'Treatment success rate, drug-susceptible TB (all forms)',
   'No. of TB all forms that are cured and completely treated (All ages)',
   'No. of TB all forms (all ages) — cases registered, not a population',
   'percent (0-100, may exceed)', 'FINAL Tuberculosis_EB_2025.xlsx', false),

  ('tb_tsr_mdrtb', 'tb',
   'Treatment success rate, drug-resistant TB (RR/MDR-TB)',
   'No. of registered bacteriology confirmed drug resistant TB Cases (RR/MDR-TB) cured and completed treatment (All Ages)',
   'No. of registered bacteriology confirmed drug resistant TB Cases (RR/MDR-TB) (all ages) — cases registered, not a population',
   'percent (0-100, may exceed)', 'FINAL Tuberculosis_EB_2025.xlsx', false)
on conflict (indicator_key) do nothing;
