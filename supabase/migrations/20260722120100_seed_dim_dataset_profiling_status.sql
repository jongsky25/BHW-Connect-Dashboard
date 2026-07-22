-- Register the 2026 BHW Connect Profiling Status dataset.
--
-- Distinct from 'bhw-2025' (the per-person profile aggregate) and 'bhw-stepzero-2026' (the
-- 2025 LGU headcount baseline): this is the 2026 encoding-workflow snapshot that tracks how
-- far individual profiling has progressed (Encode → Validate → Certify). Read only by slug
-- (getDatasetIdBySlug), so status 'published' just records "confirmed / live", not a second
-- 'active' dataset (that sentinel stays reserved for the single per-person dataset).
--
-- as_of_date: only the year (2026) is confirmed for this snapshot, so it follows the same
-- year-only convention already used for 'bhw-2025' / 'bhw-stepzero-2026' ('2026-01-01').
insert into dim_dataset (
  slug, name, source_name, source_url, license, geo_join_level, as_of_date, version, status
) values (
  'bhw-profiling-status-2026',
  'BHW Connect Profiling Status 2026',
  'Department of Health (DOH) BHW Connect — 2026 individual-profiling encoding status (Encode → Validate → Certify)',
  null,
  null,
  'citymun',
  '2026-01-01',
  '1.0',
  'published'
)
on conflict (slug) do nothing;
