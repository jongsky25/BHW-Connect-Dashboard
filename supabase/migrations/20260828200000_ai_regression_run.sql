-- The scheduled replay's run record (docs/AI_ASSISTANT_PLAN.md §10).
--
-- WHY A TABLE AND NOT A LOG LINE. §10's runner has worked since 2026-08-27 and its list caught its
-- first real change on 2026-08-28 — but only because a person opened `/admin/regressions` within
-- hours of a merge. That entry states the limit plainly: "It does not establish that the list would
-- have caught a change nobody announced. Nothing runs the replay on a schedule, so the list still
-- only speaks when someone opens /admin/regressions."
--
-- A cron closes half of that. It does not close the other half by itself: a scheduled run whose
-- output goes nowhere is the same gap moved one step later — nobody opens the function logs either.
-- So each run writes one row here, and `/admin/regressions` renders the newest ones without
-- replaying anything. That is the whole reason this table exists: to make the run's finding
-- readable by someone who did not go looking for it.
--
-- THE THREE OUTCOMES, AND WHY `unmet` AND `unresolved` DO NOT COLLAPSE INTO ONE
--
-- `evaluateExpectation` already scores a pin three ways, and the 2026-08-28 entry is the worked
-- example of why the distinction is load-bearing: the UUC final-list alignment moved eight pinned
-- figures and every one came back `unmet`, "and that distinction is the reassuring part. The
-- selectors still found their rows and every field is still there, so nothing structural broke."
-- A run row that recorded only "8 failures" would have thrown that away.
--
-- So the row carries `pins_met`, `pins_unmet` and `pins_unresolved` as three counts, never a
-- failure total, and `outcome` ranks them by what a reader has to do next:
--
--   clean       every case replayed, every pin met, every citation still where the case left it.
--   moved       the suite checked everything it claims to check, and something it checks changed:
--               a pinned figure is `unmet`, or a cited passage moved page, changed text, or
--               dropped out of its own search. The response is to re-derive the pins against the
--               new data, which is what 2026-08-28 did for the eight UUC figures.
--   structural  the suite could NOT check something it claims to check: a pin `unresolved`, an
--               expectation that could not be read, a tool call that failed or is not in this
--               build, a cited chunk that is gone — or a case the run did not get to at all. The
--               response is to fix the case or the code. A run in this state is not evidence that
--               the figures it did not reach are fine.
--
-- `structural` outranks `moved` because an unscored assertion is a case that has quietly stopped
-- checking what it claims to, which is the failure the expectations column was built against.
--
-- AND WHY THERE IS A DIGEST. The other way a scheduled check fails is by shouting every day until
-- nobody reads it. `findings_digest` is md5 over the findings a run produced, so a run that found
-- exactly what yesterday's run found is recognisable as a repeat rather than as news. Nothing is
-- suppressed — the row is written either way — but the surface can say "unchanged since" instead of
-- presenting the same eight figures as a fresh alarm.
--
-- Service-role only, RLS in the same statement block as the CREATE TABLE (the 0.3 guardrail). The
-- per-case detail quotes findings about internal answers, and the findings name figures.
--
-- Idempotent: re-running this file is a no-op on a database that already has the table.
create table if not exists ai_regression_run (
  run_id bigint generated always as identity primary key,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  duration_ms integer not null,
  -- Open cases the run loaded, and how many it actually replayed. They differ when the run hit its
  -- time budget, and the difference is a `structural` outcome rather than a footnote: the run
  -- checked less than the list claims.
  cases_open integer not null,
  cases_replayed integer not null,
  -- The runner's own per-case verdicts, carried through unchanged.
  ok integer not null,
  degraded integer not null,
  broken integer not null,
  -- The pin tally, kept as three counts. See the header.
  pins integer not null,
  pins_met integer not null,
  pins_unmet integer not null,
  pins_unresolved integer not null,
  outcome text not null check (outcome in ('clean', 'moved', 'structural')),
  -- md5 over this run's findings. Equal to the previous run's when nothing new was found.
  findings_digest text not null,
  -- [{caseId, question, verdict, met, unmet, unresolved, findings: [...]}] — what moved, in the
  -- runner's own words, so the page can show it without replaying anything. Bounded by the writer.
  cases jsonb not null default '[]'::jsonb
);

-- The page reads "the newest few runs" and nothing else, so one index serves every read this table
-- has. Descending because that is the only direction anyone asks for.
create index if not exists ai_regression_run_started_idx on ai_regression_run (started_at desc);

alter table ai_regression_run enable row level security;
-- service-role only: no anon/authenticated policies.
