insert into dim_dataset (
  slug, name, source_name, source_url, license, geo_join_level, as_of_date, version, status
) values (
  'bhw-2025',
  'Barangay Health Worker (BHW) Registration/Accreditation',
  'Department of Health (DOH) Barangay Health Worker registration/accreditation dataset',
  null,
  'CC BY 4.0',
  'barangay',
  '2025-01-01',
  '1.0',
  'active'
)
on conflict (slug) do nothing;
