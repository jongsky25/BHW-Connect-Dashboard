import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaseReplay, SuiteReplay } from "./regression-runner";

const mocks = vi.hoisted(() => ({
  loadReplayableCases: vi.fn(),
  replaySuite: vi.fn(),
  recordRegressionRun: vi.fn(),
}));

vi.mock("@/lib/db/regression-cases", () => ({ loadReplayableCases: mocks.loadReplayableCases }));
vi.mock("@/lib/db/regression-runs", () => ({ recordRegressionRun: mocks.recordRegressionRun }));
vi.mock("./regression-runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./regression-runner")>()),
  replaySuite: mocks.replaySuite,
}));

const { summariseReplay, runScheduledReplay } = await import("./regression-schedule");

/**
 * The scheduled run's summary.
 *
 * These are the assertions that make the two design claims checkable rather than asserted in a
 * comment. The first is that a scheduled run does not flatten `unmet` into `unresolved` — the
 * 2026-08-28 entry argues at length that the distinction is load-bearing, and a summariser is
 * exactly where it would quietly be lost, because the obvious shape for a summary is one failure
 * count. The second is that a run which did not finish is never mistaken for a run that found
 * nothing.
 */

function pin(status: "met" | "unmet" | "unresolved", over: Record<string, unknown> = {}) {
  return {
    call: 0,
    tool: "queryDataset",
    from: null,
    where: { geo_code: "PH" },
    field: "n_listed",
    value: 5987,
    status,
    actual: status === "met" ? 5987 : null,
    reason: status === "met" ? null : "n_listed was 5,987, now 5,980",
    ...over,
  } as CaseReplay["expectations"][number];
}

function caseReplay(over: Partial<CaseReplay> = {}): CaseReplay {
  return {
    caseId: 8,
    question: "How many barangays are on the 2025 UUC for PHC list?",
    verdict: "ok",
    findings: [],
    toolCalls: [
      {
        name: "queryDataset",
        args: { table: "agg_uuc_phc_counts" },
        status: "ok",
        detail: null,
        chunkIds: [],
      },
    ],
    citations: [],
    expectations: [pin("met")],
    malformedExpectations: 0,
    ...over,
  };
}

function suite(cases: CaseReplay[], over: Partial<SuiteReplay> = {}): SuiteReplay {
  return {
    ran: cases.length,
    skipped: 0,
    ok: cases.filter((c) => c.verdict === "ok").length,
    degraded: cases.filter((c) => c.verdict === "degraded").length,
    broken: cases.filter((c) => c.verdict === "broken").length,
    caveat: "…",
    cases,
    ...over,
  };
}

const CONTEXT = {
  casesOpen: 1,
  startedAt: new Date("2026-08-29T22:00:00.000Z"),
  finishedAt: new Date("2026-08-29T22:00:11.500Z"),
};

describe("summariseReplay — the three outcomes", () => {
  it("calls a run clean when every case replayed and every pin met", () => {
    const run = summariseReplay(suite([caseReplay()]), CONTEXT);
    expect(run.outcome).toBe("clean");
    expect(run.pins).toBe(1);
    expect(run.pinsMet).toBe(1);
    expect(run.durationMs).toBe(11_500);
  });

  it("calls a moved figure `moved`, not `structural`", () => {
    const run = summariseReplay(
      suite([caseReplay({ verdict: "broken", expectations: [pin("unmet")] })]),
      CONTEXT,
    );
    expect(run.outcome).toBe("moved");
    expect(run.pinsUnmet).toBe(1);
    expect(run.pinsUnresolved).toBe(0);
  });

  it("calls an unscorable pin `structural`, not `moved`", () => {
    const run = summariseReplay(
      suite([caseReplay({ verdict: "broken", expectations: [pin("unresolved")] })]),
      CONTEXT,
    );
    expect(run.outcome).toBe("structural");
    expect(run.pinsUnmet).toBe(0);
    expect(run.pinsUnresolved).toBe(1);
  });

  it("keeps the two counts apart on a run that has both, and ranks structural above moved", () => {
    // The whole point. A summary reporting "2 failed" would be true and useless: one of these
    // wants the pins re-derived against new data, the other wants the case or the code fixed.
    const run = summariseReplay(
      suite([
        caseReplay({
          verdict: "broken",
          expectations: [pin("unmet"), pin("unresolved"), pin("met")],
        }),
      ]),
      CONTEXT,
    );
    expect(run.outcome).toBe("structural");
    expect([run.pinsMet, run.pinsUnmet, run.pinsUnresolved]).toEqual([1, 1, 1]);
  });

  it("is structural when a call did not run, even with every pin met", () => {
    const run = summariseReplay(
      suite([
        caseReplay({
          verdict: "broken",
          toolCalls: [
            { name: "getVibes", args: {}, status: "unknown-tool", detail: null, chunkIds: [] },
          ],
        }),
      ]),
      CONTEXT,
    );
    expect(run.outcome).toBe("structural");
  });

  it("is structural when an expectation could not be read at all", () => {
    const run = summariseReplay(suite([caseReplay({ malformedExpectations: 1 })]), CONTEXT);
    expect(run.outcome).toBe("structural");
  });

  it("separates a cited chunk that is gone (structural) from one that moved page (moved)", () => {
    const gone = summariseReplay(
      suite([
        caseReplay({
          verdict: "broken",
          citations: [
            {
              chunkId: 26,
              page: 26,
              resolves: false,
              pageUnchanged: false,
              textUnchanged: null,
              stillRetrieved: false,
            },
          ],
        }),
      ]),
      CONTEXT,
    );
    expect(gone.outcome).toBe("structural");

    const moved = summariseReplay(
      suite([
        caseReplay({
          verdict: "degraded",
          citations: [
            {
              chunkId: 26,
              page: 26,
              resolves: true,
              pageUnchanged: false,
              textUnchanged: true,
              stillRetrieved: true,
            },
          ],
        }),
      ]),
      CONTEXT,
    );
    expect(moved.outcome).toBe("moved");
  });
});

describe("summariseReplay — a run that did not finish", () => {
  it("is structural, and records how many cases it never opened", () => {
    const run = summariseReplay(suite([caseReplay()], { ran: 1, skipped: 5 }), {
      ...CONTEXT,
      casesOpen: 6,
    });
    expect(run.outcome).toBe("structural");
    expect(run.casesReplayed).toBe(1);
    expect(run.casesOpen).toBe(6);
  });

  it("does not share a digest with the complete run that found the same thing", () => {
    // Otherwise a run that stopped after one case would read as "unchanged since yesterday" —
    // silence about five cases presented as evidence about them.
    const complete = summariseReplay(suite([caseReplay()]), CONTEXT);
    const partial = summariseReplay(suite([caseReplay()], { ran: 1, skipped: 5 }), CONTEXT);
    expect(partial.findingsDigest).not.toBe(complete.findingsDigest);
  });
});

describe("summariseReplay — the digest", () => {
  it("is equal for two runs that found the same thing", () => {
    const one = summariseReplay(
      suite([caseReplay({ verdict: "broken", findings: ["n_listed was 5,991, now 5,987"] })]),
      CONTEXT,
    );
    const two = summariseReplay(
      suite([caseReplay({ verdict: "broken", findings: ["n_listed was 5,991, now 5,987"] })]),
      { ...CONTEXT, startedAt: new Date("2026-08-30T22:00:00.000Z") },
    );
    expect(two.findingsDigest).toBe(one.findingsDigest);
  });

  it("changes when the same case's figure moves again", () => {
    const one = summariseReplay(
      suite([caseReplay({ verdict: "broken", findings: ["n_listed was 5,991, now 5,987"] })]),
      CONTEXT,
    );
    const two = summariseReplay(
      suite([caseReplay({ verdict: "broken", findings: ["n_listed was 5,991, now 5,980"] })]),
      CONTEXT,
    );
    expect(two.findingsDigest).not.toBe(one.findingsDigest);
  });

  it("does not depend on the order the cases came back in", () => {
    const a = caseReplay({ caseId: 8, verdict: "broken", findings: ["one"] });
    const b = caseReplay({ caseId: 11, verdict: "broken", findings: ["two"] });
    expect(summariseReplay(suite([a, b]), CONTEXT).findingsDigest).toBe(
      summariseReplay(suite([b, a]), CONTEXT).findingsDigest,
    );
  });

  it("tells the same sentence about two different cases apart from one repeated", () => {
    const shared = "n_listed was 5,991, now 5,987";
    const twoCases = summariseReplay(
      suite([
        caseReplay({ caseId: 8, verdict: "broken", findings: [shared] }),
        caseReplay({ caseId: 11, verdict: "broken", findings: [shared] }),
      ]),
      CONTEXT,
    );
    const oneCase = summariseReplay(
      suite([caseReplay({ caseId: 8, verdict: "broken", findings: [shared, shared] })]),
      CONTEXT,
    );
    expect(twoCases.findingsDigest).not.toBe(oneCase.findingsDigest);
  });
});

describe("summariseReplay — bounding what it stores", () => {
  it("keeps twelve findings and says how many it dropped", () => {
    const findings = Array.from({ length: 20 }, (_, i) => `finding ${i}`);
    const run = summariseReplay(suite([caseReplay({ verdict: "broken", findings })]), CONTEXT);
    expect(run.cases[0].findings).toHaveLength(13);
    expect(run.cases[0].findings.at(-1)).toBe("and 8 more findings");
  });

  it("truncates one very long finding rather than dropping it", () => {
    const run = summariseReplay(
      suite([caseReplay({ verdict: "broken", findings: ["x".repeat(900)] })]),
      CONTEXT,
    );
    expect(run.cases[0].findings[0]).toHaveLength(400 + " [truncated]".length);
  });
});

describe("runScheduledReplay", () => {
  beforeEach(() => {
    mocks.loadReplayableCases.mockReset().mockResolvedValue([{ caseId: 8 }]);
    mocks.replaySuite.mockReset().mockResolvedValue(suite([caseReplay()]));
    mocks.recordRegressionRun.mockReset().mockResolvedValue(42);
  });

  it("hands the replay a deadline measured from the run's own start", async () => {
    await runScheduledReplay({ startedAt: 1_000, deadlineMs: 45_000 });
    expect(mocks.replaySuite).toHaveBeenCalledWith(expect.anything(), { deadlineAt: 46_000 });
  });

  it("reports the run as unrecorded when the write did not land", async () => {
    mocks.recordRegressionRun.mockResolvedValue(null);
    const result = await runScheduledReplay({ startedAt: Date.now(), deadlineMs: 45_000 });
    expect(result.recorded).toBe(false);
    // The summary survives so the caller can still put it in a log line — an unrecorded run is
    // worse than a recorded one, not the same as one that never happened.
    expect(result.run.outcome).toBe("clean");
  });

  it("returns the new run id when it did", async () => {
    const result = await runScheduledReplay({ startedAt: Date.now(), deadlineMs: 45_000 });
    expect(result).toMatchObject({ recorded: true, runId: 42 });
  });
});
