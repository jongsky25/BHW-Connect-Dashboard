-- Register the DOH FHSIS 2025 annual release (plan F1, Decision 1).
--
-- Slug carries the year, not a snapshot month. FHSIS is an annual publication — 'uuc-phc-2025'
-- is the precedent — unlike 'nhfr-2026-09', which names an export of a live registry. A 2026
-- release will be a new dataset row, not an edit of this one.
--
-- status 'published', never 'active'. 'active' is the single-dataset sentinel getActiveDataset()
-- pins to bhw-2025; seeding a second row 'active' is what blanked the site in E4.3 (#44). This is
-- read by slug like every other companion dataset.
--
-- **source_name says the release is partial, because the citation is the licence basis and a
-- partial release cited as if complete is a wrong citation.** The 2025 folder holds about 45
-- workbooks across ten program areas and DOH was still adding to it during retrieval: the
-- Demographics workbook carried a Drive modified date of 2026-08-24 and the FIC/CIC workbook
-- 2026-09-03. What is loaded is a *snapshot* of a mutable archive, and
-- ingestion/data/fhsis_2025/_manifest.json records the file id and modified date of every
-- workbook so a future pull can be diffed against it (Decision 9). A re-pull that changes any
-- figure bumps last_updated_at through bumpDatasetVersion (lib/db/dataset-version.ts), which is
-- what the AI cache keys on — so a republished figure cannot leave a stale cached answer behind.
--
-- Licence basis: public-with-citation, per the owner decision recorded at
-- docs/EXPLORE_ENHANCEMENT_PLAN.md:19 — "NHFR/FHSIS: use whatever is publicly available online,
-- with citation" — and, independently, Philippine government works carry no copyright under
-- RA 8293 §176. The retrieval date is part of source_name because a snapshot of a mutable
-- archive is only meaningful with the date it was taken.
--
-- geo_join_level 'citymun': the finest grain the source publishes. There is no barangay grain in
-- FHSIS at all, which is why /health-services/barangay/* will 404 by design rather than render
-- empty.
--
-- as_of_date '2025-12-31': the release reports the 2025 calendar year. Two loaded sheets cover
-- less than that and say so where it matters rather than here — 8ANC's annual sheet is titled
-- "Q3-Q4 2025" (recorded in ref_fhsis_indicator.label and numerator_def), and the two Envi
-- sheets are the 4th-quarter stock, which is the year-end position for a "households with
-- access" measure rather than a flow to be summed.
insert into dim_dataset (
  slug, name, source_name, source_url, license, geo_join_level, as_of_date, version, status
) values (
  'fhsis-2025',
  'Health services (FHSIS, 2025 annual)',
  'Department of Health (DOH) — Field Health Services Information System, 2025 annual release, partial at retrieval, from the public archive folder 16z6srVbGODqmgGHU4_Qg1oDBOglqp_XG (Annual Excel 2025), retrieved 2026-09-06',
  'https://bit.ly/FHSISPHSannualreports',
  null,
  'citymun',
  '2025-12-31',
  '1.0',
  'published'
)
on conflict (slug) do nothing;
