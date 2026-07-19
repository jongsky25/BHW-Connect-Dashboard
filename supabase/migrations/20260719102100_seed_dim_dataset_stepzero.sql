-- StepZero quick-count dataset registration (see docs/DECISIONS.md).
--
-- as_of_date: only the year (2025) is confirmed for this dataset - no month/day is
-- recorded on the sheet itself - so this follows the same year-only convention already
-- used for 'bhw-2025' (also seeded as '2025-01-01').
insert into dim_dataset (
  slug, name, source_name, source_url, license, geo_join_level, as_of_date, version, status
) values (
  'bhw-stepzero-2026',
  'BHW Connect StepZero Quick-Count',
  'Department of Health (DOH) BHW Connect StepZero barangay quick-count',
  null,
  null,
  'barangay',
  '2025-01-01',
  '1.0',
  'draft'
)
on conflict (slug) do nothing;
