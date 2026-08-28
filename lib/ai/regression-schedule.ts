import "server-only";
import { createHash } from "node:crypto";
import { loadReplayableCases } from "@/lib/db/regression-cases";
import { recordRegressionRun } from "@/lib/db/regression-runs";
import { replaySuite, type CaseReplay, type SuiteReplay } from "./regression-runner";

/**
 * The scheduled half of the §10 runner (docs/AI_ASSISTANT_PLAN.md §10).
 *
 * WHAT THIS CLOSES. The runner has worked since 2026-08-27 and the list caught its first real
 * change on 2026-08-28 — eight pinned UUC figures moved by a merged data correction, and all eight
 * were named correctly. That entry is explicit about what it did not show: *"It does not establish
 * that the list would have caught a change nobody announced. Nothing runs the replay on a schedule,
 * so the list still only speaks when someone opens /admin/regressions."* A person went looking
 * within hours because they knew to. This runs whether anyone knows to or not.
 *
 * IT ALSO CLOSES THE OTHER HALF OF THE LIST. Route 1's ten seeded cases call `queryDataset`, which
 * reads the dataset registry, which is service-role only — so until now they had never replayed end
 * to end. A cron runs where the service-role key already lives, which is why the schedule and route
 * 1's first real replay are one increment rather than two.
 *
 * NO PROVIDER, STILL. The runner deliberately does not re-ask the question, because that needs a
 * provider key and *"a suite that only runs when someone has one never runs"*. Putting it on a
 * schedule makes that property load-bearing rather than incidental: a daily job that depended on a
 * free-tier provider quota would fail on the days the quota is spent, and a check that is absent
 * exactly when the system is under load is worse than no check. Nothing here calls a provider.
 *
 * WHAT A RUN DOES WITH WHAT IT FINDS — the design question this module exists to answer.
 *
 * 1. **It writes a row, always.** A run that finds nothing is evidence too: it is what makes
 *    "the last run was clean, at 06:11 this morning" a statement anyone can check. Without the
 *    clean rows, silence and health look identical, and the failure mode of a cron is silence.
 * 2. **It does not flatten `unmet` into `unresolved`.** See `summariseReplay` below and the
 *    migration header. A moved figure and a broken selector want different people doing different
 *    things, and 2026-08-28 is the worked example of the difference mattering.
 * 3. **It does not shout.** `findingsDigest` makes a repeat recognisable as a repeat, so a finding
 *    that has stood for four days reads as four days old rather than as four alarms.
 * 4. **Its HTTP status says whether the run happened, never what it found.** A run that finds eight
 *    moved figures did its job perfectly. A run that could not record its result did not, and only
 *    that second case is a failed invocation. Conflating them is the same flattening as (2), one
 *    level up: it would make a data correction indistinguishable from a broken cron.
 */

/** Bounded so one pathological case cannot make a run row unbounded. */
const MAX_FINDINGS_PER_CASE = 12;
const MAX_FINDING_CHARS = 400;

export type ScheduledRunCase = {
  caseId: number;
  question: string;
  verdict: string;
  met: number;
  unmet: number;
  unresolved: number;
  findings: string[];
};

export type RunOutcome = "clean" | "moved" | "structural";

export type ScheduledRun = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  casesOpen: number;
  casesReplayed: number;
  ok: number;
  degraded: number;
  broken: number;
  pins: number;
  pinsMet: number;
  pinsUnmet: number;
  pinsUnresolved: number;
  /** See `summariseReplay`. */
  outcome: RunOutcome;
  findingsDigest: string;
  cases: ScheduledRunCase[];
};

/**
 * Whether a case's replay says the suite *could not check* something it claims to check.
 *
 * This is the `structural` half of the split, and every clause is a way of not knowing rather than
 * a way of having found something. A pin that could not be resolved, an expectation that could not
 * be read, a call that did not run, a cited chunk that is gone: after any of these, the case has
 * stopped being evidence about the figure it names.
 */
function couldNotCheck(replay: CaseReplay): boolean {
  return (
    replay.expectations.some((pin) => pin.status === "unresolved") ||
    replay.malformedExpectations > 0 ||
    replay.toolCalls.some((call) => call.status !== "ok") ||
    replay.citations.some((cite) => !cite.resolves)
  );
}

/**
 * Whether a case's replay says something it checks has *changed*.
 *
 * A pinned figure that moved, or a cited passage that changed page, changed text, or dropped out of
 * the search that found it. The suite worked; the thing under it moved. The response is to look at
 * the change and re-derive, which is what 2026-08-28 did for the eight UUC figures.
 */
function somethingMoved(replay: CaseReplay): boolean {
  return (
    replay.expectations.some((pin) => pin.status === "unmet") ||
    replay.citations.some(
      (cite) => !cite.pageUnchanged || cite.textUnchanged === false || !cite.stillRetrieved,
    )
  );
}

/**
 * The run's outcome, ranked by what a reader has to do next.
 *
 * `structural` outranks `moved` because an unscored assertion is a case that has quietly stopped
 * checking what it claims to — the failure the expectations column was built against — whereas a
 * moved figure is the suite doing exactly its job. A run that did not reach every open case is
 * `structural` for the same reason: it has established nothing about the cases it never opened, and
 * a summary that counted only what it looked at would call the list green while a third of it went
 * unread.
 */
export function summariseReplay(
  suite: SuiteReplay,
  context: { casesOpen: number; startedAt: Date; finishedAt: Date },
): ScheduledRun {
  const cases: ScheduledRunCase[] = suite.cases.map((replay) => ({
    caseId: replay.caseId,
    question: replay.question,
    verdict: replay.verdict,
    met: replay.expectations.filter((pin) => pin.status === "met").length,
    unmet: replay.expectations.filter((pin) => pin.status === "unmet").length,
    unresolved: replay.expectations.filter((pin) => pin.status === "unresolved").length,
    findings: boundFindings(replay.findings),
  }));

  const pins = suite.cases.flatMap((replay) => replay.expectations);
  const structural = suite.skipped > 0 || suite.cases.some(couldNotCheck);
  const moved = suite.cases.some(somethingMoved);

  return {
    startedAt: context.startedAt.toISOString(),
    finishedAt: context.finishedAt.toISOString(),
    durationMs: context.finishedAt.getTime() - context.startedAt.getTime(),
    casesOpen: context.casesOpen,
    casesReplayed: suite.ran,
    ok: suite.ok,
    degraded: suite.degraded,
    broken: suite.broken,
    pins: pins.length,
    pinsMet: pins.filter((pin) => pin.status === "met").length,
    pinsUnmet: pins.filter((pin) => pin.status === "unmet").length,
    pinsUnresolved: pins.filter((pin) => pin.status === "unresolved").length,
    outcome: structural ? "structural" : moved ? "moved" : "clean",
    findingsDigest: digestFindings(cases, suite.skipped),
    cases,
  };
}

/** Findings are bounded, and what the bound dropped is said rather than silently lost. */
function boundFindings(findings: string[]): string[] {
  const kept = findings
    .slice(0, MAX_FINDINGS_PER_CASE)
    .map((finding) =>
      finding.length > MAX_FINDING_CHARS
        ? `${finding.slice(0, MAX_FINDING_CHARS)} [truncated]`
        : finding,
    );
  const dropped = findings.length - kept.length;
  return dropped > 0 ? [...kept, `and ${dropped} more finding${dropped === 1 ? "" : "s"}`] : kept;
}

/**
 * md5 over what this run found, so two runs that found the same thing are recognisably the same.
 *
 * Keyed on the case id and the finding text together: the same sentence about two different cases
 * is two findings, and the same case going from "was 5,991, now 5,987" to "now 5,980" is a new one
 * — which is right, because the second is a second data change and wants looking at again. Sorted,
 * because case order is a property of the read and not of what was found. The skipped count is in
 * the digest so a run that stopped early is never mistaken for the previous complete run.
 */
function digestFindings(cases: ScheduledRunCase[], skipped: number): string {
  const lines = cases
    .flatMap((entry) => entry.findings.map((finding) => `${entry.caseId} ${finding}`))
    .sort();
  return createHash("md5")
    .update(`skipped:${skipped}\n${lines.join("\n")}`)
    .digest("hex");
}

export type ScheduledReplayResult =
  | { recorded: true; runId: number; run: ScheduledRun }
  | { recorded: false; reason: string; run: ScheduledRun };

/**
 * Load every open case, replay it, summarise, persist.
 *
 * `deadlineMs` bounds the replay rather than the whole handler: the summary and the write are what
 * make the run visible, and giving up before them would spend the budget and leave nothing behind.
 */
export async function runScheduledReplay(options: {
  startedAt: number;
  deadlineMs: number;
  caseLimit?: number;
}): Promise<ScheduledReplayResult> {
  const startedAt = new Date(options.startedAt);
  const cases = await loadReplayableCases(options.caseLimit ?? 100);
  const suite = await replaySuite(cases, { deadlineAt: options.startedAt + options.deadlineMs });
  const run = summariseReplay(suite, {
    casesOpen: cases.length,
    startedAt,
    finishedAt: new Date(),
  });

  const runId = await recordRegressionRun(run);
  if (runId === null)
    return {
      recorded: false,
      // Said in the words the caller will show, because a cron's only reader is a log line.
      reason: "The replay ran but its result could not be recorded, so nothing was saved.",
      run,
    };
  return { recorded: true, runId, run };
}
