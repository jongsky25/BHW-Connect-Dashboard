import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createInternalTools: vi.fn(),
  getDocChunk: vi.fn(),
}));

vi.mock("./dataset-tools", () => ({ createInternalTools: mocks.createInternalTools }));
vi.mock("@/lib/db/doc-chunks", () => ({ getDocChunk: mocks.getDocChunk }));

const { replayCase, replaySuite, REPLAY_CAVEAT } = await import("./regression-runner");

/** The case as 2.4 stores it: the question, the calls with their arguments, the passages cited. */
function storedCase(over: Record<string, unknown> = {}) {
  return {
    caseId: 1,
    question: "How many BHWs are there?",
    note: null,
    toolCalls: [{ name: "searchDocuments", args: { query: "registered and accredited BHWs" } }],
    citations: [{ chunkId: 26, page: 26, text: "277,767 (Registered and Accredited BHWs)" }],
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
