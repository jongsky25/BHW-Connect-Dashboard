import "server-only";
import { createSupabaseServiceClient } from "@/lib/db/service-client";
import type { Json } from "@/lib/db/database.types";
import type { ScheduledRun } from "@/lib/ai/regression-schedule";

/**
 * Write and read layer for the scheduled replay's run record (docs/AI_ASSISTANT_PLAN.md §10).
 *
 * The write and the read are asymmetric on purpose, and it is the opposite asymmetry to
 * `regression-cases.ts`. There, a failed write degrades silently, because a capture path that
 * throws in a reader's face teaches them not to report the next wrong answer. Here the write *is*
 * the deliverable: a scheduled run whose record did not land is a run nobody will ever see, so the
 * caller is told, and `/api/cron/regression-replay` turns that into a failed invocation rather
 * than a green one. The read degrades to an empty list, matching every other reader in `lib/db`.
 *
 * Service-role only. The per-case detail carries findings that name figures.
 */

export type RegressionRunRecord = {
  runId: number;
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
  outcome: string;
  findingsDigest: string;
  cases: RegressionRunCase[];
  /**
   * How long ago the run started, measured when the row was read.
   *
   * Carried on the row rather than derived at render time because a render must be pure — reading
   * the clock inside a component is a lint error in this repository, and rightly: "is the daily job
   * still running" is a fact about when someone looked, not about the row. Measuring it here also
   * makes it one clock read for the whole list instead of one per row.
   */
  ageMs: number;
};

export type RegressionRunCase = {
  caseId: number;
  question: string;
  verdict: string;
  met: number;
  unmet: number;
  unresolved: number;
  findings: string[];
};

/**
 * Returns the new run id, or null when the write did not land.
 *
 * Never throws — the caller is a cron handler, and an exception there is an opaque 500 with no
 * body, which says less than a 500 that names what failed.
 */
export async function recordRegressionRun(run: ScheduledRun): Promise<number | null> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("ai_regression_run")
      .insert({
        started_at: run.startedAt,
        finished_at: run.finishedAt,
        duration_ms: run.durationMs,
        cases_open: run.casesOpen,
        cases_replayed: run.casesReplayed,
        ok: run.ok,
        degraded: run.degraded,
        broken: run.broken,
        pins: run.pins,
        pins_met: run.pinsMet,
        pins_unmet: run.pinsUnmet,
        pins_unresolved: run.pinsUnresolved,
        outcome: run.outcome,
        findings_digest: run.findingsDigest,
        // jsonb. Shaped entirely by `summariseReplay`, which builds it from the runner's own
        // output — the same cast `recordRegressionCase` makes, sound for the same reason.
        cases: run.cases as unknown as Json,
      })
      .select("run_id")
      .single();

    if (error || !data) return null;
    return data.run_id;
  } catch {
    return null;
  }
}

/**
 * The newest runs, newest first.
 *
 * More than one, because the page's question is not only "what did the last run find" but "is this
 * new" — and that is answered by comparing the newest run's digest with the one before it. Two
 * would do; a handful lets the page show that a finding has been standing for days without anyone
 * re-deriving the pins, which is a different problem from a finding that appeared this morning.
 */
export async function listRegressionRuns(limit = 5): Promise<RegressionRunRecord[]> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("ai_regression_run")
      .select(
        "run_id, started_at, finished_at, duration_ms, cases_open, cases_replayed, ok, degraded, broken, pins, pins_met, pins_unmet, pins_unresolved, outcome, findings_digest, cases",
      )
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];

    const readAt = Date.now();
    return data.map((row) => ({
      runId: row.run_id,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationMs: row.duration_ms,
      casesOpen: row.cases_open,
      casesReplayed: row.cases_replayed,
      ok: row.ok,
      degraded: row.degraded,
      broken: row.broken,
      pins: row.pins,
      pinsMet: row.pins_met,
      pinsUnmet: row.pins_unmet,
      pinsUnresolved: row.pins_unresolved,
      outcome: row.outcome,
      findingsDigest: row.findings_digest,
      cases: readRunCases(row.cases),
      ageMs: readAt - Date.parse(row.started_at),
    }));
  } catch {
    return [];
  }
}

/**
 * Stored per-case detail → the shape the page renders, dropping anything it cannot read.
 *
 * Dropping is right here and wrong one level down. A malformed *expectation* is reported rather
 * than skipped, because skipping it would leave a case green while checking less than it claims.
 * This is a rendering of a run that has already been scored: an unreadable element cannot change
 * the verdict the row records, and inventing a finding out of it would be the invention.
 */
function readRunCases(stored: unknown): RegressionRunCase[] {
  if (!Array.isArray(stored)) return [];
  const cases: RegressionRunCase[] = [];
  for (const raw of stored) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.caseId !== "number" || typeof row.question !== "string") continue;
    cases.push({
      caseId: row.caseId,
      question: row.question,
      verdict: typeof row.verdict === "string" ? row.verdict : "unknown",
      met: typeof row.met === "number" ? row.met : 0,
      unmet: typeof row.unmet === "number" ? row.unmet : 0,
      unresolved: typeof row.unresolved === "number" ? row.unresolved : 0,
      findings: Array.isArray(row.findings)
        ? row.findings.filter((f): f is string => typeof f === "string")
        : [],
    });
  }
  return cases;
}
