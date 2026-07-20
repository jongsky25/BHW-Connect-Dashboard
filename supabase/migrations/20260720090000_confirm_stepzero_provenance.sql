-- Confirms StepZero's provenance and as-of date (owner sign-off, see docs/DECISIONS.md
-- 2026-07-20 entry). StepZero is the same 2025 profiling initiative as bhw-2025, collected
-- first as an LGU-reported headcount baseline (ask the LGU how many BHWs before starting
-- individual profiling, so denominators are clear) rather than a separate/later effort.
--
-- Not touched: `license`/`source_url` stay null (no explicit confirmation on those yet) and
-- `status` intentionally stays a value distinct from 'active' — 'active' is the sentinel
-- getActiveDatasetId() filters on for the sole per-person dataset (bhw-2025); StepZero is
-- always read by slug (getDatasetIdBySlug), so 'published' just records "confirmed", not a
-- second active dataset.
update dim_dataset
set
  source_name = 'Department of Health (DOH) BHW Connect StepZero barangay quick-count — the LGU-reported BHW headcount baseline collected before the 2025 individual profiling exercise (same source initiative as bhw-2025)',
  status = 'published'
where slug = 'bhw-stepzero-2026';
