-- Register the UUC for PHC 2025 dataset.
--
-- Naming: the policy's own name is "Unserved and Underserved Communities for Primary Health
-- Care" (cue cards p48). The workbook's 'UUA' (Unserved and Underserved Areas) and the former
-- GIDA / SEDA labels are superseded and stay out of UI copy — 'UUA' survives only as the raw
-- DECISION value inside the source extract. See docs/UUC_PHC_2025_PLAN.md §1.
--
-- geo_join_level 'barangay': unlike the citymun-grained BHW datasets, this list is published
-- and joined at barangay grain.
--
-- as_of_date '2025-01-01': the list is the 2025 edition issued under DC No. 2025-0549; only
-- the year is confirmed, so it follows the year-only convention already used by the other
-- datasets. Note the two rhythms behind it (AO 2020-0023 §VI.B): LGU/CHD profiling runs every
-- three years, while BLHSD publishes the list annually — this date tracks the published list.
insert into dim_dataset (
  slug, name, source_name, source_url, license, geo_join_level, as_of_date, version, status
) values (
  'uuc-phc-2025',
  'UUC for PHC 2025',
  'Department of Health (DOH) Bureau of Local Health Systems Development — 2025 list of Unserved and Underserved Communities for Primary Health Care (DC No. 2025-0549), criteria per DOH AO No. 2020-0023',
  null,
  null,
  'barangay',
  '2025-01-01',
  '1.0',
  'published'
)
on conflict (slug) do nothing;
