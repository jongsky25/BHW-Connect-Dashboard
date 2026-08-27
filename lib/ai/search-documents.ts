import "server-only";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/db/service-client";
import { EMBEDDING_UNAVAILABLE_NOTE, embedQuery } from "./embed-query";
import type { Tool } from "./tools";

/**
 * `searchDocuments` (docs/AI_ASSISTANT_PLAN.md §8, Increment 2.2): the third retrieval path.
 *
 * Numbers come from SQL and prose comes from documents (§2). This tool is the prose half, and it
 * is the one whose results carry a *citation* rather than a figure — which per §7 is the whole
 * point: `auditNarrative` strips a sentence whose numbers are absent from the tool payloads, so it
 * covers numbers and nothing else. A prose claim has no figure to check, and the citation is the
 * only check it gets. That makes what this tool returns — document, page, and the span actually
 * quoted — a correctness surface, not presentation.
 *
 * Retrieval is hybrid and fused in Postgres (`search_documents`); see that migration for why
 * neither half suffices and why ranks are fused rather than scores blended. This module's job is
 * the contract around it: refuse before querying, degrade when the vector half is unavailable,
 * and hand back a payload where a thin result is visibly thin rather than quietly so.
 *
 * Internal only. `doc_chunk` is service-role only and holds internal budget material whose own
 * slide 26 records the BHW Connect site under system hold (§12.5); guardrail §9.1 is why this is
 * registered in `createInternalTools()` and nowhere else.
 */

export const MAX_SEARCH_RESULTS = 25;
export const DEFAULT_SEARCH_RESULTS = 6;
export const MAX_QUERY_LENGTH = 400;
export const SEARCH_TIMEOUT_MS = 8000;
/** Characters of each chunk returned. A slide averages 691, so this is a whole slide plus room. */
export const MAX_EXCERPT_CHARS = 1200;

export const searchDocumentsArgsSchema = z.object({
  query: z.string().min(2).max(MAX_QUERY_LENGTH),
  limit: z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional(),
  /** Restrict to one document by its `doc_source.key`. */
  document: z.string().min(1).max(120).optional(),
});

export type SearchDocumentsArgs = z.infer<typeof searchDocumentsArgsSchema>;

type SearchRow = {
  chunk_id: number;
  doc_key: string;
  doc_title: string;
  doc_as_of: string | null;
  page_from: number;
  page_to: number;
  heading: string | null;
  content: string;
  char_start: number;
  char_end: number;
  lexical_score: number | null;
  vector_distance: number | null;
  matched_by: "lexical" | "vector" | "both";
  score: number;
};

export type DocumentHit = {
  chunkId: number;
  document: string;
  documentTitle: string;
  /** The document's own as-of date. §12.4 rule 2: a figure from a document renders dated. */
  asOf: string | null;
  page: number;
  /** Present only when a chunk spans several slides, so a citation names the range (§12.3). */
  pageRange?: string;
  heading: string | null;
  text: string;
  truncated: boolean;
  /** Offsets into the document's canonical extracted text — what makes a quote resolvable. */
  charStart: number;
  charEnd: number;
  /** 'lexical' | 'vector' | 'both'. A 'both' hit was found independently by two methods. */
  matchedBy: SearchRow["matched_by"];
  citation: string;
};

export type SearchDocumentsResult = {
  query: string;
  count: number;
  /** Which halves actually ran. A caller can tell a thin result from a degraded one. */
  retrieval: { lexical: true; vector: boolean };
  warnings: string[];
  results: DocumentHit[];
};

export type SearchDocumentsError = { error: string };

/**
 * How a citation renders. Deliberately one quotable string rather than fields the model must
 * reassemble: an assistant that has to build "cue cards, slide 37" out of three fields will
 * eventually build it wrong, and a citation that names the wrong page is worse than none (§7).
 */
export function renderCitation(row: {
  doc_title: string;
  page_from: number;
  page_to: number;
}): string {
  const page =
    row.page_to > row.page_from ? `slides ${row.page_from}–${row.page_to}` : `slide ${row.page_from}`;
  return `${row.doc_title}, ${page}`;
}

export async function executeSearchDocuments(
  rawArgs: Record<string, unknown>,
): Promise<SearchDocumentsResult | SearchDocumentsError> {
  const parsed = searchDocumentsArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      error: `Invalid arguments for searchDocuments: ${issue?.path.join(".") || "query"} — ${
        issue?.message ?? "unrecognized shape"
      }. query is required (2-${MAX_QUERY_LENGTH} characters); limit is 1-${MAX_SEARCH_RESULTS}.`,
    };
  }
  const args = parsed.data;
  const limit = args.limit ?? DEFAULT_SEARCH_RESULTS;

  const embedded = await embedQuery(args.query);
  const warnings: string[] = [];
  if (!embedded.ok) warnings.push(EMBEDDING_UNAVAILABLE_NOTE[embedded.reason]);

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .rpc("search_documents", {
        p_query: args.query,
        p_limit: limit,
        p_embedding: embedded.ok ? embedded.value.embedding : null,
        p_model: embedded.ok ? embedded.value.model : null,
        p_doc_key: args.document ?? null,
      } as never)
      .abortSignal(AbortSignal.timeout(SEARCH_TIMEOUT_MS));

    if (error) return { error: `Document search failed: ${error.message}` };

    const rows = (data ?? []) as SearchRow[];
    const results: DocumentHit[] = rows.map((row) => {
      const truncated = row.content.length > MAX_EXCERPT_CHARS;
      return {
        chunkId: row.chunk_id,
        document: row.doc_key,
        documentTitle: row.doc_title,
        asOf: row.doc_as_of,
        page: row.page_from,
        ...(row.page_to > row.page_from ? { pageRange: `${row.page_from}-${row.page_to}` } : {}),
        heading: row.heading,
        text: truncated ? row.content.slice(0, MAX_EXCERPT_CHARS) : row.content,
        truncated,
        charStart: row.char_start,
        charEnd: row.char_end,
        matchedBy: row.matched_by,
        citation: renderCitation(row),
      };
    });

    if (results.length === 0) {
      // A refusal that teaches, as queryDataset's do: "no rows" invites the model to state the
      // emptiness as a finding, which for a document search is an assertion about the corpus.
      warnings.push(
        "No chunk matched. This means the words were not found, not that the corpus lacks the topic — try a distinctive phrase from the document, an exact code (\"DC No. 2025-0549\"), or a different wording.",
      );
    }

    return {
      query: args.query,
      count: results.length,
      retrieval: { lexical: true, vector: embedded.ok },
      warnings,
      results,
    };
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    return {
      error: timedOut
        ? `Document search exceeded the ${SEARCH_TIMEOUT_MS / 1000}s limit — try a shorter or more specific query.`
        : "Document search could not be completed.",
    };
  }
}

/** The tool as the model sees it. Internal only: it reads doc_chunk, which is service-role only. */
export function createSearchDocumentsTool(): Tool {
  return {
    definition: {
      name: "searchDocuments",
      description:
        "Search the ingested source documents and get back passages with a citation. Use this for anything the datasets do not hold as a number: policy and eligibility rules, programme descriptions, criteria, budget narrative, memo and circular references, and status reported in prose. It combines keyword matching — which is what finds an exact code like 'DC No. 2025-0549', 'JMC 2023-001' or 'RA 7883' — with meaning-based matching for questions asked in your own words. Every result carries the document, the slide number and the exact text; quote from that text and give the citation, and never state a document claim you did not retrieve. A figure that appears in a document rather than in a dataset must be attributed and dated ('the 2027 Budget Cue Cards state X as of ...'), never given as a bare fact.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "What to look for — an exact code or memo number, a distinctive phrase, or a question in plain words.",
          },
          limit: {
            type: "number",
            description: `Passages to return, 1-${MAX_SEARCH_RESULTS} (default ${DEFAULT_SEARCH_RESULTS}).`,
          },
          document: {
            type: "string",
            description:
              "Optional: restrict to one document by key, e.g. 'blhsd-2027-budget-cue-cards'.",
          },
        },
        required: ["query"],
      },
    },
    async execute(args) {
      return executeSearchDocuments(args);
    },
  };
}
