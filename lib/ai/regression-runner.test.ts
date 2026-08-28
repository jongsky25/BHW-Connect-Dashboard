import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createInternalTools: vi.fn(),
  getDocChunk: vi.fn(),
}));

vi.mock("./dataset-tools", () => ({ createInternalTools: mocks.createInternalTools }));
vi.mock("@/lib/db/doc-chunks", () => ({ getDocChunk: mocks.getDocChunk }));

const { replayCase, replaySuite, evaluateExpectation, REPLAY_CAVEAT } =
  await import("./regression-runner");

/** The case as 2.4 stores it: the question, the calls with their arguments, the passages cited. */
function storedCase(over: Record<string, unknown> = {}) {
  return {
    caseId: 1,
    question: "How many BHWs are there?",
    note: null,
    toolCalls: [{ name: "searchDocuments", args: { query: "registered and accredited BHWs" } }],
    citations: [{ chunkId: 26, page: 26, text: "277,767 (Registered and Accredited BHWs)" }],
    source: "reported",
    harvestLastSeenAt: null,
    expectations: [],
    malformedExpectations: [],
    ...over,
  };
}

/** A tool set where searchDocuments returns whichever chunk ids the test names. */
function toolsReturning(chunkIds: number[], extra: Record<string, unknown> = {}) {
  return [
    {
      definition: { name: "searchDocuments", description: "", parameters: {} },
      execute: vi
        .fn()
        .mockResolvedValue({ results: chunkIds.map((chunkId) => ({ chunkId })), ...extra }),
    },
  ];
}

beforeEach(() => {
  mocks.createInternalTools.mockReset();
  mocks.getDocChunk
    .mockReset()
    .mockResolvedValue({ pageFrom: 26, content: "277,767 (Registered and Accredited BHWs)" });
});

/**
 * The §10 runner. §10's own framing is that "the regressions worth catching are usually in which
 * tools were selected or which page was cited rather than in how the answer reads" — so these
 * cases are about the tool call and the citation, and every one of them is a failure that a diff
 * of the answer prose would miss entirely.
 */
describe("replayCase", () => {
  it("passes a case whose calls still run and whose citation is still retrieved", async () => {
    mocks.createInternalTools.mockReturnValue(toolsReturning([26, 27]));
    const replay = await replayCase(storedCase());
    expect(replay.verdict).toBe("ok");
    expect(replay.findings).toEqual([]);
    expect(replay.toolCalls[0]).toMatchObject({
      name: "searchDocuments",
      status: "ok",
      chunkIds: [26, 27],
    });
    expect(replay.citations[0]).toMatchObject({
      resolves: true,
      pageUnchanged: true,
      textUnchanged: true,
      stillRetrieved: true,
    });
  });

  it("replays the recorded arguments, not the question", async () => {
    // The point of storing arguments (2.4): a build that answers the same question by searching
    // for something else has changed behaviour, and only the recorded arguments show it.
    const tools = toolsReturning([26]);
    mocks.createInternalTools.mockReturnValue(tools);
    await replayCase(storedCase());
    expect(tools[0].execute).toHaveBeenCalledWith({ query: "registered and accredited BHWs" });
  });

  it("calls a case degraded when the cited slide drops out of its own search", async () => {
    // The failure this whole module exists for: the answer still reads fine, the tool still works,
    // and the passage it was built on is no longer what comes back.
    mocks.createInternalTools.mockReturnValue(toolsReturning([8, 151]));
    const replay = await replayCase(storedCase());
    expect(replay.verdict).toBe("degraded");
    expect(replay.findings).toEqual([
      "slide 26 is no longer returned by the search this answer used",
    ]);
  });

  it("calls a case degraded when the cited chunk's text has changed under it", async () => {
    mocks.createInternalTools.mockReturnValue(toolsReturning([26]));
    mocks.getDocChunk.mockResolvedValue({ pageFrom: 26, content: "277,767 (Registered BHWs)" });
    const replay = await replayCase(storedCase());
    expect(replay.verdict).toBe("degraded");
    expect(replay.findings[0]).toContain("different text than the case quoted");
  });

  it("calls a case degraded when the chunk moved to another slide", async () => {
    // A re-ingest that shifts a chunk by a page turns every citation into a wrong pointer, which
    // §7 calls worse than no citation at all because it reads as verified.
    mocks.createInternalTools.mockReturnValue(toolsReturning([26]));
    mocks.getDocChunk.mockResolvedValue({
      pageFrom: 27,
      content: "277,767 (Registered and Accredited BHWs)",
    });
    const replay = await replayCase(storedCase());
    expect(replay.verdict).toBe("degraded");
    expect(replay.findings[0]).toBe("chunk 26 was slide 26, now slide 27");
  });

  it("calls a case broken when the cited chunk is gone", async () => {
    mocks.createInternalTools.mockReturnValue(toolsReturning([26]));
    mocks.getDocChunk.mockResolvedValue(null);
    const replay = await replayCase(storedCase());
    expect(replay.verdict).toBe("broken");
    expect(replay.findings[0]).toContain("no longer in the corpus");
  });

  it("calls a case broken when the tool it used no longer exists", async () => {
    // A renamed tool is how a case stops being replayable without anyone noticing.
    mocks.createInternalTools.mockReturnValue([]);
    const replay = await replayCase(storedCase());
    expect(replay.verdict).toBe("broken");
    expect(replay.toolCalls[0].status).toBe("unknown-tool");
    expect(replay.findings[0]).toBe("searchDocuments is not a tool in this build");
  });

  it("reads a refusal returned as data, because that is how these tools fail", async () => {
    mocks.createInternalTools.mockReturnValue([
      {
        definition: { name: "searchDocuments", description: "", parameters: {} },
        execute: vi.fn().mockResolvedValue({ error: "limit 99 exceeds the search limit of 25" }),
      },
    ]);
    const replay = await replayCase(storedCase());
    expect(replay.verdict).toBe("broken");
    expect(replay.toolCalls[0]).toMatchObject({
      status: "error",
      detail: expect.stringContaining("exceeds"),
    });
  });

  it("survives a tool that throws rather than taking the whole replay down with it", async () => {
    mocks.createInternalTools.mockReturnValue([
      {
        definition: { name: "searchDocuments", description: "", parameters: {} },
        execute: vi.fn().mockRejectedValue(new Error("connection reset")),
      },
    ]);
    const replay = await replayCase(storedCase());
    expect(replay.verdict).toBe("broken");
    expect(replay.findings[0]).toBe("searchDocuments threw: connection reset");
  });

  it("does not invent a text mismatch for a case that recorded no passage", async () => {
    // The live seeded case is exactly this shape: §10.1 seeds are hand-written from what is on
    // screen, so they carry a chunk id and a page and no quoted text. Comparing against "" would
    // make every seeded case fail its first replay, which is how a suite gets ignored.
    mocks.createInternalTools.mockReturnValue(toolsReturning([26]));
    const replay = await replayCase(
      storedCase({ citations: [{ chunkId: 26, page: 26, text: "" }] }),
    );
    expect(replay.verdict).toBe("ok");
    expect(replay.findings).toEqual([]);
    expect(replay.citations[0].textUnchanged).toBeNull();
  });

  it("does not report an unretrieved citation for a case that recorded no tool calls", async () => {
    // An answer given with no tools cited nothing through a search, so "no longer retrieved" would
    // be a finding about a search that never happened.
    mocks.createInternalTools.mockReturnValue(toolsReturning([]));
    const replay = await replayCase(storedCase({ toolCalls: [] }));
    expect(replay.findings).toEqual([]);
    expect(replay.verdict).toBe("degraded");
    expect(replay.citations[0].stillRetrieved).toBe(false);
  });
});

describe("replaySuite", () => {
  it("counts the verdicts and always states what it did not check", async () => {
    mocks.createInternalTools.mockReturnValue(toolsReturning([26]));
    const suite = await replaySuite([storedCase(), storedCase({ caseId: 2, citations: [] })]);
    expect(suite).toMatchObject({ ran: 2, ok: 2, degraded: 0, broken: 0 });
    // The caveat is not decoration: a green run here says nothing about how the answer reads, and
    // the one thing that would make this list misleading is someone forgetting that.
    expect(suite.caveat).toBe(REPLAY_CAVEAT);
    expect(suite.caveat).toContain("was not regenerated");
  });
});

/**
 * §10's expected payload. Until this existed, "a `queryDataset` case is scored on whether the call
 * still runs and not on whether it returns the same figure" — which is what route 1's seeds are
 * for, since the whole point of a figure already rendered on a page is that the answer is known.
 *
 * The three statuses are the design. `met` and `unmet` are obvious; `unresolved` is the one that
 * earns its place, because a renamed column, a republication that doubles every geography's rows,
 * and a genuinely changed figure are three different findings that a two-valued pass/fail would
 * report identically.
 */
const NATIONAL = {
  table: "agg_bhw_counts",
  mode: "rows",
  rows: [{ geo_code: "PH", geo_level: "national", n_total: 270917, pct_accredited: 71.57 }],
};
const CERTIFICATION = {
  table: "agg_certification",
  mode: "rows",
  rows: [
    { geo_code: "PH", cert_type: "ref_manual_trained", n: 120971, pct: 44.65 },
    { geo_code: "PH", cert_type: "tesda_certified", n: 7702, pct: 2.84 },
    { geo_code: "PH", cert_type: "tesda_nc2", n: 11075, pct: 4.09 },
  ],
};
const pin = (over: Record<string, unknown> = {}) => ({
  call: 0,
  tool: "queryDataset",
  // Absent for every `queryDataset` case: that payload puts everything in `rows`. §10.1 route 3's
  // harvested cases set it, because the indicator tool names its array after the indicator.
  from: null,
  where: { geo_code: "PH" },
  field: "n_total",
  value: 270917,
  ...over,
});
const calls = (payload: unknown, name = "queryDataset") => [{ name, payload }];

describe("evaluateExpectation", () => {
  it("meets a pinned figure that has not moved", () => {
    const scored = evaluateExpectation(pin(), calls(NATIONAL));
    expect(scored).toMatchObject({ status: "met", actual: 270917, reason: null });
  });

  it("reads the payload root when the expectation names no row", () => {
    // A `mode: "count"` payload has no rows array at all; `matchingRows` sits on the root. This is
    // seeded case 4, the 5,991 reached from the fact table rather than the aggregate.
    const scored = evaluateExpectation(
      pin({ where: null, field: "matchingRows", value: 5991 }),
      calls({ table: "fact_uuc_phc_barangay", mode: "count", matchingRows: 5991 }),
    );
    expect(scored.status).toBe("met");
  });

  it("selects from the list `from` names, which is how a harvested case reaches its subject", () => {
    // §10.1 route 3. `getIndicatorByGeo` puts its counts on the root and its breakdown in an array
    // named after the indicator, and the breakdown is what most harvested answers are *about*.
    const payload = {
      totalBhw: 306835,
      demographics: [
        { dimension: "ip_status", category: "YES", n: 30600, pct: 11.29 },
        { dimension: "ip_status", category: "NO", n: 240317, pct: 88.71 },
      ],
    };
    const scored = evaluateExpectation(
      pin({
        tool: "getIndicatorByGeo",
        from: "demographics",
        where: { category: "YES" },
        field: "n",
        value: 30600,
      }),
      calls(payload, "getIndicatorByGeo"),
    );
    expect(scored).toMatchObject({ status: "met", actual: 30600 });
  });

  it("names the list in the finding, so a moved figure says which array it was in", () => {
    const payload = { demographics: [{ category: "YES", n: 30601 }] };
    const scored = evaluateExpectation(
      pin({
        tool: "getIndicatorByGeo",
        from: "demographics",
        where: { category: "YES" },
        field: "n",
        value: 30600,
      }),
      calls(payload, "getIndicatorByGeo"),
    );
    expect(scored.status).toBe("unmet");
    expect(scored.reason).toBe("demographics category=YES: n was 30,600, now 30,601");
  });

  it("reports a named list that is gone as unresolved, not as a moved figure", () => {
    // A renamed array and a changed number want different fixes, exactly as a renamed column and a
    // changed figure do.
    const scored = evaluateExpectation(
      pin({
        tool: "getIndicatorByGeo",
        from: "demographics",
        where: { category: "YES" },
        field: "n",
        value: 30600,
      }),
      calls({ totalBhw: 306835 }, "getIndicatorByGeo"),
    );
    expect(scored.status).toBe("unresolved");
    expect(scored.reason).toBe("the payload has no demographics array to select from");
  });

  it("selects one row out of several on a two-key selector", () => {
    const scored = evaluateExpectation(
      pin({ where: { geo_code: "PH", cert_type: "tesda_certified" }, field: "pct", value: 2.84 }),
      calls(CERTIFICATION),
    );
    expect(scored).toMatchObject({ status: "met", actual: 2.84 });
  });

  it("meets a boolean, so a figure that stopped rendering cannot pass on its numbers", () => {
    // Seeded case 10 pins `is_suppressed: false` because /explore withholds the workload figure
    // entirely when it is true — the numbers would still be computable and the page still blank.
    const scored = evaluateExpectation(
      pin({ field: "is_suppressed", value: false }),
      calls({ rows: [{ geo_code: "PH", is_suppressed: false, median: 52 }] }),
    );
    expect(scored.status).toBe("met");
  });

  it("names the figure, the old value and the new one when it moves", () => {
    const scored = evaluateExpectation(
      pin(),
      calls({ rows: [{ geo_code: "PH", n_total: 271000 }] }),
    );
    expect(scored.status).toBe("unmet");
    expect(scored.actual).toBe(271000);
    expect(scored.reason).toBe("geo_code=PH: n_total was 270,917, now 271,000");
  });

  it("names both types when a mismatch is a type change", () => {
    // Every numeric column these cases read was measured to arrive from PostgREST as a JSON
    // number, so no coercion rule is written. If one ever does arrive as a string, this finding is
    // the evidence for adding one rather than the rule having been guessed at.
    const scored = evaluateExpectation(
      pin(),
      calls({ rows: [{ geo_code: "PH", n_total: "270917" }] }),
    );
    expect(scored.status).toBe("unmet");
    expect(scored.reason).toContain("(number → string)");
  });

  it("refuses to score when the selector names more than one row", () => {
    // The live shape of this is a republication: a second dataset_id doubles every geography's
    // rows, and picking the first would silently score one vintage or the other at random.
    const scored = evaluateExpectation(pin(), calls({ rows: NATIONAL.rows.concat(NATIONAL.rows) }));
    expect(scored.status).toBe("unresolved");
    expect(scored.reason).toBe("2 rows matched geo_code=PH — a selector must name one");
  });

  it("says when no row carries the selector's own key, not just that nothing matched", () => {
    // The projection dropped geo_code. That is a broken case, not a changed figure, and the two
    // want different fixes.
    const scored = evaluateExpectation(pin(), calls({ rows: [{ n_total: 270917 }] }));
    expect(scored.status).toBe("unresolved");
    expect(scored.reason).toBe("no row matched geo_code=PH — no row carries geo_code");
  });

  it("reports a row that is simply not there", () => {
    const scored = evaluateExpectation(
      pin(),
      calls({ rows: [{ geo_code: "07", n_total: 18891 }] }),
    );
    expect(scored.status).toBe("unresolved");
    expect(scored.reason).toBe("no row matched geo_code=PH (1 rows returned)");
  });

  it("reports a renamed field as unresolved rather than as a changed figure", () => {
    const scored = evaluateExpectation(
      pin(),
      calls({ rows: [{ geo_code: "PH", n_records: 270917 }] }),
    );
    expect(scored.status).toBe("unresolved");
    expect(scored.reason).toBe("no field n_total (the row has: geo_code, n_records)");
  });

  it("reports a row selector against a payload that has no rows", () => {
    const scored = evaluateExpectation(pin(), calls({ mode: "count", matchingRows: 1 }));
    expect(scored.status).toBe("unresolved");
    expect(scored.reason).toContain("no rows to select from");
  });

  it("does not score a figure off a tool that refused", () => {
    // Refusals are returned as data by every tool in this set (§1), so a runner that only caught
    // exceptions would read a refusing tool's absent payload as an absent figure.
    const scored = evaluateExpectation(pin(), calls({ error: "Table x is not registered." }));
    expect(scored.status).toBe("unresolved");
    expect(scored.reason).toBe("queryDataset refused, so there is no figure to compare");
  });

  it("reports a call index the case no longer has", () => {
    const scored = evaluateExpectation(pin({ call: 2 }), calls(NATIONAL));
    expect(scored.status).toBe("unresolved");
    expect(scored.reason).toBe("call 2 was not made (the case records 1 tool call)");
  });

  it("refuses to score against a different tool at the same index", () => {
    // `call` alone would let an edited `tool_calls` shift an assertion onto another call and score
    // it there without saying so. `tool` is the cross-check that makes that loud.
    const scored = evaluateExpectation(pin(), calls(NATIONAL, "searchDocuments"));
    expect(scored.status).toBe("unresolved");
    expect(scored.reason).toBe(
      "call 0 is searchDocuments, but this expectation is about queryDataset",
    );
  });

  it("refuses to score a field whose value is not a scalar", () => {
    const scored = evaluateExpectation(
      pin(),
      calls({ rows: [{ geo_code: "PH", n_total: { value: 270917 } }] }),
    );
    expect(scored.status).toBe("unresolved");
    expect(scored.reason).toBe("n_total is object, not a value");
  });
});

/** A tool set with the two tools the seeded cases and the reported case between them use. */
function toolsFor(payloads: Record<string, unknown>) {
  return Object.entries(payloads).map(([name, payload]) => ({
    definition: { name, description: "", parameters: {} },
    execute: vi.fn().mockResolvedValue(payload),
  }));
}

describe("replayCase, on a case that pins figures", () => {
  const seeded = (over: Record<string, unknown> = {}) =>
    storedCase({
      source: "seeded",
      citations: [],
      toolCalls: [{ name: "queryDataset", args: { table: "agg_bhw_counts" } }],
      expectations: [pin(), pin({ field: "pct_accredited", value: 71.57 })],
      ...over,
    });

  it("passes when every pinned figure still comes back", async () => {
    mocks.createInternalTools.mockReturnValue(toolsFor({ queryDataset: NATIONAL }));
    const replay = await replayCase(seeded());
    expect(replay.verdict).toBe("ok");
    expect(replay.findings).toEqual([]);
    expect(replay.expectations.map((e) => e.status)).toEqual(["met", "met"]);
  });

  it("is broken, not degraded, when a figure moves — and says which one", async () => {
    // A moved figure is the only check here that scores an answer's content rather than its
    // plumbing. Grading it below a citation changing pages would put the thing route 1 was seeded
    // to catch in the quieter colour.
    mocks.createInternalTools.mockReturnValue(
      toolsFor({
        queryDataset: { rows: [{ geo_code: "PH", n_total: 270917, pct_accredited: 72.4 }] },
      }),
    );
    const replay = await replayCase(seeded());
    expect(replay.verdict).toBe("broken");
    expect(replay.findings).toEqual([
      "queryDataset[0] geo_code=PH: pct_accredited was 71.57, now 72.4",
    ]);
    expect(replay.expectations.map((e) => e.status)).toEqual(["met", "unmet"]);
  });

  it("reports an unreadable expectation rather than quietly checking one fewer", async () => {
    // The dangerous version of this is the one that skips: the case would go green having checked
    // less than it claims. The migration refuses to store such a row; this covers a row written
    // before that constraint, or under a later one that relaxes it.
    mocks.createInternalTools.mockReturnValue(toolsFor({ queryDataset: NATIONAL }));
    const replay = await replayCase(
      seeded({
        expectations: [pin()],
        malformedExpectations: ['{"call":0,"tool":"queryDataset"}'],
      }),
    );
    expect(replay.verdict).toBe("broken");
    expect(replay.expectations[0].status).toBe("met");
    expect(replay.findings).toEqual([
      'an expectation could not be read and was not checked: {"call":0,"tool":"queryDataset"}',
    ]);
  });

  it("keeps call indexes aligned when an earlier call could not run at all", async () => {
    // The payload list has to carry an entry for every recorded call, failures included. Skipping
    // one would shift every later assertion onto the wrong call — and score it there.
    mocks.createInternalTools.mockReturnValue(toolsFor({ queryDataset: NATIONAL }));
    const replay = await replayCase(
      seeded({
        toolCalls: [
          { name: "searchGeoRenamed", args: {} },
          { name: "queryDataset", args: { table: "agg_bhw_counts" } },
        ],
        expectations: [pin({ call: 1 })],
      }),
    );
    expect(replay.expectations[0]).toMatchObject({ status: "met", actual: 270917 });
    expect(replay.findings).toEqual(["searchGeoRenamed is not a tool in this build"]);
  });
});
