-- Internal AI assistant, Increment 2.4 (docs/AI_ASSISTANT_PLAN.md §8): failure capture.
--
-- §10 asks for "a growing list of questions with known-correct answers", and is explicit that a
-- fixed evaluation corpus chosen up front would be stale by Phase 2 — sources arrive
-- incrementally and are not known in advance. This table is how the list grows instead: from real
-- failures, so it tracks whatever data has actually been loaded rather than what someone imagined
-- would be.
--
-- §7 frames the same thing from the other side. There is deliberately no queue of answers awaiting
-- approval (owner decision 8): reviewing every answer is unbounded work that degrades to
-- rubber-stamping. Failure capture is the opposite trade — effort is spent only on answers that
-- were actually wrong, and that effort permanently guards against a repeat.
--
-- WHAT "REPLAYABLE" REQUIRES, AND WHY EACH COLUMN IS HERE
--
-- The Verify is that a stored case "can be re-run against a later build". A question alone cannot
-- do that: the assistant is multi-turn, so an answer often depends on what came before it, and
-- the interesting regressions are usually in *tool selection* rather than in prose. So a case
-- stores three things a re-run needs and one a reviewer needs:
--
--   conversation  — the full message history, replayed verbatim. Not just the last question.
--   tool_calls    — which tools ran, with their arguments, in order. A later build that answers
--                   the same question by calling different tools has changed behaviour even if
--                   the prose looks similar, and that is exactly what §10 wants to detect.
--   citations     — the passages a document answer leaned on, so a citation regression (2.3's
--                   failure mode: right answer, wrong page) is visible and not just the text.
--   note          — free text: what the correct answer was. Optional, because a reporter who
--                   knows an answer is wrong but not why should still be able to say so; a case
--                   with no expected answer is still a case worth re-running by hand.
--
-- provider is stored because the cascade means two runs of the same question can be answered by
-- different models, and "it regressed" and "it was answered by Groq this time" are different
-- findings that look identical without it.
--
-- Service-role only, RLS in the same statement block as the CREATE TABLE (the 0.3 guardrail).
-- These rows quote internal answers about internal data and must not be publicly readable.
create table ai_regression_case (
  case_id bigint generated always as identity primary key,
  -- The question as asked. Denormalised out of `conversation` so the list can be read, searched
  -- and de-duplicated without unpacking jsonb on every row.
  question text not null,
  -- [{role, content}] — the exact history sent to the assistant, so a replay reproduces context.
  conversation jsonb not null,
  answer_given text not null,
  -- [{name, args}] in call order.
  tool_calls jsonb not null default '[]'::jsonb,
  -- The citation payload from Increment 2.3, where the answer had one.
  citations jsonb not null default '[]'::jsonb,
  provider text,
  -- What the answer should have been. Optional on purpose; see the header.
  note text,
  -- 'reported' — captured from a real answer by the control in the assistant UI.
  -- 'seeded'   — §10.1's dashboard-derived questions, whose expected answers are already on screen.
  source text not null default 'reported' check (source in ('reported', 'seeded')),
  -- 'open' is a live regression; 'fixed' is guarded by a later build; 'invalid' is a case that
  -- turned out not to be a failure. Kept, not deleted: "we looked and it was fine" is itself worth
  -- knowing the next time the same answer is reported.
  status text not null default 'open' check (status in ('open', 'fixed', 'invalid', 'wontfix')),
  -- The admin who reported it. A uuid column, matching how usage_events keys internal turns.
  reported_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ai_regression_case_status_idx on ai_regression_case (status, created_at desc);

alter table ai_regression_case enable row level security;
-- service-role only: no anon/authenticated policies.
