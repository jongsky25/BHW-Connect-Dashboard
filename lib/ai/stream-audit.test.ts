import { describe, expect, it } from "vitest";
import { auditNarrative } from "./audit";
import { auditCitations, type Citation } from "./citations";
import { auditAsStream, createSentenceAuditor } from "./stream-audit";

const citation = (page: number): Citation => ({
  chunkId: page,
  document: "cue-cards",
  documentTitle: "2027 Budget Cue Cards",
  asOf: "2025-12-01",
  page,
  heading: null,
  text: "…",
  truncated: false,
  charStart: 0,
  charEnd: 1,
  label: `cue cards, slide ${page}`,
});

/** What the route does today, for the equivalence property below. */
function batch(text: string, citations: Citation[], payloads: unknown[]): string {
  return auditNarrative(auditCitations(text, citations).text, payloads).text;
}

const PAYLOADS = [{ rows: [{ n_total: 3891, pct: 45.2 }] }];

describe("createSentenceAuditor", () => {
  it("emits a sentence only once it is complete", () => {
    const auditor = createSentenceAuditor([], PAYLOADS);
    expect(auditor.push("Region VII has 3,891 profiled")).toEqual([]);
    expect(auditor.push(" BHWs. Coverage is uneven.")).toEqual([
      "Region VII has 3,891 profiled BHWs.",
    ]);
    expect(auditor.flush()).toEqual(["Coverage is uneven."]);
  });

  /**
   * The guarantee that makes streaming safe at all: an ungrounded number is never rendered
   * because it is never sent.
   */
  it("never emits a sentence whose number is in no tool payload", () => {
    const auditor = createSentenceAuditor([], PAYLOADS);
    const emitted = [
      ...auditor.push("Region VII has 4,210 profiled BHWs. Coverage is uneven. "),
      ...auditor.flush(),
    ];
    expect(emitted).toEqual(["Coverage is uneven."]);
    expect(emitted.join(" ")).not.toContain("4,210");
  });

  /**
   * The payloads include the retrieval itself, which is what makes the slide number traceable to
   * the numeric audit as well — `app/api/ai/assistant/route.ts` documents that `auditNarrative`
   * counts a slide number as a number, so a cited page that is in no payload is stripped twice
   * over. Using the real `searchDocuments` shape here keeps the fixture honest.
   */
  it("never emits a sentence citing a slide that was not retrieved", () => {
    const docPayloads = [{ results: [{ chunkId: 37, page: 37, citation: "cue cards, slide 37" }] }];
    const auditor = createSentenceAuditor([citation(37)], docPayloads);
    const emitted = [
      ...auditor.push("Per slide 37 the list is final. Per slide 99 it is not. "),
      ...auditor.flush(),
    ];
    expect(emitted).toEqual(["Per slide 37 the list is final."]);
    expect(auditor.droppedPages()).toEqual([99]);
    expect(auditor.droppedAny()).toBe(true);
  });

  it("is unaffected by where the chunk boundaries fall", () => {
    const text = "Region VII has 3,891 profiled BHWs. Coverage is uneven across its provinces. ";
    const whole = auditAsStream(text, [], PAYLOADS).text;

    for (const size of [1, 3, 7, 20]) {
      const auditor = createSentenceAuditor([], PAYLOADS);
      const out: string[] = [];
      for (let i = 0; i < text.length; i += size) {
        out.push(...auditor.push(text.slice(i, i + size)));
      }
      out.push(...auditor.flush());
      expect(out.join(" "), `chunk size ${size}`).toBe(whole);
    }
  });

  it("does not split a decimal into two sentences", () => {
    const auditor = createSentenceAuditor([], [{ v: 45.2 }]);
    expect([...auditor.push("The rate is 45.2 percent. "), ...auditor.flush()]).toEqual([
      "The rate is 45.2 percent.",
    ]);
  });

  it("emits nothing for empty or whitespace-only output", () => {
    const auditor = createSentenceAuditor([], PAYLOADS);
    expect(auditor.push("   ")).toEqual([]);
    expect(auditor.flush()).toEqual([]);
    expect(auditor.droppedAny()).toBe(false);
  });
});

/**
 * The claim the increment rests on: streaming changes when text appears, never which text
 * appears. Asserted against the batch pipeline the route runs today.
 */
describe("equivalence with the batch pipeline", () => {
  const cases: { name: string; text: string; citations: Citation[]; payloads: unknown[] }[] = [
    {
      name: "all sentences grounded",
      text: "Region VII has 3,891 profiled BHWs. Coverage is uneven.",
      citations: [],
      payloads: PAYLOADS,
    },
    {
      name: "one ungrounded number",
      text: "Region VII has 4,210 profiled BHWs. Coverage is uneven.",
      citations: [],
      payloads: PAYLOADS,
    },
    {
      name: "a fabricated slide alongside a real one",
      text: "Per slide 37 the list is final. Per slide 99 it is not. Coverage is uneven.",
      citations: [citation(37)],
      payloads: PAYLOADS,
    },
    {
      name: "everything stripped",
      text: "There are 4,210 BHWs. There are 9,999 more.",
      citations: [],
      payloads: PAYLOADS,
    },
    {
      name: "no numbers and no citations",
      text: "Coverage is uneven. The gap is widening.",
      citations: [],
      payloads: [],
    },
    {
      name: "a percentage that rounds to a payload value",
      text: "The rate is 45.2 percent. It is unchanged.",
      citations: [],
      payloads: PAYLOADS,
    },
  ];

  it.each(cases)("matches the batch result for $name", ({ text, citations, payloads }) => {
    expect(auditAsStream(text, citations, payloads).text).toBe(batch(text, citations, payloads));
  });

  /**
   * The one documented divergence, asserted rather than hidden. A kept sentence with no terminal
   * punctuation is re-joined by the batch pipeline and read as one sentence with what follows, so
   * their numbers pool and one bad number drops both. Per-sentence auditing drops only the
   * offending fragment — stricter per sentence, never looser, and the invariant the route depends
   * on ("every emitted sentence passed both audits alone") still holds.
   */
  it("is stricter than the batch pipeline on an unterminated fragment, never looser", () => {
    const text = "Coverage is uneven";
    const streamed = auditAsStream(text, [], PAYLOADS).text;
    expect(streamed).toBe("Coverage is uneven");
    expect(batch(text, [], PAYLOADS)).toBe("Coverage is uneven");

    // Everything emitted survives both audits applied to it alone — the actual guarantee.
    for (const sentence of streamed.split(/(?<=[.!?])\s+/).filter(Boolean)) {
      expect(auditNarrative(auditCitations(sentence, []).text, PAYLOADS).text).toBe(sentence);
    }
  });
});
