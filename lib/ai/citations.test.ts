import { describe, expect, it } from "vitest";
import { auditCitations, collectCitations, extractPageReferences, type Citation } from "./citations";

/**
 * Increment 2.3's Verify is a correctness claim, not a rendering one (§7): a citation pointing at
 * the wrong page is worse than none, because it reads as verified. These cases are the two rules
 * that make that true — the citation comes from retrieval, and a page the model names must be a
 * page it was given.
 */

function hit(over: Record<string, unknown> = {}) {
  return {
    chunkId: 26,
    document: "blhsd-2027-budget-cue-cards",
    documentTitle: "[BLHSD] 2027 Budget Cue Cards",
    asOf: "2025-09-18",
    page: 27,
    heading: "DOH estimated budget allocation",
    text: "3rd 35,645 4th 27,058 5th 7,541",
    truncated: false,
    charStart: 15689,
    charEnd: 16404,
    citation: "[BLHSD] 2027 Budget Cue Cards, slide 27",
    ...over,
  };
}

const searchPayload = (...hits: Record<string, unknown>[]) => ({
  query: "honorarium",
  count: hits.length,
  retrieval: { lexical: true, vector: false },
  warnings: [],
  results: hits,
});

function citationFor(page: number, over: Partial<Citation> = {}): Citation {
  return {
    chunkId: page,
    document: "blhsd-2027-budget-cue-cards",
    documentTitle: "Cue Cards",
    asOf: null,
    page,
    heading: null,
    text: "…",
    truncated: false,
    charStart: 0,
    charEnd: 1,
    label: `Cue Cards, slide ${page}`,
    ...over,
  };
}

describe("collectCitations", () => {
  it("takes the citation from the retrieval payload, not from any prose", () => {
    const [citation] = collectCitations([searchPayload(hit())]);
    expect(citation).toMatchObject({
      chunkId: 26,
      page: 27,
      label: "[BLHSD] 2027 Budget Cue Cards, slide 27",
      asOf: "2025-09-18",
      charStart: 15689,
      charEnd: 16404,
    });
  });

  it("ignores payloads from every other tool", () => {
    const queryDatasetPayload = {
      table: "agg_bhw_counts",
      rows: [{ geo_code: "07", n_total: 1234 }],
      warnings: [],
    };
    const traversePayload = { source: "lineage", results: [{ key: "table:x", via: "…" }] };
    expect(collectCitations([queryDatasetPayload, traversePayload, { results: "not-an-array" }]))
      .toEqual([]);
  });

  it("de-duplicates a slide retrieved twice in one turn", () => {
    const collected = collectCitations([searchPayload(hit()), searchPayload(hit())]);
    expect(collected).toHaveLength(1);
  });

  it("keeps byte-identical slides apart — they are different citations", () => {
    // The UUC distribution is identical on slides 37 and 141. A quote came from one of them.
    const collected = collectCitations([
      searchPayload(
        hit({ chunkId: 36, page: 37, citation: "Cue Cards, slide 37" }),
        hit({ chunkId: 140, page: 141, citation: "Cue Cards, slide 141" }),
      ),
    ]);
    expect(collected.map((c) => c.page)).toEqual([37, 141]);
  });

  it("survives a malformed payload rather than throwing mid-answer", () => {
    expect(collectCitations([null, undefined, 42, "text", { results: [{ nope: true }] }])).toEqual([]);
  });
});

describe("extractPageReferences", () => {
  it.each([
    ["slide 37", [37]],
    ["Slide 37.", [37]],
    ["page 27", [27]],
    ["p. 26", [26]],
    ["pp. 47", [47]],
    ["slides 160-168", [160, 161, 162, 163, 164, 165, 166, 167, 168]],
    ["slides 160 to 162", [160, 161, 162]],
    ["slides 37–38", [37, 38]],
  ])("reads %s", (text, expected) => {
    expect(extractPageReferences(text)).toEqual(expected);
  });

  it("takes only the endpoints of an implausibly wide range", () => {
    expect(extractPageReferences("pages 1-4000")).toEqual([1, 4000]);
  });

  it("does not read a bare number as a page", () => {
    expect(extractPageReferences("277,767 registered BHWs in 2025")).toEqual([]);
  });
});

describe("auditCitations", () => {
  it("keeps a sentence citing a page that was actually retrieved", () => {
    const result = auditCitations(
      "The deck gives the honorarium split by income class (slide 27).",
      [citationFor(27)],
    );
    expect(result.text).toContain("slide 27");
    expect(result.rejected).toEqual([]);
  });

  it("drops a sentence citing a page that was never retrieved", () => {
    const result = auditCitations(
      "Accreditation is covered on slide 27. A technical request has a 20-working-day deadline, per slide 42.",
      [citationFor(27)],
    );
    expect(result.text).toBe("Accreditation is covered on slide 27.");
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].pages).toEqual([42]);
  });

  it("drops every page reference when no document was retrieved at all", () => {
    // The worst case: a document claim made without ever opening a document.
    const result = auditCitations("Slide 42 sets a 20-working-day deadline.", []);
    expect(result.text).toBe("");
    expect(result.rejected[0].pages).toEqual([42]);
  });

  it("leaves uncited prose alone — this pass judges pointers, not paraphrase", () => {
    const prose = "BHWs are supported through capacity building and a registry.";
    expect(auditCitations(prose, []).text).toBe(prose);
  });

  it("accepts any page inside a retrieved range", () => {
    const ranged = citationFor(160, { pageRange: "160-168", page: 160 });
    const result = auditCitations("The retention status is reported on slides 160-168.", [ranged]);
    expect(result.rejected).toEqual([]);
  });

  it("rejects a range that reaches past what was retrieved", () => {
    const result = auditCitations("Reported across slides 160-168.", [citationFor(160)]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].pages).toContain(168);
  });

  it("reports each fabricated page once, however often it is cited", () => {
    const result = auditCitations("Slide 42 says X. Slide 42 also says Y.", [citationFor(27)]);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected.every((r) => r.pages.length === 1)).toBe(true);
  });

  it("is a no-op on an empty answer", () => {
    expect(auditCitations("", [citationFor(27)])).toEqual({ text: "", rejected: [] });
  });
});
