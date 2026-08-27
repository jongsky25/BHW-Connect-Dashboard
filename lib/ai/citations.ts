/**
 * Citations for document-grounded answers (docs/AI_ASSISTANT_PLAN.md §8, Increment 2.3).
 *
 * §7 makes this a correctness feature rather than presentation, and the reasoning is worth
 * restating because it inverts the usual instinct. `auditNarrative` strips any sentence whose
 * numbers are absent from the tool payloads — so **numbers are checked and prose is not**. A claim
 * like "a highly technical request has a 20-working-day deadline" carries no figure, passes the
 * audit untouched, and is believed. For that claim the citation is the only check there is, which
 * is why §7 says a citation pointing at the wrong page is *worse* than none: it reads as verified.
 *
 * Two rules follow, and this module is both of them.
 *
 * 1. **The citation comes from retrieval, never from the model's prose.** `collectCitations` reads
 *    what `searchDocuments` actually returned this turn. A model cannot mis-cite a passage it
 *    never received, because it never gets to author the citation at all — the clickable source
 *    list is assembled from the payload. This is the same move as the numeric audit: the model
 *    proposes an answer, the system supplies the evidence.
 *
 * 2. **A page the model names in prose must be a page it was given.** Rule 1 secures the source
 *    list but not the sentence: nothing stops the model writing "slide 42 says" when it was handed
 *    slides 26, 27 and 37. `auditCitations` drops those sentences, exactly as `auditNarrative`
 *    drops a sentence with an untraceable number. A fabricated page is the citation-shaped version
 *    of a fabricated figure and deserves the same treatment.
 *
 * Deliberately pure — no I/O, no "server-only" — so every case is unit-testable without a database
 * or a provider, which is the same reason `audit.ts` is pure.
 */

export type Citation = {
  chunkId: number;
  document: string;
  documentTitle: string;
  /** The document's own as-of date. §12.4 rule 2: a document figure renders dated, not bare. */
  asOf: string | null;
  page: number;
  pageRange?: string;
  heading: string | null;
  /** The stored chunk text, verbatim — what the citation resolves to. */
  text: string;
  truncated: boolean;
  /** Offsets into the document's canonical extracted text (2.1), asserted at ingest. */
  charStart: number;
  charEnd: number;
  /** One quotable string, rendered by searchDocuments rather than reassembled here. */
  label: string;
};

type SearchHitShape = {
  chunkId: number;
  document: string;
  documentTitle: string;
  asOf: string | null;
  page: number;
  pageRange?: string;
  heading: string | null;
  text: string;
  truncated: boolean;
  charStart: number;
  charEnd: number;
  citation: string;
};

function isSearchHit(value: unknown): value is SearchHitShape {
  if (!value || typeof value !== "object") return false;
  const hit = value as Record<string, unknown>;
  return (
    typeof hit.chunkId === "number" &&
    typeof hit.page === "number" &&
    typeof hit.text === "string" &&
    typeof hit.citation === "string" &&
    typeof hit.documentTitle === "string"
  );
}

/**
 * Every document passage retrieved this turn, de-duplicated by chunk and in retrieval order.
 *
 * Identified by shape rather than by tool name because `runToolLoop` records payloads as a bare
 * array — it does not carry which tool produced which — and that loop is shared with the public
 * chat, so widening its result type to thread a name through would change a surface this increment
 * has no business changing. The shape is specific enough that nothing else in the tool set matches
 * it, and `searchDocuments` is the only tool that returns `chunkId` + `citation` together.
 */
export function collectCitations(toolPayloads: unknown[]): Citation[] {
  const byChunk = new Map<number, Citation>();

  for (const payload of toolPayloads) {
    if (!payload || typeof payload !== "object") continue;
    const results = (payload as { results?: unknown }).results;
    if (!Array.isArray(results)) continue;

    for (const hit of results) {
      if (!isSearchHit(hit)) continue;
      // First retrieval wins. The same slide can surface in two searches in one turn, and the
      // UUC distribution is byte-identical on slides 37 and 141 — which must stay two citations,
      // since a quote came from one of them and not the other.
      if (byChunk.has(hit.chunkId)) continue;
      byChunk.set(hit.chunkId, {
        chunkId: hit.chunkId,
        document: hit.document,
        documentTitle: hit.documentTitle,
        asOf: hit.asOf,
        page: hit.page,
        ...(hit.pageRange ? { pageRange: hit.pageRange } : {}),
        heading: hit.heading,
        text: hit.text,
        truncated: hit.truncated,
        charStart: hit.charStart,
        charEnd: hit.charEnd,
        label: hit.citation,
      });
    }
  }

  return [...byChunk.values()];
}

/**
 * Page references the model wrote in prose: "slide 37", "slides 160-168", "page 27", "p. 26".
 * A range contributes both endpoints, so "slides 160-168" against a retrieval of 160 alone is
 * caught — the model would be attributing to a slide it was never shown.
 */
const PAGE_REFERENCE_RE = /\b(?:slides?|pages?|pp?\.?)\s*(\d{1,4})(?:\s*(?:[–—-]|to)\s*(\d{1,4}))?\b/gi;

export function extractPageReferences(text: string): number[] {
  const pages: number[] = [];
  for (const match of text.matchAll(PAGE_REFERENCE_RE)) {
    const from = Number(match[1]);
    const to = match[2] ? Number(match[2]) : from;
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    if (to === from) {
      pages.push(from);
    } else if (to > from && to - from <= 40) {
      // "slides 160-168" attributes to all nine, so all nine must have been retrieved.
      for (let p = from; p <= to; p++) pages.push(p);
    } else {
      // A span wider than a deck (or a descending one) is a false positive on something else —
      // a year range, a figure. Take the endpoints rather than enumerating an implausible run.
      pages.push(from, to);
    }
  }
  return pages;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type CitationAuditResult = {
  /** The answer with every sentence citing an un-retrieved page removed. */
  text: string;
  /** Sentences dropped, and the page each of them claimed. For the UI's warning and for logging. */
  rejected: { sentence: string; pages: number[] }[];
};

/**
 * Drops every sentence naming a document page that was not retrieved this turn.
 *
 * When nothing was retrieved, any page reference at all is fabricated — that is the worst case,
 * a document claim made without ever opening a document, and it is caught by the same pass.
 *
 * Only *pages* are audited, not prose. A sentence that paraphrases a retrieved passage without
 * naming a slide is left alone: this pass cannot judge whether prose is supported, and pretending
 * to would drop good answers while proving nothing. What it can do exactly — and therefore does —
 * is refuse to let a specific, checkable, wrong pointer through.
 */
export function auditCitations(rawText: string, citations: Citation[]): CitationAuditResult {
  const retrieved = new Set<number>();
  for (const citation of citations) {
    const to = citation.pageRange ? Number(citation.pageRange.split("-")[1]) : citation.page;
    const end = Number.isFinite(to) ? Math.max(to, citation.page) : citation.page;
    for (let page = citation.page; page <= end; page++) retrieved.add(page);
  }

  const kept: string[] = [];
  const rejected: { sentence: string; pages: number[] }[] = [];

  for (const sentence of splitSentences(rawText)) {
    const pages = extractPageReferences(sentence);
    const unsupported = pages.filter((page) => !retrieved.has(page));
    if (unsupported.length === 0) {
      kept.push(sentence);
    } else {
      rejected.push({ sentence, pages: [...new Set(unsupported)] });
    }
  }

  return { text: kept.join(" "), rejected };
}
