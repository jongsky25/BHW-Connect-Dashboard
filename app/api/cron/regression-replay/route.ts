import { NextResponse } from "next/server";
import { runScheduledReplay } from "@/lib/ai/regression-schedule";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The daily §10 replay (docs/AI_ASSISTANT_PLAN.md §10).
 *
 * WHY A SECOND CRON RATHER THAN A STEP INSIDE `/api/cron/precompute`. The precompute handler's own
 * header says "One invocation, not two, per Vercel Hobby's cron-job-count limit (pitfall P6)", and
 * that was true when it was written. It is not true now, and the limit was re-read rather than
 * remembered: Vercel's cron usage page (checked 2026-08-28) gives **100 cron jobs per project on
 * every plan**, Hobby included, after the 2026-01-20 change that removed the old per-team caps
 * (Hobby 2, Pro 40). What Hobby still caps is **frequency**: minimum interval once per day, and
 * scheduling precision to the hour — a job set for 22:00 fires anywhere in 22:00-22:59. So a
 * second *daily* job fits the free tier as it stands, and BUILD_PLAN P6 is corrected accordingly.
 *
 * Given that it fits, separate is better than chained for three reasons. The precompute run is
 * already time-boxed at 50s and reports running out of it — folding a replay in would spend that
 * budget on a different job and quietly reduce narrative coverage, which is the thing that cron
 * exists for. A replay that finds something must not read as a precompute failure. And the two want
 * different clocks: precompute at 20:00 UTC, this at 22:00 UTC, which is far enough apart that
 * Hobby's hour of slack on each cannot make them overlap.
 *
 * THE GATE. Identical to precompute's, including the refusal when `CRON_SECRET` is unset: an
 * endpoint that replays every regression case is a read-only diagnostic, but it is also a way to
 * make the database do eighteen cases' worth of work on demand, and guardrail 4's reasoning applies
 * to anything unauthenticated that loops over tool calls.
 *
 * THE STATUS CODE SAYS WHETHER THE RUN HAPPENED, NOT WHAT IT FOUND. 200 with `outcome: "moved"` is
 * a successful run that found eight moved figures — exactly what this job is for, and not a failed
 * invocation. 500 is reserved for the run not being recorded, because an unrecorded run is one
 * nobody will ever see, which is the gap this increment exists to close reappearing one step later.
 */

const TIME_BUDGET_MS = 45_000;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // refuse to run unauthenticated even if the secret is unset
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const result = await runScheduledReplay({ startedAt: started, deadlineMs: TIME_BUDGET_MS });

  // The per-case detail is in the row and on /admin/regressions. What comes back here is the
  // summary a log line can carry, plus the digest, so two invocations can be compared without
  // opening the table.
  const body = {
    outcome: result.run.outcome,
    casesOpen: result.run.casesOpen,
    casesReplayed: result.run.casesReplayed,
    ok: result.run.ok,
    degraded: result.run.degraded,
    broken: result.run.broken,
    pins: result.run.pins,
    pinsMet: result.run.pinsMet,
    pinsUnmet: result.run.pinsUnmet,
    pinsUnresolved: result.run.pinsUnresolved,
    findingsDigest: result.run.findingsDigest,
    durationMs: result.run.durationMs,
  };

  if (!result.recorded) {
    return NextResponse.json({ ...body, recorded: false, error: result.reason }, { status: 500 });
  }
  return NextResponse.json({ ...body, recorded: true, runId: result.runId });
}
