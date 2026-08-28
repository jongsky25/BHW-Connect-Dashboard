-- §10's expected payload (docs/AI_ASSISTANT_PLAN.md §10), and route 1's ten seeded cases.
--
-- §10 has recorded the same gap since Increment 2.4, and the §10 runner entry restated it: "a
-- `queryDataset` case is scored on whether the call still runs, not on whether it returns the same
-- figure, because `ai_regression_case` has nowhere to record an expected payload". Three separate
-- things wait on that column — route 1 (seed from figures already rendered on public pages), the
-- 4.2 sweep's output, and the runner's ability to score a figure at all. This adds it and spends
-- it on route 1.
--
-- WHY AN ASSERTION LIST RATHER THAN A STORED PAYLOAD
--
-- Two obvious designs are both wrong, and in opposite directions.
--
-- A whole stored payload compared for equality is brittle in ways that have nothing to do with the
-- answer: row order, an added column, a `warnings` array that gains an entry, a `truncated` flag
-- that flips when a limit changes. Every one of those reports a regression that is not one, and a
-- suite that cries wolf is a suite nobody runs twice (the lesson `textUnchanged: null` already
-- taught this runner).
--
-- A single named figure per case is checkable but too narrow: the figure a page renders is often
-- several numbers — 12,605 of 18,891 (66.72%) — and a case that pins one of the three passes while
-- the other two drift.
--
-- So a case carries a *list* of assertions, each naming the call it is about, the row it selects,
-- the field it reads and the value it expects. That shape has the property the design has to have:
-- **the comparison says which part matched.** "n_accredited was 12,605, now 12,611" is a finding;
-- "the payload differs" is not.
--
-- WHY AMBIGUITY IS A FAILURE RATHER THAN A FIRST-ROW PICK
--
-- A selector matching more than one row is reported `unresolved`, never resolved by taking the
-- first. This is the whole guard against the failure mode that matters most here: **a case that
-- passes for the wrong reason is worse than one that fails.** It also does real work. Every table
-- these seeds read holds exactly one `dataset_id` today, so `{geo_code: "PH"}` identifies one row;
-- a republication adds a second, the selector matches two, and the case says so instead of
-- silently scoring the old vintage or the new one at random. That is precisely the change §10
-- exists to surface.
--
-- WHY NO TOLERANCE, AND WHY VALUES ARE COMPARED STRICTLY
--
-- An absolute tolerance was considered for figures that drift and deliberately not built. Nothing
-- route 1 can seed drifts — these are fixed aggregates over a fixed dataset version — so a
-- tolerance would be a knob with no case behind it whose only effect is to loosen a check. It is
-- also not free to add later *wrongly*: a sloppy tolerance is exactly how a case passes for the
-- wrong reason.
--
-- Type coercion was likewise measured rather than assumed. PostgREST's encoding was read off the
-- live API for every column these seeds touch — integer, numeric, and boolean, across six tables —
-- and every numeric column arrives as a JSON number (`600.00` and `52.0` included, which parse to
-- 600 and 52). There is therefore no case in front of us where a string would have to be compared
-- against a number, so no coercion rule is written. The runner instead names the *type* on a
-- mismatch, so if such a case ever appears the finding is the evidence for adding one.
--
-- WHY `conversation` AND `answer_given` BECOME NULLABLE
--
-- Not for the sweep's sake — for route 1's. §10.1 is explicit that a seeded case's expected answer
-- is "not authored, it is on screen": there is a figure and a page, and there is no assistant turn
-- because no assistant was asked. The one seeded case already in the table (case 1) had to invent
-- both to satisfy NOT NULL, and it also carries `provider = 'gemini'` — a claim that a model
-- produced text no model produced. That column exists so that "it regressed" and "a different
-- model answered this time" stay distinguishable, and a fabricated value on a seeded row destroys
-- the distinction for the one query the column is for. It is cleared below.
--
-- Two constraints replace the NOT NULLs, and both say something the NOT NULLs did not:
--   * a captured answer is all-or-nothing — a conversation without an answer, or an answer with no
--     conversation, is a half-written row rather than a seed;
--   * `provider` is only meaningful when there was an answer, so it cannot outlive one.
--
-- WHY THERE IS STILL NO 'swept' SOURCE
--
-- §8 4.2 says the sweep "feeds the §10 regression list", and this column is what a swept case was
-- waiting for: a confirmed contradiction has no question and no answer, but it does have two
-- figures that must not move, which is exactly an assertion list. It is still not built, because
-- all 12 `kb_contradiction` rows sit at `status = 'auto'` and owner decision 5 says a person
-- judges — so there is nothing confirmed to file, and a `source` value nothing writes is the
-- `--propose` mistake again: typed and unrun is not a safety property. The check below therefore
-- still allows only 'reported' and 'seeded', and `ai_regression_case.test.ts` asserts that, so the
-- absence is a recorded decision rather than an oversight. Adding it is one line, in the migration
-- that files the first judged row.

alter table ai_regression_case alter column conversation drop not null;
alter table ai_regression_case alter column answer_given drop not null;

alter table ai_regression_case add constraint ai_regression_case_answer_pairing
  check ((conversation is null) = (answer_given is null));

alter table ai_regression_case add constraint ai_regression_case_provider_needs_answer
  check (provider is null or answer_given is not null);

-- Shape validation for `expectations`, in the database rather than only in the reader.
--
-- The reader has to decide what to do with an element it cannot parse, and the tempting answer —
-- skip it — is the dangerous one: a typo'd key would silently remove an assertion and the case
-- would pass having checked less than it claims. The reader reports such an element instead of
-- dropping it (see `lib/db/regression-cases.ts`), and this constraint stops one being written at
-- all. Neither makes the other redundant: this covers every future write, the reader covers a row
-- written before the constraint existed or under a future one that is relaxed.
--
-- `value` is restricted to a scalar. An object or array has no meaningful comparison under a rule
-- that refuses to coerce, and JSON null is excluded too: nothing rendered on a page is a null, so
-- "expected to be null" has no case behind it yet and would ship unexercised.
create or replace function ai_regression_expectation_well_formed(p jsonb)
returns boolean
language sql
immutable
as $$
  select p is not null
     and jsonb_typeof(p) = 'array'
     and not exists (
       select 1
       from jsonb_array_elements(p) as e
       where jsonb_typeof(e) <> 'object'
          -- Which recorded call this reads, and what that call must be. `call` alone would let an
          -- edited `tool_calls` shift the index and score a figure against the wrong call without
          -- saying so; `tool` is the cross-check that makes that impossible to miss.
          -- `is distinct from`, not `<>`: a missing key makes `jsonb_typeof` NULL, and `NULL <> x`
          -- is NULL, which `where` reads as "no match" — so `<>` would accept an element with no
          -- `call` at all. That is the exact defect this constraint exists to prevent.
          or jsonb_typeof(e -> 'call') is distinct from 'number'
          or jsonb_typeof(e -> 'tool') is distinct from 'string'
          -- Absent `where` means the payload root, which is how a `mode: "count"` case reaches
          -- `matchingRows`. Present, it selects exactly one row of `rows`.
          or (e ? 'where' and jsonb_typeof(e -> 'where') <> 'object')
          or jsonb_typeof(e -> 'field') is distinct from 'string'
          or coalesce(jsonb_typeof(e -> 'value'), 'null') not in ('number', 'string', 'boolean')
     );
$$;

comment on function ai_regression_expectation_well_formed(jsonb) is
  'Shape guard for ai_regression_case.expectations: an array of {call:number, tool:string, where?:object, field:string, value:scalar}. See the migration header for why a malformed element must be refused rather than skipped.';

alter table ai_regression_case add column expectations jsonb not null default '[]'::jsonb;

comment on column ai_regression_case.expectations is
  'Assertions about the payloads the recorded tool calls return: [{call, tool, where?, field, value}]. Each is scored met / unmet / unresolved separately, so a replay reports which figure moved rather than that the payload differs.';

alter table ai_regression_case add constraint ai_regression_case_expectations_well_formed
  check (ai_regression_expectation_well_formed(expectations));

-- The fabricated provider on the one existing seeded case. See the header.
update ai_regression_case set provider = null where source = 'seeded' and provider is not null;

-- ---------------------------------------------------------------------------------------------
-- Route 1: ten cases seeded from figures already rendered on public pages.
--
-- §10.1: "Roughly ten questions whose answers are already rendered on public pages. The expected
-- answers are not authored — they are on screen." The `note` on each row names the screen, because
-- that claim is only checkable if the page is written down: a seed whose figure nobody can point
-- at on a rendered surface is an authored expectation wearing route 1's clothes.
--
-- Every value below was read from the live database through the same REST layer `queryDataset`
-- uses, not transcribed from a page or a document. What could not be run here is the replay
-- itself: the runner reads the registry through the service role, and there is no service-role key
-- in this environment. Stated on the DECISIONS entry rather than implied by a green tick.
--
-- Between them these ten exercise every branch of the selector: the payload root (case 4, a
-- `mode: "count"` call with no rows array), a one-key row selector, a two-key selector picking one
-- of three rows returned (case 8), a non-geographic key (case 9), integers, numerics PostgREST
-- writes as `600.00` and `52.0`, and a boolean (case 10).
--
-- `conversation`, `answer_given` and `provider` are null on all ten: no assistant was asked, so
-- there is no answer and no model to attribute one to.
insert into ai_regression_case (question, tool_calls, expectations, note, source) values
(
  'How many BHWs are there, and what share of them are accredited?',
  '[{"name":"queryDataset","args":{"table":"agg_bhw_counts","columns":["geo_code","geo_level","n_total","n_accredited","pct_accredited"],"filters":[{"column":"geo_code","op":"eq","value":"PH"},{"column":"geo_level","op":"eq","value":"national"}]}}]'::jsonb,
  '[{"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"n_total","value":270917},
    {"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"n_accredited","value":193897},
    {"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"pct_accredited","value":71.57}]'::jsonb,
  '/bhw renders all three: 270,917 at hero scale, "Based on n = 270,917 validated profiles" under the accreditation tile, and 71.57% on the gauge.',
  'seeded'
),
(
  'What is the accreditation rate in Region VII?',
  '[{"name":"queryDataset","args":{"table":"agg_bhw_counts","columns":["geo_code","geo_level","n_total","n_accredited","pct_accredited"],"filters":[{"column":"geo_code","op":"eq","value":"07"},{"column":"geo_level","op":"eq","value":"region"}]}}]'::jsonb,
  '[{"call":0,"tool":"queryDataset","where":{"geo_code":"07"},"field":"n_total","value":18891},
    {"call":0,"tool":"queryDataset","where":{"geo_code":"07"},"field":"n_accredited","value":12605},
    {"call":0,"tool":"queryDataset","where":{"geo_code":"07"},"field":"pct_accredited","value":66.72}]'::jsonb,
  '/place/region/07 renders "12,605 of 18,891 validated profiles are accredited (66.72%)". This is the example question §10.1 itself gives.',
  'seeded'
),
(
  'How many barangays are on the 2025 UUC for PHC list, and out of how many?',
  '[{"name":"queryDataset","args":{"table":"agg_uuc_phc_counts","columns":["geo_code","geo_level","n_listed","n_barangays"],"filters":[{"column":"geo_code","op":"eq","value":"PH"},{"column":"geo_level","op":"eq","value":"national"}]}}]'::jsonb,
  '[{"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"n_listed","value":5991},
    {"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"n_barangays","value":41958}]'::jsonb,
  '/uuc-phc CoverageHero: 5,991 of 41,958 barangays. The same 5,991 is in the page metadata description.',
  'seeded'
),
(
  'How many barangays are on the UUC for PHC list in total?',
  '[{"name":"queryDataset","args":{"table":"fact_uuc_phc_barangay","mode":"count"}}]'::jsonb,
  '[{"call":0,"tool":"queryDataset","field":"matchingRows","value":5991}]'::jsonb,
  'The same 5,991 /uuc-phc shows, reached from the fact table rather than the aggregate — the cross-check the page implies. No `where`: a count payload carries the figure on its root, with no rows array to select from.',
  'seeded'
),
(
  'Which routes carried barangays onto the 2025 UUC for PHC list?',
  '[{"name":"queryDataset","args":{"table":"agg_uuc_phc_criteria","columns":["geo_code","geo_level","n_listed","n_route_ip","n_route_conflict","n_route_four_ps","n_route_health","n_health_evaluable"],"filters":[{"column":"geo_code","op":"eq","value":"PH"},{"column":"geo_level","op":"eq","value":"national"}]}}]'::jsonb,
  '[{"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"n_route_ip","value":3677},
    {"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"n_route_conflict","value":2302},
    {"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"n_route_four_ps","value":726},
    {"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"n_route_health","value":2000},
    {"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"n_health_evaluable","value":5765}]'::jsonb,
  '/uuc-phc/criteria renders the four route counts against their own denominators, and n_health_evaluable as the health route''s denominator.',
  'seeded'
),
(
  'How many BHWs serve the barangays on the UUC for PHC list?',
  '[{"name":"queryDataset","args":{"table":"agg_bhw_by_uuc_status","columns":["geo_code","geo_level","n_barangays_listed","listed_n_bhw","n_listed_no_bhw"],"filters":[{"column":"geo_code","op":"eq","value":"PH"},{"column":"geo_level","op":"eq","value":"national"}]}}]'::jsonb,
  '[{"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"n_barangays_listed","value":5991},
    {"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"listed_n_bhw","value":48485},
    {"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"n_listed_no_bhw","value":100}]'::jsonb,
  '/uuc-phc/bhw-coverage: 48,485 BHWs across the 5,991 listed barangays, and 100 listed barangays with no BHW recorded.',
  'seeded'
),
(
  'How many BHWs are there to profile, and how many are still to attest?',
  '[{"name":"queryDataset","args":{"table":"agg_bhw_profiling_status","columns":["geo_code","geo_level","n_total_bhw","n_approved"],"filters":[{"column":"geo_code","op":"eq","value":"PH"},{"column":"geo_level","op":"eq","value":"national"}]}}]'::jsonb,
  '[{"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"n_total_bhw","value":310493},
    {"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"n_approved","value":36883}]'::jsonb,
  '/profiling-status StatusHero: 310,493 at hero scale and "273,610 still to attest", which the page computes as n_total_bhw - n_approved. Both inputs are pinned because the rendered gap is a difference, and a case pinning only the total would pass while the gap moved.',
  'seeded'
),
(
  'What share of BHWs hold TESDA BHS NC II certification?',
  '[{"name":"queryDataset","args":{"table":"agg_certification","columns":["geo_code","geo_level","cert_type","n","pct"],"filters":[{"column":"geo_code","op":"eq","value":"PH"},{"column":"geo_level","op":"eq","value":"national"}]}}]'::jsonb,
  '[{"call":0,"tool":"queryDataset","where":{"geo_code":"PH","cert_type":"tesda_certified"},"field":"n","value":7702},
    {"call":0,"tool":"queryDataset","where":{"geo_code":"PH","cert_type":"tesda_certified"},"field":"pct","value":2.84},
    {"call":0,"tool":"queryDataset","where":{"geo_code":"PH","cert_type":"ref_manual_trained"},"field":"pct","value":44.65}]'::jsonb,
  '/bhw certification figure: "45% have completed BHW Reference Manual training, but only 3% hold TESDA BHS NC II certification" — the rounded forms of 44.65 and 2.84. This call returns three cert_type rows for one geography, so the selector needs both keys to name one.',
  'seeded'
),
(
  'What is the median honorarium in 4th-class municipalities?',
  '[{"name":"queryDataset","args":{"table":"agg_by_income_class","columns":["income_class","n_bhw","n_citymun","pct_accredited","median_honorarium_amount"],"orderBy":"income_class","direction":"asc"}}]'::jsonb,
  '[{"call":0,"tool":"queryDataset","where":{"income_class":4},"field":"n_bhw","value":25566},
    {"call":0,"tool":"queryDataset","where":{"income_class":4},"field":"n_citymun","value":242},
    {"call":0,"tool":"queryDataset","where":{"income_class":4},"field":"median_honorarium_amount","value":541.67}]'::jsonb,
  '/bhw income-class figure renders the median honorarium per income class against 242 4th-class municipalities. The selector key is not a geography here, and the expected value is one PostgREST writes with trailing zeros elsewhere in the same column (600.00).',
  'seeded'
),
(
  'How many households does a typical BHW cover?',
  '[{"name":"queryDataset","args":{"table":"agg_workload","columns":["geo_code","geo_level","median","mean","n_bhw","is_suppressed"],"filters":[{"column":"geo_code","op":"eq","value":"PH"},{"column":"geo_level","op":"eq","value":"national"}]}}]'::jsonb,
  '[{"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"median","value":52},
    {"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"mean","value":92.5},
    {"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"n_bhw","value":270662},
    {"call":0,"tool":"queryDataset","where":{"geo_code":"PH"},"field":"is_suppressed","value":false}]'::jsonb,
  '/explore workload figure: "the typical BHW covers 52 households ... Based on 270,662 BHWs reporting a household count (mean 93)." is_suppressed is pinned false on purpose — the figure is withheld entirely when it is true, so a case asserting only the numbers would still pass on a build that had stopped rendering them. PostgREST returns this median as 52.0.',
  'seeded'
);
