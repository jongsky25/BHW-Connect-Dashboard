import Link from "next/link";
import { loadReplayableCases } from "@/lib/db/regression-cases";
import { listRegressionRuns, type RegressionRunRecord } from "@/lib/db/regression-runs";
import { replaySuite, type CaseReplay } from "@/lib/ai/regression-runner";

/**
 * The §10 runner's surface (docs/AI_ASSISTANT_PLAN.md §10).
 *
 * §10 asks for "a growing list of questions with known-correct answers, used to tell whether a
 * change — chunk size, retrieval count, prompt wording, traversal depth — made answers better or
 * worse", and is explicit that "three answers read by hand say nothing about the other forty".
 * Increment 2.4 built the list; this is what spends it.
 *
 * **It replays on request, not on load.** A replay re-issues every tool call every open case
 * recorded, which is real work against the database and grows with the list. A page that did it on
 * every visit would be a page people stop visiting, and §10 only works if the list is looked at.
 * So the default render is the inventory and the replay is a link.
 *
 * **What the scheduled run adds is the part that does not need anyone to visit.** The daily cron
 * writes an `ai_regression_run` row, and the block at the top of this page renders the newest ones
 * as stored — no replaying, one cheap read. That block is the whole point of persisting the run: a
 * scheduled check whose output only exists in a function log has the same failure the schedule was
 * built to fix, one step later.
 */
export default async function AdminRegressionsPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  const { run } = await searchParams;
  const [cases, runs] = await Promise.all([loadReplayableCases(), listRegressionRuns()]);
  const suite = run === "1" ? await replaySuite(cases) : null;

  // The newest harvest stamp in the list *is* the last harvest run, because every case that run
  // reproduced was stamped with the same timestamp. A harvested case carrying an older one was not
  // reproduced — its ask-cache row was edited, blocked or unapproved — and it is kept rather than
  // deleted, so the page has to say so or the case reads as still vouched for.
  const lastHarvest = cases.reduce<string | null>(
    (newest, stored) =>
      stored.harvestLastSeenAt && (!newest || stored.harvestLastSeenAt > newest)
        ? stored.harvestLastSeenAt
        : newest,
    null,
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Regression cases</h2>
        <p className="mt-1 text-xs text-muted">
          Cases are filed from answers someone marked wrong, seeded from figures already rendered on
          public pages, and harvested from answers approved in the answer bank. Replaying re-issues
          the tool calls a case recorded, re-resolves the passages it cited, and checks that the
          figures it pinned still come back unchanged — against this build.
        </p>
      </div>

      <ScheduledRuns runs={runs} />

      {cases.length === 0 ? (
        <p className="text-sm text-muted">
          No open cases. Marking an assistant answer wrong files one, with the question, the tool
          calls, the citations and the figures behind it.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/admin/regressions?run=1"
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90"
          >
            Replay {cases.length} {cases.length === 1 ? "case" : "cases"}
          </Link>
          {suite && (
            <p className="text-xs text-muted">
              {suite.ok} ok · {suite.degraded} degraded · {suite.broken} broken
            </p>
          )}
        </div>
      )}

      {suite && (
        <p className="rounded-lg border border-border bg-surface p-3 text-xs text-muted">
          {suite.caveat}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {cases.map((stored) => {
          const replay = suite?.cases.find((r) => r.caseId === stored.caseId);
          return (
            <li key={stored.caseId} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                {replay && <Verdict verdict={replay.verdict} />}
                <p className="min-w-0 flex-1 text-sm font-medium">{stored.question}</p>
                <span className="font-mono text-[11px] text-muted">#{stored.caseId}</span>
              </div>
              {stored.note && (
                <p className="mt-1 text-xs text-muted">
                  {/* A reported case's note is the answer that should have been given; a seeded
                      case's is the screen its figure is rendered on; a harvested case's is where
                      in the answer bank it came from. Same column, three different claims, and one
                      label for all of them would misdescribe most of the list. */}
                  {NOTE_LABEL[stored.source] ?? "Should have said: "}
                  {stored.note}
                </p>
              )}
              {stored.harvestLastSeenAt && (
                <p className="mt-1 text-xs text-muted">
                  {stored.harvestLastSeenAt === lastHarvest ? (
                    <>Confirmed against the answer bank on {day(stored.harvestLastSeenAt)}.</>
                  ) : (
                    <span className="text-warning">
                      Stale: the last harvest did not reproduce this case. Its answer-bank row was
                      last confirmed on {day(stored.harvestLastSeenAt)} and may since have been
                      edited, blocked or unapproved. Kept, not deleted.
                    </span>
                  )}
                </p>
              )}
              <p className="mt-1 font-mono text-[11px] text-muted">
                {stored.toolCalls.length} tool {stored.toolCalls.length === 1 ? "call" : "calls"} ·{" "}
                {stored.citations.length} cited · {stored.expectations.length}{" "}
                {stored.expectations.length === 1 ? "figure" : "figures"} pinned
              </p>
              {replay && <ReplayDetail replay={replay} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** What a `note` is claiming, which differs by where the case came from. */
const NOTE_LABEL: Record<string, string> = {
  seeded: "On screen at: ",
  harvested: "Provenance: ",
  reported: "Should have said: ",
};

/** A stamp reads as a date here; the exact minute is a detail the case row does not turn on. */
function day(stamp: string): string {
  return stamp.slice(0, 10);
}

function Verdict({ verdict }: { verdict: CaseReplay["verdict"] }) {
  const style =
    verdict === "ok"
      ? "bg-accent-subtle text-accent"
      : verdict === "degraded"
        ? "bg-surface text-muted"
        : "bg-surface text-danger";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${style}`}>{verdict}</span>;
}

function ReplayDetail({ replay }: { replay: CaseReplay }) {
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
      {replay.findings.length > 0 && (
        <ul className="flex flex-col gap-1">
          {replay.findings.map((finding, i) => (
            <li key={i} className="text-xs text-danger">
              {finding}
            </li>
          ))}
        </ul>
      )}
      <ul className="flex flex-col gap-1 font-mono text-[11px]">
        {replay.expectations.map((scored, i) => (
          <li key={`e${i}`} className={scored.status === "met" ? "text-muted" : "text-danger"}>
            {scored.tool}[{scored.call}]{scored.where ? ` ${describeSelector(scored.where)}` : ""} ·{" "}
            {scored.field} = {formatExpected(scored.value)} → {scored.status}
          </li>
        ))}
        {replay.toolCalls.map((call, i) => (
          <li key={i} className={call.status === "ok" ? "text-muted" : "text-danger"}>
            {call.name}({JSON.stringify(call.args)}) → {call.status}
            {call.chunkIds.length > 0 && ` · ${call.chunkIds.length} chunks`}
          </li>
        ))}
        {replay.citations.map((cite) => (
          <li
            key={cite.chunkId}
            className={
              cite.resolves &&
              cite.pageUnchanged &&
              cite.textUnchanged !== false &&
              cite.stillRetrieved
                ? "text-muted"
                : "text-danger"
            }
          >
            slide {cite.page} (chunk {cite.chunkId}) →{" "}
            {[
              cite.resolves ? "resolves" : "MISSING",
              cite.pageUnchanged ? "same page" : "moved",
              cite.textUnchanged === null
                ? "no text recorded"
                : cite.textUnchanged
                  ? "same text"
                  : "text changed",
              cite.stillRetrieved ? "still retrieved" : "not retrieved",
            ].join(", ")}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The selector and the expected value, phrased the way the runner's findings phrase them.
 *
 * Deliberately not the *actual* value: the finding line above already carries "was X, now Y" for
 * anything that moved, and printing whole payload values into an admin page is how internal rows
 * end up in a rendered surface (§12.5). This line says what the case pins and whether it held.
 */
function describeSelector(where: Record<string, string | number | boolean>) {
  return Object.entries(where)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

function formatExpected(value: string | number | boolean) {
  return typeof value === "number" ? new Intl.NumberFormat("en-US").format(value) : String(value);
}

/**
 * A daily run is only useful if a stopped one is visible. `0 22 * * *` on Hobby fires anywhere in
 * the hour, so 36 hours is the first span that cannot be a late run and must be a missed day.
 */
const RUN_STALE_AFTER_MS = 36 * 60 * 60 * 1000;

/**
 * The scheduled replay, as recorded — read, never re-run.
 *
 * Three things this has to say, and only the first is the obvious one:
 *
 * 1. **What the last run found**, split into moved figures and unscorable ones, because those want
 *    different work (`docs/DECISIONS.md`, 2026-08-28: "Every one came back `unmet`, not
 *    `unresolved` — and that distinction is the reassuring part").
 * 2. **Whether it is new.** A finding standing since Tuesday is not four alarms, and a page that
 *    presents it as one teaches its reader to skim. Equal digests say so plainly.
 * 3. **Whether the job ran at all.** This is the one a run record exists to make sayable. A cron
 *    that silently stops looks exactly like a cron that keeps finding nothing, and "no news" would
 *    then mean the opposite of what a reader takes it to mean.
 */
function ScheduledRuns({ runs }: { runs: RegressionRunRecord[] }) {
  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-3 text-xs text-muted">
        No scheduled run has been recorded yet. Until one lands, this list still only speaks when
        someone presses Replay.
      </div>
    );
  }

  const latest = runs[0];
  const stale = latest.ageMs > RUN_STALE_AFTER_MS;
  // How many consecutive runs, counting back from the newest, found exactly what it found. One
  // means it is new. Bounded by the window this page reads, so it is a floor, not a total.
  let standingFor = 1;
  while (standingFor < runs.length && runs[standingFor].findingsDigest === latest.findingsDigest)
    standingFor += 1;
  const changed = latest.cases.filter(
    (entry) => entry.unmet > 0 || entry.unresolved > 0 || entry.findings.length > 0,
  );

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <Outcome outcome={latest.outcome} />
        <p className="min-w-0 flex-1 text-sm font-medium">
          Scheduled replay, {minute(latest.startedAt)}
        </p>
        <span className="font-mono text-[11px] text-muted">
          {latest.findingsDigest.slice(0, 8)}
        </span>
      </div>

      {stale && (
        <p className="text-xs text-warning">
          The daily replay has not run since {minute(latest.startedAt)}. Whatever this run says, it
          is not a statement about the build in front of you.
        </p>
      )}

      <p className="font-mono text-[11px] text-muted">
        {latest.casesReplayed} of {latest.casesOpen} cases replayed · {latest.ok} ok ·{" "}
        {latest.degraded} degraded · {latest.broken} broken · {latest.pinsMet} of {latest.pins}{" "}
        figures met · {latest.pinsUnmet} moved · {latest.pinsUnresolved} unscorable ·{" "}
        {(latest.durationMs / 1000).toFixed(1)}s
      </p>

      {latest.casesReplayed < latest.casesOpen && (
        <p className="text-xs text-danger">
          {latest.casesOpen - latest.casesReplayed} case
          {latest.casesOpen - latest.casesReplayed === 1 ? " was" : "s were"} not replayed before
          the run hit its time budget. Nothing here is a statement about those.
        </p>
      )}

      {standingFor > 1 && (
        <p className="text-xs text-muted">
          Unchanged across the last {standingFor} recorded runs — the same findings, not new ones.
        </p>
      )}

      {changed.length === 0 ? (
        <p className="text-xs text-muted">
          Nothing moved. Every recorded call ran and every pinned figure came back unchanged.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {changed.map((entry) => (
            <li key={entry.caseId} className="border-t border-border pt-2">
              <p className="text-xs">
                <span className="font-mono text-muted">#{entry.caseId}</span> {entry.question}
              </p>
              <p className="font-mono text-[11px] text-muted">
                {entry.met} met · {entry.unmet} moved · {entry.unresolved} unscorable
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {entry.findings.map((finding, i) => (
                  <li key={i} className="text-xs text-danger">
                    {finding}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * `moved` is the colour of work to do, not of a defect: a republication moving a pinned figure is
 * the suite succeeding. `structural` is the loud one, because after it the suite has stopped being
 * evidence about the figures it could not reach.
 */
function Outcome({ outcome }: { outcome: string }) {
  const style =
    outcome === "clean"
      ? "bg-accent-subtle text-accent"
      : outcome === "moved"
        ? "bg-surface text-warning"
        : "bg-surface text-danger";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${style}`}>{outcome}</span>;
}

/** A run is a point in a day, unlike a harvest stamp, so the minute is the part that identifies it. */
function minute(stamp: string): string {
  return stamp.slice(0, 16).replace("T", " ") + " UTC";
}
