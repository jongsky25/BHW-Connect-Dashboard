-- Register the DOH National Health Facility Registry snapshot (plan N1).
--
-- Slug carries the snapshot month. NHFR is a live, continuously-updated registry rather than a
-- periodic publication, so 'nhfr-2026-09' names *this export*; a later pull is a new dataset row
-- and a new version, not an edit of this one. That is the difference between this and
-- 'uuc-phc-2025', where the year names an actual annual publication.
--
-- status 'published', never 'active'. 'active' is the single-dataset sentinel getActiveDataset()
-- pins to bhw-2025; seeding a second row 'active' is what blanked the site in E4.3 (#44). This
-- dataset is read by slug, like every other companion dataset.
--
-- Licence basis: public-with-citation, per the owner decision recorded at
-- docs/EXPLORE_ENHANCEMENT_PLAN.md:19 — "NHFR/FHSIS: use whatever is publicly available online,
-- with citation — no formal license conversation required before use; cite source + retrieval
-- date in /methodology and dim_dataset" — and confirmed by the owner as covered by the FOI law.
-- This supersedes the "blocked on a license answer" verdict docs/DATASET_SCOPING.md §2 carried,
-- which N4 rewrites. The retrieval date is part of source_name because the citation requirement
-- is what the licence basis rests on: a snapshot of a live registry is only meaningful with the
-- date it was taken.
--
-- geo_join_level 'barangay': 44,691 of 44,799 facilities carry a barangay code. The 108 that do
-- not are joined at city/municipality instead, which every facility carries — see
-- fact_nhfr_facility.barangay_geo_code.
--
-- as_of_date '2026-09-01': the export is titled "as of September 2026" and names no day, so this
-- follows the month it states rather than the day it was retrieved.
insert into dim_dataset (
  slug, name, source_name, source_url, license, geo_join_level, as_of_date, version, status
) values (
  'nhfr-2026-09',
  'Health facilities (NHFR, September 2026)',
  'Department of Health (DOH) — National Health Facility Registry, public facility list export from nhfr.doh.gov.ph, snapshot as of September 2026, retrieved 2026-09-05',
  'https://nhfr.doh.gov.ph',
  null,
  'barangay',
  '2026-09-01',
  '1.0',
  'published'
)
on conflict (slug) do nothing;
