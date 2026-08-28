-- Route 1's UUC seeds, re-derived against the source office's final 5,987 list.
--
-- THIS IS THE SUITE WORKING, NOT THE SUITE FAILING.
--
-- The alignment migration (20260828180000) replaced the 5,991-barangay reconciled submission with
-- the source office's final list of 5,987 — five Bacoor/Cavite barangays out, one Basilan barangay
-- in. Four of route 1's ten seeded cases pin figures from that dataset, and eight of their eleven
-- pins stopped matching the moment it landed.
--
-- That is the first regression §10's list has caught since it gained an expected payload, and it
-- caught a deliberate data correction rather than a defect — which is exactly the event the column
-- was built for. §10's purpose is to "tell whether a change made answers better or worse", and a
-- change that moves a published figure is precisely the kind that must not pass unnoticed. So this
-- migration re-derives the pins; it does not relax them, and it does not delete the cases.
--
-- WHAT MOVED, AND WHAT DID NOT
--
-- Measured against the live REST API before anything here was written, the same way the originals
-- were derived — the ten seeds parsed out of the committed migration, each recorded `queryDataset`
-- call re-issued through PostgREST, and every pin scored by `evaluateExpectation` itself:
--
--   21 of 29 pins still met. All eight that moved read a UUC table:
--
--     agg_uuc_phc_counts    n_listed             5,991 -> 5,987
--     fact_uuc_phc_barangay matchingRows         5,991 -> 5,987
--     agg_uuc_phc_criteria  n_route_ip           3,677 -> 3,678
--     agg_uuc_phc_criteria  n_route_conflict     2,302 -> 2,303
--     agg_uuc_phc_criteria  n_route_health       2,000 -> 1,995
--     agg_uuc_phc_criteria  n_health_evaluable   5,765 -> 5,761
--     agg_bhw_by_uuc_status n_barangays_listed   5,991 -> 5,987
--     agg_bhw_by_uuc_status listed_n_bhw        48,485 -> 48,480
--
-- Three UUC pins held and are left alone: `n_barangays` 41,958 (every barangay in the country, not
-- a list figure), `n_route_four_ps` 726, and `n_listed_no_bhw` 100.
--
-- **Every one came back `unmet`, not `unresolved`.** That distinction is the reassuring part and is
-- why it is recorded here: the selectors still found their rows and the fields are all still there,
-- so nothing structural broke — only the numbers moved. Had the alignment dropped or renamed a
-- column, these would have read `unresolved` instead and would mean something quite different.
--
-- The second-order movements are the ones nobody would have listed by hand. Six barangays changing
-- moved the route (d) health count by five and the BHW headcount by five, and moved routes (a) and
-- (b) in opposite directions by one each. A suite pinned only on the headline 5,987 would have
-- reported "one figure changed" and missed all of that.
--
-- The BHW census figures are untouched, which is established rather than assumed: cases 6, 7 and
-- 12 through 15 pin `agg_bhw_counts`, `agg_bhw_profiling_status`, `agg_certification`,
-- `agg_by_income_class` and `agg_workload`, and all of their pins still met. The seven harvested
-- cases read those same census tables through the indicator tools and none of them reads a UUC
-- table at all, so they are unaffected for the same measured reason.
--
-- WHY THE `note`s ARE REWRITTEN TOO
--
-- Route 1's claim is that a seeded case's expected answer is "not authored — it is on screen", and
-- the `note` is what makes that checkable by naming the screen. Three of these notes quoted 5,991
-- as the rendered figure. Leaving them would keep the pins honest while making their provenance a
-- lie, which is worse than either: a reader checking the claim would find the page saying 5,987 and
-- have no way to tell whether the case or the page was wrong. The pages now render 5,987 (the
-- alignment updated `/uuc-phc` and `/uuc-phc/criteria`, both verified in the tree at this commit).
--
-- KEYED ON `question`, NOT ON `case_id`
--
-- The seeds' case ids depend on an identity sequence that advanced past four values while the
-- original migration's refusals were being exercised, so they are an artifact of how that migration
-- was run rather than a property of the data. `question` is unique among seeded cases and is what
-- the case actually is. A migration replayed against a fresh database must reach the same four rows.

update ai_regression_case set
  expectations = '[{"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"n_listed","value":5987},
                   {"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"n_barangays","value":41958}]'::jsonb,
  note = '/uuc-phc CoverageHero: 5,987 of 41,958 barangays. The same 5,987 is in the page metadata description. Re-derived when the source office''s final list replaced the reconciled 5,991.',
  updated_at = now()
where source = 'seeded'
  and question = 'How many barangays are on the 2025 UUC for PHC list, and out of how many?';

update ai_regression_case set
  expectations = '[{"call":0,"tool":"queryDataset","field":"matchingRows","value":5987}]'::jsonb,
  note = 'The same 5,987 /uuc-phc shows, reached from the fact table rather than the aggregate — the cross-check the page implies. No `where`: a count payload carries the figure on its root, with no rows array to select from.',
  updated_at = now()
where source = 'seeded'
  and question = 'How many barangays are on the UUC for PHC list in total?';

update ai_regression_case set
  expectations = '[{"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"n_route_ip","value":3678},
                   {"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"n_route_conflict","value":2303},
                   {"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"n_route_four_ps","value":726},
                   {"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"n_route_health","value":1995},
                   {"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"n_health_evaluable","value":5761}]'::jsonb,
  note = '/uuc-phc/criteria renders the four route counts against their own denominators, and n_health_evaluable as the health route''s denominator. Re-derived against the final 5,987 list: routes (a) and (b) each moved by one, in opposite directions, and route (d) by five.',
  updated_at = now()
where source = 'seeded'
  and question = 'Which routes carried barangays onto the 2025 UUC for PHC list?';

update ai_regression_case set
  expectations = '[{"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"n_barangays_listed","value":5987},
                   {"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"listed_n_bhw","value":48480},
                   {"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"n_listed_no_bhw","value":100}]'::jsonb,
  note = '/uuc-phc/bhw-coverage: 48,480 BHWs across the 5,987 listed barangays, and 100 listed barangays with no BHW recorded. Re-derived against the final list; the five BHWs the delta moved are the second-order effect of six barangays changing.',
  updated_at = now()
where source = 'seeded'
  and question = 'How many BHWs serve the barangays on the UUC for PHC list?';
