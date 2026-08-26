import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Two seams are stubbed: the RPC (so the exact call the tool issues is asserted, not just the
 * payload it returns — a dropped filter is the failure a payload assertion alone would miss) and
 * the query embedder (so the degraded path, which is the live state until the corpus is embedded,
 * is exercised as deliberately as the vector one).
 */
const calls: { fn: string; params: Record<string, unknown> }[] = [];
let response: { data: unknown; error: { message: string } | null } = { data: [], error: null };
let embedResult: unknown = { ok: false, reason: "no-corpus-embedding" };

vi.mock("@/lib/db/service-client", () => ({
  createSupabaseServiceClient: () => ({
    rpc: (fn: string, params: Record<string, unknown>) => {
      calls.push({ fn, params });
      return { abortSignal: () => Promise.resolve(response) };
    },
  }),
}));

vi.mock("./embed-query", async () => {
  const actual = await vi.importActual<typeof import("./embed-query")>("./embed-query");
  return { ...actual, embedQuery: async () => embedResult };
});

const {
  DEFAULT_SEARCH_RESULTS,
  MAX_EXCERPT_CHARS,
  MAX_SEARCH_RESULTS,
  createSearchDocumentsTool,
  executeSearchDocuments,
  renderCitation,
} = await import("./search-documents");

function row(over: Record<string, unknown> = {}) {
  return {
    chunk_id: 26,
    doc_key: "blhsd-2027-budget-cue-cards",
    doc_title: "[BLHSD] 2027 Budget Cue Cards",
    doc_as_of: "2025-09-18",
    page_from: 27,
    page_to: 27,
    heading: "DOH estimated budget allocation",
    content: "3rd 35,645 4th 27,058 5th 7,541",
    char_start: 15689,
    char_end: 16404,
    lexical_score: 1,
    vector_distance: null,
    matched_by: "lexical",
    score: 0.0164,
    ...over,
  };
}

async function ok(args: Record<string, unknown>) {
  const result = await executeSearchDocuments(args);
  if ("error" in result) throw new Error(`expected a result, got refusal: ${result.error}`);
  return result;
}

async function refusal(args: Record<string, unknown>) {
  const result = await executeSearchDocuments(args);
  if (!("error" in result)) throw new Error("expected a refusal, got a result");
  return result.error;
}

beforeEach(() => {
  calls.length = 0;
  response = { data: [], error: null };
  embedResult = { ok: false, reason: "no-corpus-embedding" };
});

describe("searchDocuments — refusals", () => {
  it("refuses a missing query and names what it needs", async () => {
    const error = await refusal({});
    expect(error).toContain("query is required");
    expect(calls).toHaveLength(0);
  });

  it("refuses a one-character query rather than scanning on it", async () => {
    expect(await refusal({ query: "x" })).toContain("query");
    expect(calls).toHaveLength(0);
  });

  it("refuses a limit past the cap before issuing the query", async () => {
    expect(await refusal({ query: "honorarium", limit: MAX_SEARCH_RESULTS + 1 })).toContain(
      `limit is 1-${MAX_SEARCH_RESULTS}`,
    );
    expect(calls).toHaveLength(0);
  });

  it("surfaces a database error as data, never as a throw", async () => {
    response = { data: null, error: { message: "statement timeout" } };
    expect(await refusal({ query: "honorarium" })).toContain("statement timeout");
  });
});

describe("searchDocuments — the call it issues", () => {
  it("passes the query and the default limit, with no embedding when none is available", async () => {
    await ok({ query: "DC No. 2025-0549" });
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("search_documents");
    expect(calls[0].params).toMatchObject({
      p_query: "DC No. 2025-0549",
      p_limit: DEFAULT_SEARCH_RESULTS,
      p_embedding: null,
      p_model: null,
      p_doc_key: null,
    });
  });

  it("passes the document filter through — a dropped filter would silently widen the search", async () => {
    await ok({ query: "honorarium", document: "blhsd-2027-budget-cue-cards", limit: 3 });
    expect(calls[0].params).toMatchObject({
      p_doc_key: "blhsd-2027-budget-cue-cards",
      p_limit: 3,
    });
  });

  it("sends the vector and its model together when the query embeds", async () => {
    embedResult = { ok: true, value: { embedding: "[0.1,0.2]", model: "probe-model", dim: 2 } };
    await ok({ query: "how are BHWs supported" });
    expect(calls[0].params).toMatchObject({ p_embedding: "[0.1,0.2]", p_model: "probe-model" });
  });
});

describe("searchDocuments — degrading when the vector half is unavailable", () => {
  it("still returns results, and says the search was keyword-only", async () => {
    response = { data: [row()], error: null };
    const result = await ok({ query: "35,645" });

    expect(result.count).toBe(1);
    expect(result.retrieval).toEqual({ lexical: true, vector: false });
    expect(result.warnings.join(" ")).toContain("keyword matches only");
  });

  it("reports both halves as run once a vector is available", async () => {
    embedResult = { ok: true, value: { embedding: "[1,0]", model: "probe-model", dim: 2 } };
    response = { data: [row({ matched_by: "both", vector_distance: 0 })], error: null };
    const result = await ok({ query: "honorarium" });

    expect(result.retrieval).toEqual({ lexical: true, vector: true });
    expect(result.warnings).toHaveLength(0);
    expect(result.results[0].matchedBy).toBe("both");
  });

  it("explains an empty result rather than letting it read as 'the corpus is silent'", async () => {
    const result = await ok({ query: "nothing matches this" });
    expect(result.count).toBe(0);
    expect(result.warnings.join(" ")).toContain("not that the corpus lacks the topic");
  });
});

describe("searchDocuments — what a citation carries", () => {
  it("renders one quotable citation string per hit", async () => {
    response = { data: [row()], error: null };
    const [hit] = (await ok({ query: "honorarium" })).results;

    expect(hit.citation).toBe("[BLHSD] 2027 Budget Cue Cards, slide 27");
    expect(hit.page).toBe(27);
    expect(hit.pageRange).toBeUndefined();
  });

  it("cites a range, not a single page, when a chunk spans slides", () => {
    expect(renderCitation({ doc_title: "Cue Cards", page_from: 160, page_to: 168 })).toBe(
      "Cue Cards, slides 160–168",
    );
  });

  it("carries the offsets and as-of date a citation has to be checkable against", async () => {
    response = { data: [row()], error: null };
    const [hit] = (await ok({ query: "honorarium" })).results;

    expect(hit.charStart).toBe(15689);
    expect(hit.charEnd).toBe(16404);
    expect(hit.chunkId).toBe(26);
    // Plan §12.4 rule 2: a figure carried by a document renders attributed AND dated, so the
    // date has to reach the model with the text.
    expect(hit.asOf).toBe("2025-09-18");
  });

  it("marks a truncated excerpt as truncated rather than quietly shortening a quote", async () => {
    const long = "x".repeat(MAX_EXCERPT_CHARS + 50);
    response = { data: [row({ content: long })], error: null };
    const [hit] = (await ok({ query: "honorarium" })).results;

    expect(hit.text).toHaveLength(MAX_EXCERPT_CHARS);
    expect(hit.truncated).toBe(true);
  });

  it("leaves a whole slide intact", async () => {
    response = { data: [row()], error: null };
    const [hit] = (await ok({ query: "honorarium" })).results;
    expect(hit.truncated).toBe(false);
    expect(hit.text).toBe("3rd 35,645 4th 27,058 5th 7,541");
  });
});

describe("searchDocuments — the tool the model is shown", () => {
  const tool = createSearchDocumentsTool();

  it("is named searchDocuments and requires a query", () => {
    expect(tool.definition.name).toBe("searchDocuments");
    expect(tool.definition.parameters.required).toEqual(["query"]);
  });

  it("tells the model that a document figure must be attributed and dated", () => {
    // §12.4's rule is only enforceable if the tool description carries it; the audit cannot.
    expect(tool.definition.description).toContain("attributed and dated");
  });

  it("names the exact-code case, which is the half a vector search is worst at", () => {
    expect(tool.definition.description).toContain("DC No. 2025-0549");
  });

  it("returns a refusal through execute rather than throwing", async () => {
    await expect(tool.execute({})).resolves.toHaveProperty("error");
  });
});
