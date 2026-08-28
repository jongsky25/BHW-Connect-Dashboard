-- §10.1 route 3: harvesting the answer bank into the regression list.
--
-- §10 names three ways the list grows. Route 2 (grow from failures) shipped at Increment 2.4;
-- route 1 (seed from figures on a page) shipped yesterday with the expectations column. Route 3 is
-- the last: "`ai_ask_cache` rows at `status = 'approved'` are human-verified question/answer pairs
-- — an unused regression set already accumulating in production." Seven such rows exist today.
--
-- It is also the route that makes the list stop being small. The runner entry's own standard is
-- that "a runner over one case proves the runner, not the corpus", and §10's is that "three answers
-- read by hand say nothing about the other forty". Eleven cases is not forty either.
--
--
-- WHAT MAKES AN APPROVED ANSWER REPLAYABLE — AND THE COLUMN THAT DECIDED IT
--
-- The first question this increment had to answer was whether a harvested case can be replayed at
-- all. A case needs the tool calls with their arguments; without them it is a row that makes the
-- list look bigger without making it stronger. `ai_ask_cache` does **not** store them — it holds
-- the question, the answer, the provider, the data version and the dataset slug, and nothing else.
--
-- `ai_ask_log` does. Its `tool_trace` is `[{name, args}]` in call order — the same shape
-- `ai_regression_case.tool_calls` already uses. So the join is the derivation, and it is exact
-- rather than approximate: the log row must agree with the cache row on question_norm,
-- data_version, dataset_slug and geo_code, must be `served_from = 'live'` (a cache hit records no
-- trace, because no tools ran), and must carry a **byte-identical `answer_md`**. That last
-- condition is what makes this a derivation and not a guess: the log row matched is the one whose
-- tool calls produced this exact text. Measured before it was written — all seven approved rows
-- join to exactly one such log row.
--
-- WHERE MORE THAN ONE LOG ROW QUALIFIES, NOTHING IS HARVESTED. Not the first, not the newest. This
-- is the same rule the expectation selector already enforces one level down, and for the same
-- reason: a case built from one of several candidate traces has stopped being evidence about
-- anything in particular. It is reported as skipped, with the count, so the refusal is visible
-- rather than silent.
--
--
-- WHY `source` GAINS A THIRD VALUE HERE AND NOT BEFORE
--
-- A harvested case is neither reported-as-wrong nor seeded-from-a-screen: it is an answer a person
-- looked at and approved, which is a different claim about where its authority comes from — and
-- `note` means something different on each of the three, which is why the reader already returns
-- the column. So `source` becomes 'reported' | 'seeded' | 'harvested'.
--
-- The same question was deliberately left open for swept cases yesterday, and it stays open. The
-- difference is not taste: **this increment writes 'harvested'.** `'swept'` would be a value
-- nothing writes, which is the `--propose` mistake — typed and unrun is not a safety property. All
-- 12 `kb_contradiction` rows are still at `status = 'auto'` (re-checked, not assumed) and owner
-- decision 5 says a person judges, so there is still nothing confirmed to file.
--
--
-- IDEMPOTENCE AND DRIFT
--
-- `harvest_key` holds the source `cache_key` under a unique index, so a second harvest cannot
-- duplicate a case *by construction* rather than by a query remembering to check.
--
-- `harvest_fingerprint` is md5 over the answer and the trace — the two things the case was built
-- from. When it changes, the ask-cache row has been edited or re-answered and the case is rebuilt:
-- new answer, new tool calls, and **`expectations` reset to empty**. The pins described the old
-- answer; they are not evidence about the new one, and leaving them would let a case go green
-- against figures nobody verified. This is the shape 4.2 settled on for a re-swept row ("a
-- judgement is kept only while the two numbers it was judged on are unchanged"), applied to pins.
--
-- `harvest_last_seen_at` is 4.2's `last_swept_at`: every run stamps the cases it reproduced, and a
-- case the latest run did not reproduce — the row was unapproved, blocked, or deleted — keeps its
-- older stamp and is **reported as stale rather than deleted**. Deleting would silently shrink the
-- list, and a question that was verified once is still a question worth re-running; what must not
-- happen is that it keeps standing as though its source still vouched for it, which is what the
-- stamp says and what `/admin/regressions` renders.
--
--
-- WHAT THIS MIGRATION DOES NOT DO: PIN THE FIGURES
--
-- The figures are pinned below, but not by this function, and the reason is worth recording.
--
-- Every number in an approved answer passed `auditNarrative`, so it came from a tool payload — the
-- pins are therefore derivable. But recovering *which field* a numeral came from requires the
-- payloads, which requires running the tools, which is TypeScript and not SQL. `lib/ai/harvest-
-- pins.ts` is that derivation: re-issue the recorded calls, enumerate every field the expectation
-- language can address, match by exact equality, and pin only where the matching addresses agree
-- on which quantity they name. No model reads the answer.
--
-- Run against the seven live payloads it pins **37 of the 41 distinct numbers** in these answers.
-- Two are declined as ambiguous and two are in no payload at all ("near 100%", "below 12%" are
-- prose). Its output is written below as literal `update` statements, for the same reason route 1's
-- seeds are literal: a value in the committed file can be reviewed and asserted against in a test,
-- and a value produced at migration time cannot.
--
--
-- WHY THE EXPECTATION LANGUAGE GAINS `from`
--
-- Route 1 only ever read `queryDataset`, whose payload puts everything in `rows`. The public
-- indicator tool does not: `getIndicatorByGeo` returns its counts on the payload root and its
-- breakdown in an array named after the indicator — `demographics`, `training`, `honorarium`.
--
-- This was measured rather than assumed, and the measurement is what forced the change. Restricted
-- to the root and `rows`, the derivation pins 32 of 41 numbers — but among the nine it misses are
-- "30,600 BHWs identify as Indigenous People" and "2,782 BHWs (53.9%) in Palawan", which are the
-- *subjects* of two of the seven questions. A case that pins the two totals every such answer
-- mentions in passing while missing the figure the question asked for is pinning the boilerplate.
--
-- `from` is optional and absent means `rows`, so route 1's ten seeds are unaffected. Naming a list
-- without a `where` is refused: the root read is `where` absent, and it takes no `from`.

-- ---------------------------------------------------------------------------------------------
-- 1. The third source value, written by this increment.

alter table ai_regression_case drop constraint ai_regression_case_source_check;

alter table ai_regression_case add constraint ai_regression_case_source_check
  check (source in ('reported', 'seeded', 'harvested'));

-- ---------------------------------------------------------------------------------------------
-- 2. Harvest bookkeeping.

alter table ai_regression_case add column harvest_key text;
alter table ai_regression_case add column harvest_fingerprint text;
alter table ai_regression_case add column harvest_last_seen_at timestamptz;

comment on column ai_regression_case.harvest_key is
  'The ai_ask_cache.cache_key this case was harvested from. Unique, so a second harvest cannot duplicate a case by construction rather than by a query remembering to check.';
comment on column ai_regression_case.harvest_fingerprint is
  'md5 over the approved answer and its tool trace. A change means the source row was edited or re-answered; the case is rebuilt and its pins are cleared, because they described the old answer.';
comment on column ai_regression_case.harvest_last_seen_at is
  'When the last harvest reproduced this case from its source row. An older stamp than the latest run means the source no longer vouches for it — reported as stale, never deleted.';

create unique index ai_regression_case_harvest_key_idx
  on ai_regression_case (harvest_key)
  where harvest_key is not null;

-- All three together or none, and only on a harvested row. A harvest key on a reported case would
-- claim a provenance it does not have; a fingerprint with no key could never be checked again.
alter table ai_regression_case add constraint ai_regression_case_harvest_columns
  check (
    (source = 'harvested') = (harvest_key is not null)
    and (harvest_key is null) = (harvest_fingerprint is null)
    and (harvest_key is null) = (harvest_last_seen_at is null)
  );

-- ---------------------------------------------------------------------------------------------
-- 3. `from`, so an assertion can reach a payload array that is not called `rows`.
--
-- Replaced whole rather than patched: this is the guard the check constraint calls, and the
-- constraint is not revalidated when the function body changes, so the two must be read together.
-- Every existing row satisfies the new shape — `from` is optional and none of the ten seeds has it.
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
          -- `matchingRows`. Present, it selects exactly one row of a list.
          or (e ? 'where' and jsonb_typeof(e -> 'where') <> 'object')
          -- `from` names the list `where` selects from; absent it is `rows`, which is what every
          -- `queryDataset` case reads. Naming a list and then selecting nothing from it is not a
          -- root read — the root read is `where` absent — so it is a half-written assertion.
          or (e ? 'from' and (jsonb_typeof(e -> 'from') <> 'string' or e ->> 'from' = ''))
          or (e ? 'from' and not (e ? 'where'))
          or jsonb_typeof(e -> 'field') is distinct from 'string'
          or coalesce(jsonb_typeof(e -> 'value'), 'null') not in ('number', 'string', 'boolean')
     );
$$;

comment on function ai_regression_expectation_well_formed(jsonb) is
  'Shape guard for ai_regression_case.expectations: an array of {call:number, tool:string, from?:string, where?:object, field:string, value:scalar}. See the migration headers for why a malformed element must be refused rather than skipped, and why `from` cannot appear without `where`.';

-- ---------------------------------------------------------------------------------------------
-- 4. The harvest.

create or replace function harvest_ask_cache_cases(
  -- Guardrail 4. Small on purpose: this reads two small tables and writes at most a handful of
  -- rows, so anything approaching this bound is a plan that has gone wrong, not a big job.
  p_statement_timeout text default '30s'
)
returns table (
  -- harvested — a new case, filed from an approved answer nothing had harvested before.
  -- refreshed — the source row changed; the case was rebuilt and its pins cleared.
  -- unchanged — the source still reproduces this case exactly; only the stamp moved.
  -- skipped   — the approved row cannot become a replayable case, and why.
  -- stale     — a case whose source row this run did not reproduce. Kept, not deleted.
  action text,
  cache_key text,
  question text,
  detail text
)
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
declare
  -- One timestamp for the whole run, so "not reproduced by the latest run" is an exact comparison
  -- rather than a window. Taken before any work, for the same reason 4.2 takes `v_swept_at` first.
  v_seen_at timestamptz := now();
  v_row record;
  v_case record;
  v_fingerprint text;
  v_conversation jsonb;
  v_note text;
begin
  perform set_config('statement_timeout', p_statement_timeout, true);

  for v_row in
    select c.cache_key,
           c.question_display,
           c.geo_code,
           c.dataset_slug,
           c.answer_md,
           c.provider,
           c.generated_at,
           coalesce(t.n_traces, 0) as n_traces,
           t.trace_text
    from ai_ask_cache c
    left join lateral (
      -- Compared as text: the count has to be over *distinct traces*, and two log rows recording
      -- the same calls in the same order must not read as a disagreement.
      select count(distinct l.tool_trace::text) as n_traces,
             min(l.tool_trace::text) as trace_text
      from ai_ask_log l
      where l.question_norm = c.question_norm
        and l.data_version = c.data_version
        and l.dataset_slug = c.dataset_slug
        and l.geo_code is not distinct from c.geo_code
        -- The condition that makes this a derivation rather than a guess: the log row matched is
        -- the one whose tool calls produced this exact text.
        and l.answer_md = c.answer_md
        -- A cache hit records no trace, because no tools ran on that turn.
        and l.served_from = 'live'
        and jsonb_typeof(l.tool_trace) = 'array'
        and jsonb_array_length(l.tool_trace) > 0
    ) t on true
    where c.status = 'approved'
    order by c.generated_at
  loop
    if v_row.n_traces = 0 then
      action := 'skipped';
      cache_key := v_row.cache_key;
      question := v_row.question_display;
      detail := 'no live ai_ask_log row records the tool calls that produced this exact answer, so the case could not be replayed';
      return next;
      continue;
    end if;

    if v_row.n_traces > 1 then
      -- Never the first, never the newest. See the header: a case built from one of several
      -- candidate traces has stopped being evidence about anything in particular.
      action := 'skipped';
      cache_key := v_row.cache_key;
      question := v_row.question_display;
      detail := format(
        '%s live log rows record different tool calls for this answer — a harvested case must name one',
        v_row.n_traces);
      return next;
      continue;
    end if;

    v_fingerprint := md5(v_row.answer_md || e'\n' || v_row.trace_text);

    -- Single-turn by construction: the answer bank keys on one question and the route only writes
    -- it for a single-turn ask, so the conversation is the pair, derived rather than invented.
    v_conversation := jsonb_build_array(
      jsonb_build_object('role', 'user', 'content', v_row.question_display),
      jsonb_build_object('role', 'assistant', 'content', v_row.answer_md));

    v_note := format(
      'Harvested from the answer bank (§10.1 route 3): ai_ask_cache row at status = approved, asked at geo %s on %s, answered %s by %s. The approval is what makes answer_given the expected answer — nothing here is authored.',
      coalesce(v_row.geo_code, 'national'),
      v_row.dataset_slug,
      to_char(v_row.generated_at, 'YYYY-MM-DD'),
      coalesce(v_row.provider, 'an unrecorded provider'));

    select case_id, harvest_fingerprint into v_case
    from ai_regression_case
    where harvest_key = v_row.cache_key;

    if not found then
      insert into ai_regression_case (
        question, conversation, answer_given, tool_calls, provider, note, source,
        harvest_key, harvest_fingerprint, harvest_last_seen_at
      ) values (
        v_row.question_display, v_conversation, v_row.answer_md, v_row.trace_text::jsonb,
        v_row.provider, v_note, 'harvested',
        v_row.cache_key, v_fingerprint, v_seen_at
      );
      action := 'harvested';
      detail := format('%s tool %s recorded',
        jsonb_array_length(v_row.trace_text::jsonb),
        case when jsonb_array_length(v_row.trace_text::jsonb) = 1 then 'call' else 'calls' end);

    elsif v_case.harvest_fingerprint is distinct from v_fingerprint then
      update ai_regression_case set
        question = v_row.question_display,
        conversation = v_conversation,
        answer_given = v_row.answer_md,
        tool_calls = v_row.trace_text::jsonb,
        provider = v_row.provider,
        note = v_note,
        -- The pins were derived from the previous answer's payloads. They are not evidence about
        -- this one, and a case that stayed green against figures nobody verified is exactly the
        -- "passes for the wrong reason" failure the expectations column is arranged against.
        expectations = '[]'::jsonb,
        harvest_fingerprint = v_fingerprint,
        harvest_last_seen_at = v_seen_at,
        updated_at = now()
      where case_id = v_case.case_id;
      action := 'refreshed';
      detail := 'the source answer or its tool calls changed; the case was rebuilt and its pinned figures cleared';

    else
      -- Nothing about the case changed, so `updated_at` must not move. Only the stamp that says
      -- the source still reproduces it.
      update ai_regression_case set harvest_last_seen_at = v_seen_at
      where case_id = v_case.case_id;
      action := 'unchanged';
      detail := null;
    end if;

    cache_key := v_row.cache_key;
    question := v_row.question_display;
    return next;
  end loop;

  -- Anything harvested before that this run did not reproduce. 4.2's rule, applied here: shown as
  -- stale rather than deleted.
  for v_case in
    select rc.harvest_key, rc.question, rc.harvest_last_seen_at
    from ai_regression_case rc
    where rc.source = 'harvested'
      and rc.harvest_last_seen_at < v_seen_at
    order by rc.harvest_last_seen_at
  loop
    action := 'stale';
    cache_key := v_case.harvest_key;
    question := v_case.question;
    detail := format(
      'the ai_ask_cache row this was harvested from no longer reproduces it (last confirmed %s) — it may have been edited, blocked or unapproved. Kept, not deleted.',
      to_char(v_case.harvest_last_seen_at, 'YYYY-MM-DD HH24:MI'));
    return next;
  end loop;
end;
$$;

comment on function harvest_ask_cache_cases(text) is
  'Files every ai_ask_cache row at status = approved as a replayable ai_regression_case, recovering its tool calls from the ai_ask_log row whose answer_md matches byte for byte. Idempotent through the unique harvest_key; a source row that changed rebuilds its case and clears its pins; a case the run did not reproduce is reported stale, never deleted. Pins are derived separately — see lib/ai/harvest-pins.ts and the migration header.';

-- Run it. A function shipped unrun is the `--propose` mistake, and this project has paid for it.
do $$
begin
  perform * from harvest_ask_cache_cases();
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. The pinned figures, derived by `lib/ai/harvest-pins.ts` from the payloads each case's own
-- recorded calls returned, and written as literals so they can be reviewed and asserted against.
--
-- Keyed on `harvest_key` rather than on `case_id`, because the identity of a harvested case is its
-- source row and identity columns are not stable across a rebuild of the database.
--
-- Four of the 41 distinct numbers in these seven answers carry no pin, and each absence is a
-- statement rather than an omission:
--   * 5,161 in the Palawan answer matches both `searchGeo`'s `nTotal` for the province and the
--     indicator call's `validatedProfiles`. Two different fields on two different rows — the same
--     value today, not the same quantity — so neither is pinned.
--   * 270,917 in the training answer matches `validatedProfiles` on the root and `nTotal` on every
--     one of the thirty training rows. Same ambiguity, at scale.
--   * "near 100%" and "below 12%" are prose. No payload carries either, and the audit admits them
--     only through its rounding rule, which a pin deliberately does not have.

update ai_regression_case set expectations = '[
  {"call":1,"tool":"getIndicatorByGeo","from":"demographics","where":{"category":"YES"},"field":"n","value":2782},
  {"call":1,"tool":"getIndicatorByGeo","from":"demographics","where":{"category":"YES"},"field":"pct","value":53.9},
  {"call":1,"tool":"getIndicatorByGeo","field":"totalBhw","value":5642}
]'::jsonb
where harvest_key = '2026-07-19T11:06:51.388135+00:00|17053|how many ip bhw in palawan';

update ai_regression_case set expectations = '[
  {"call":1,"tool":"getIndicatorByGeo","field":"validatedProfiles","value":270917},
  {"call":1,"tool":"getIndicatorByGeo","field":"totalBhw","value":306835},
  {"call":0,"tool":"getHonorariumStats","where":{"payerLevel":"barangay"},"field":"pctReceiving","value":89.22},
  {"call":0,"tool":"getHonorariumStats","where":{"payerLevel":"barangay"},"field":"nReceiving","value":241712},
  {"call":0,"tool":"getHonorariumStats","where":{"payerLevel":"barangay"},"field":"avgMonthlyAmount","value":1290.81},
  {"call":0,"tool":"getHonorariumStats","where":{"payerLevel":"citymun"},"field":"pctReceiving","value":69.21},
  {"call":0,"tool":"getHonorariumStats","where":{"payerLevel":"citymun"},"field":"avgMonthlyAmount","value":1158.5},
  {"call":0,"tool":"getHonorariumStats","where":{"payerLevel":"province"},"field":"pctReceiving","value":52.71},
  {"call":0,"tool":"getHonorariumStats","where":{"payerLevel":"province"},"field":"avgMonthlyAmount","value":571.55},
  {"call":0,"tool":"getHonorariumStats","where":{"payerLevel":"region"},"field":"pctReceiving","value":1.87},
  {"call":0,"tool":"getHonorariumStats","where":{"payerLevel":"region"},"field":"avgMonthlyAmount","value":3698.2}
]'::jsonb
where harvest_key = '2026-07-19T11:06:51.388135+00:00|bhw-2025|PH|how are village health volunteers paid a monthly stipend';

update ai_regression_case set expectations = '[
  {"call":0,"tool":"getIndicatorByGeo","field":"totalBhw","value":306835},
  {"call":0,"tool":"getIndicatorByGeo","field":"validatedProfiles","value":270917}
]'::jsonb
where harvest_key = '2026-07-19T11:06:51.388135+00:00|national|how many bhws are validated profiles vs. the total';

update ai_regression_case set expectations = '[
  {"call":0,"tool":"getIndicatorByGeo","from":"demographics","where":{"category":"YES"},"field":"n","value":30600},
  {"call":0,"tool":"getIndicatorByGeo","from":"demographics","where":{"category":"YES"},"field":"pct","value":11.29},
  {"call":0,"tool":"getIndicatorByGeo","field":"validatedProfiles","value":270917},
  {"call":0,"tool":"getIndicatorByGeo","field":"totalBhw","value":306835},
  {"call":0,"tool":"getIndicatorByGeo","from":"demographics","where":{"category":"NO"},"field":"n","value":240317},
  {"call":0,"tool":"getIndicatorByGeo","from":"demographics","where":{"category":"NO"},"field":"pct","value":88.71}
]'::jsonb
where harvest_key = '2026-07-19T11:06:51.388135+00:00|PH|how many bhws are indigenous people';

update ai_regression_case set expectations = '[
  {"call":0,"tool":"getIndicatorByGeo","field":"totalBhw","value":306835},
  {"call":0,"tool":"getIndicatorByGeo","field":"validatedProfiles","value":270917},
  {"call":0,"tool":"getIndicatorByGeo","field":"profilingCoveragePct","value":97}
]'::jsonb
where harvest_key = '2026-07-19T11:06:51.388135+00:00|PH|how many bhws are validated profiles vs. the total';

update ai_regression_case set expectations = '[
  {"call":1,"tool":"getIndicatorByGeo","field":"profilingCoveragePct","value":97},
  {"call":1,"tool":"getIndicatorByGeo","field":"validatedProfiles","value":270917},
  {"call":1,"tool":"getIndicatorByGeo","field":"totalBhw","value":306835},
  {"call":0,"tool":"getDataCompleteness","where":{"fieldName":"active_years"},"field":"nMissing","value":20},
  {"call":0,"tool":"getDataCompleteness","where":{"fieldName":"active_years"},"field":"pctMissing","value":0.01}
]'::jsonb
where harvest_key = '2026-07-19T11:06:51.388135+00:00|PH|percentage of updating the bhw profiles nationwide';

update ai_regression_case set expectations = '[
  {"call":1,"tool":"getIndicatorByGeo","field":"totalBhw","value":306835},
  {"call":0,"tool":"getTrainingCoverage","where":{"topicSlug":"food_preparation_food_safety"},"field":"coveragePct","value":2.7},
  {"call":0,"tool":"getTrainingCoverage","where":{"topicSlug":"food_preparation_food_safety"},"field":"nTrained","value":7322},
  {"call":0,"tool":"getTrainingCoverage","where":{"topicSlug":"women_s_health"},"field":"coveragePct","value":2.96},
  {"call":0,"tool":"getTrainingCoverage","where":{"topicSlug":"women_s_health"},"field":"nTrained","value":8006},
  {"call":0,"tool":"getTrainingCoverage","where":{"topicSlug":"filariasis"},"field":"coveragePct","value":3.13},
  {"call":0,"tool":"getTrainingCoverage","where":{"topicSlug":"filariasis"},"field":"nTrained","value":8485}
]'::jsonb
where harvest_key = '2026-07-19T11:06:51.388135+00:00|PH|what''s the biggest training gap nationally';
