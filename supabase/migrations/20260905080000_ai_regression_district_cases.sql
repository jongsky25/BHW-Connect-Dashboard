-- D3.4 §4 (docs/LEGISLATIVE_DISTRICTS_PLAN.md §6): the four regression cases named by the plan,
-- on the same "route 1" pattern 20260828120000_ai_regression_expectation.sql established — seeded
-- from figures read live through the same REST layer queryDataset uses, not authored.
--
-- The plan names four ways this dimension can produce a fluent wrong answer. Three are seedable
-- against the live mapping as it stands today; the fourth is not, and saying why is more honest
-- than forcing it into this table:
--
--   1. A straight lookup ("BHWs in Leyte's 1st") — case 1 below.
--   2. The multi-district-city trap ("Quezon City's 3rd") — case 2. Quezon City's own citymun row
--      in agg_bhw_counts carries n_total = 244 for the whole city; a wrong answer would report that
--      figure for one of its six districts. The district's own row is 37 — the case pins 37, and
--      the note records 244 as the specific wrong number a fluent answer would give instead.
--   3. A district with an unresolved member ("Cavite's 3rd") — case 3. City of Imus is Cavite's
--      3rd's only member and is not itself covered by geo_district_map at any grain this build
--      resolved, so agg_bhw_by_district has no row for cavite-3rd at all. mode: "count" with no
--      `where` reads matchingRows off the payload root, the same shape case 4 of the original ten
--      uses for an absence — 0 is the correct figure, and the system prompt's job (D3.4 §2) is to
--      turn that into a disclosed gap rather than a silent or invented zero.
--
--   4. A vintage question ("which district is X in" for an LGU moved by a correction) — NOT seeded
--      here. This table pins the CURRENT live mapping, and no correction has yet been accepted
--      against it (district_correction is empty of accepted rows as of this migration), so there
--      is no "before" and "after" this table could pin without inventing one. Case 4 below instead
--      seeds the lookup half of the question — Palo resolving to leyte-1st, the exact example
--      D3.3's own text gives for /api/geo/search — and the half that actually needs a correction to
--      exist (an accepted move invalidating a stale cached answer) is covered where it can be
--      exercised: a code-level test on the cache-key mechanism itself
--      (lib/ai/dataset-scope.test.ts, alongside lib/db/district-correction-changelog.test.ts's
--      existing assertion that acceptance calls bumpDatasetVersion(DATASET_SLUGS.legislativeDistricts)),
--      rather than a live mutation of a real place's public district assignment made up for a test.
insert into ai_regression_case (question, tool_calls, expectations, note, source) values
(
  'How many BHWs are in Leyte''s 1st congressional district, and how many are accredited?',
  '[{"name":"queryDataset","args":{"table":"agg_bhw_by_district","columns":["district_code","n_total","n_accredited","pct_accredited"],"filters":[{"column":"district_code","op":"eq","value":"leyte-1st"}]}}]'::jsonb,
  '[{"call":0,"tool":"queryDataset","where":{"district_code":"leyte-1st"},"field":"n_total","value":1495},
    {"call":0,"tool":"queryDataset","where":{"district_code":"leyte-1st"},"field":"n_accredited","value":1041},
    {"call":0,"tool":"queryDataset","where":{"district_code":"leyte-1st"},"field":"pct_accredited","value":69.63}]'::jsonb,
  'D3.4 §4 case 1, the straight lookup: a single district resolving to one agg_bhw_by_district row with no arithmetic trap in play.',
  'seeded'
),
(
  'How many BHWs are in Quezon City''s 3rd congressional district?',
  '[{"name":"queryDataset","args":{"table":"agg_bhw_by_district","columns":["district_code","n_total","n_accredited","pct_accredited"],"filters":[{"column":"district_code","op":"eq","value":"quezon-city-3rd"}]}}]'::jsonb,
  '[{"call":0,"tool":"queryDataset","where":{"district_code":"quezon-city-3rd"},"field":"n_total","value":37},
    {"call":0,"tool":"queryDataset","where":{"district_code":"quezon-city-3rd"},"field":"n_accredited","value":37}]'::jsonb,
  'D3.4 §4 case 2, the multi-district-city trap (docs/LEGISLATIVE_DISTRICTS_PLAN.md §6 D3.1''s "one arithmetic trap"). Quezon City''s whole-city citymun row in agg_bhw_counts carries n_total = 244 — the number a rollup from the citymun row rather than the district''s own barangay members would wrongly give for any one of its six districts. 37 is the district''s own leaf-summed figure and the only correct answer to this question.',
  'seeded'
),
(
  'How many BHWs are in Cavite''s 3rd congressional district?',
  '[{"name":"queryDataset","args":{"table":"agg_bhw_by_district","mode":"count","filters":[{"column":"district_code","op":"eq","value":"cavite-3rd"}]}}]'::jsonb,
  '[{"call":0,"tool":"queryDataset","field":"matchingRows","value":0}]'::jsonb,
  'D3.4 §4 case 3, the unresolved-member gap. City of Imus is Cavite''s 3rd''s only member and has no live geo_district_map row, so agg_bhw_by_district has none for cavite-3rd either — zero matching rows is the correct payload, and the answer must disclose the gap (docs/LEGISLATIVE_DISTRICTS.md''s uncovered LGUs) rather than report or imply zero BHWs.',
  'seeded'
),
(
  'Which legislative district is Palo, Leyte in?',
  '[{"name":"queryDataset","args":{"table":"geo_district_map","columns":["geo_code","geo_level","district_code"],"filters":[{"column":"geo_code","op":"eq","value":"0803739"}]}}]'::jsonb,
  '[{"call":0,"tool":"queryDataset","where":{"geo_code":"0803739"},"field":"district_code","value":"leyte-1st"}]'::jsonb,
  'D3.4 §4 case 4''s lookup half — the exact example docs/LEGISLATIVE_DISTRICTS_PLAN.md §6 D3.3 gives for /api/geo/search ("Palo" surfaces "Leyte''s 1st"). The vintage half (a correction moving this LGU and invalidating a stale cached answer) is not seedable against live data with no accepted correction yet on the books — see the migration header.',
  'seeded'
);
