import { auditNarrative } from "./audit";
import { auditCitations, type Citation } from "./citations";

/**
 * Sentence-at-a-time auditing, so an answer can stream without weakening a single guarantee
 * (docs/AI_ASSISTANT_PLAN.md §8, Increment 5.6).
 *
 * ## Why streaming was refused before, and why it is safe now
 *
 * `app/api/ai/chat/route.ts` records the original decision: token streaming was rejected because
 * the numeric audit has to see the response before any of it is safe to show, and streaming
 * partial unaudited text risks flashing an ungrounded number before it is stripped. That reasoning
 * is correct and is not being traded away.
 *
 * What it overlooked is that **both audits are already sentence-scoped**. `auditNarrative` splits
 * into sentences and drops whole sentences whose numbers are untraceable; `auditCitations` does the
 * same for page references. Neither looks across a sentence boundary. So a sentence can be audited
 * the moment it is complete, and an ungrounded number is never rendered because it is never sent —
 * the guarantee is unchanged, and only the latency moves.
 *
 * ## Equivalence to the batch pipeline, stated precisely
 *
 * The route today runs `auditCitations` over the whole answer, then `auditNarrative` over what
 * survives — each pass splitting, filtering, and re-joining with a single space. This module
 * applies the same two audits to each sentence individually, in the same order (citations first,
 * for the reason `app/api/ai/assistant/route.ts` documents: it names the specific failure).
 *
 * For an answer whose sentences all end in terminal punctuation — every real answer — the two are
 * identical, and a property test asserts it over the existing audit fixtures.
 *
 * They can diverge in exactly one case, and it is worth naming rather than glossing: when a kept
 * sentence does **not** end in `.`, `!` or `?`, the batch pipeline's re-join makes the second pass
 * read it as one sentence with the text that follows, pooling their numbers, so one bad number
 * drops both. Per-sentence auditing drops only the offending fragment. That is stricter per
 * sentence and never looser: **every sentence this module emits has passed both audits on its
 * own**, which is the invariant the route actually depends on.
 */

export type SentenceAuditor = {
  /** Feed model output; returns the sentences that completed *and* passed both audits. */
  push(chunk: string): string[];
  /** End of stream: audit whatever trailing text has no terminal punctuation. */
  flush(): string[];
  /** Pages a dropped sentence claimed, for the UI's "dropped a sentence citing slide N" notice. */
  droppedPages(): number[];
  /** True when at least one sentence was dropped — the route reports a fully-stripped answer. */
  droppedAny(): boolean;
};

/**
 * A completed sentence is terminal punctuation followed by whitespace. Deliberately the same
 * boundary `splitSentences` uses in both audit modules, including its known limitation ("Dr. Smith"
 * splits): matching the existing behaviour exactly is the point, and a better splitter here would
 * make the streamed and batch results differ for a reason nobody asked for.
 */
const SENTENCE_BOUNDARY = /^([\s\S]*?[.!?])\s+/;

export function createSentenceAuditor(
  citations: Citation[],
  toolPayloads: unknown[],
): SentenceAuditor {
  let buffer = "";
  const droppedPageSet = new Set<number>();
  let dropped = false;

  /** Run one sentence through both audits, in the route's order. Returns null when it is dropped. */
  function auditOne(sentence: string): string | null {
    const trimmed = sentence.trim();
    if (!trimmed) return null;

    const cited = auditCitations(trimmed, citations);
    if (!cited.text) {
      dropped = true;
      for (const rejection of cited.rejected) {
        for (const page of rejection.pages) droppedPageSet.add(page);
      }
      return null;
    }

    const audited = auditNarrative(cited.text, toolPayloads);
    if (!audited.text) {
      dropped = true;
      return null;
    }
    return audited.text;
  }

  return {
    push(chunk) {
      buffer += chunk;
      const out: string[] = [];
      for (;;) {
        const match = SENTENCE_BOUNDARY.exec(buffer);
        if (!match) break;
        buffer = buffer.slice(match[0].length);
        const kept = auditOne(match[1]);
        if (kept) out.push(kept);
      }
      return out;
    },

    flush() {
      const rest = buffer;
      buffer = "";
      const kept = auditOne(rest);
      return kept ? [kept] : [];
    },

    droppedPages() {
      return [...droppedPageSet];
    },

    droppedAny() {
      return dropped;
    },
  };
}

/**
 * Convenience for tests and for the non-streaming fallback: run a whole answer through the
 * auditor and return what a stream of it would have emitted, joined the way the batch pipeline
 * joins — a single space.
 */
export function auditAsStream(
  text: string,
  citations: Citation[],
  toolPayloads: unknown[],
): { text: string; droppedPages: number[]; droppedAny: boolean } {
  const auditor = createSentenceAuditor(citations, toolPayloads);
  const sentences = [...auditor.push(text), ...auditor.flush()];
  return {
    text: sentences.join(" "),
    droppedPages: auditor.droppedPages(),
    droppedAny: auditor.droppedAny(),
  };
}
