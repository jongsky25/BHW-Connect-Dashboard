import "server-only";
import { createSupabaseServiceClient } from "@/lib/db/service-client";

/**
 * Embeds one search query (docs/AI_ASSISTANT_PLAN.md §8, Increment 2.2).
 *
 * WHY THIS IS ALLOWED IN A REQUEST, WHEN 2.1's EMBEDDING IS NOT. The plan says chunk and embed
 * "in the Python pipeline, never in a Vercel function". That is about the *corpus*: 213 slides is
 * a batch workload that would blow a serverless timeout, and it belongs where the rest of the
 * ingestion lives. A query embedding is one short call for text that does not exist until the
 * request arrives, so there is nowhere else it could happen — vector search inherently requires
 * embedding the query. Different workload, different rule.
 *
 * IT RETURNS null RATHER THAN THROWING, ALWAYS. §1: degrade, never error. Every reason this can
 * fail — no key, no model configured, nothing embedded yet, provider down, provider slow, a width
 * that disagrees with what the corpus was embedded at — collapses to "no vector this time", and
 * `searchDocuments` then runs its lexical half alone and says so in the payload. A document search
 * that returns trigram hits is worth far more than one that returns an error, and the caller can
 * see which halves ran.
 *
 * The asymmetry with ingestion matters: chunks are embedded with taskType RETRIEVAL_DOCUMENT and
 * queries with RETRIEVAL_QUERY. Gemini's retrieval embeddings are asymmetric by design — using
 * the document task type for a query measurably degrades recall, and the two are easy to
 * conflate because both are "just embedding some text".
 */

const EMBED_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const EMBED_TIMEOUT_MS = 4000;

export type QueryEmbedding = {
  /** pgvector's text form, which is what `search_documents` casts. */
  embedding: string;
  model: string;
  dim: number;
};

/** Why no vector was produced — surfaced to the model so a thin result is explainable. */
export type EmbeddingUnavailable =
  | "no-api-key"
  | "no-model-configured"
  | "no-corpus-embedding"
  | "dimension-mismatch"
  | "provider-error";

export type EmbedQueryResult =
  | { ok: true; value: QueryEmbedding }
  | { ok: false; reason: EmbeddingUnavailable };

/**
 * The model the corpus was actually embedded with, read from `doc_embedding_model` rather than
 * from configuration. Searching with a different model than the chunks were embedded with returns
 * confident nonsense — the vectors are simply not in the same space — and comparing widths is the
 * cheapest check that catches it. Returns null when nothing has been embedded yet, which is the
 * live state until the pipeline is run with a key.
 */
async function getCorpusModel(): Promise<{ model: string; dim: number } | null> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("doc_embedding_model")
      .select("model, dim")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return { model: data.model, dim: data.dim };
  } catch {
    return null;
  }
}

export async function embedQuery(query: string): Promise<EmbedQueryResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, reason: "no-api-key" };

  // Never a code constant (§1) — the same rule the ingest pipeline follows, for the same reason.
  const configuredModel = process.env.GEMINI_EMBEDDING_MODEL;
  if (!configuredModel) return { ok: false, reason: "no-model-configured" };

  const corpus = await getCorpusModel();
  if (!corpus) return { ok: false, reason: "no-corpus-embedding" };
  if (corpus.model !== configuredModel) {
    // Deliberately not "embed with the corpus model anyway": the environment is the record of
    // what this deployment is configured to call, and quietly calling something else would make
    // a later model migration impossible to reason about.
    return { ok: false, reason: "dimension-mismatch" };
  }

  const body: Record<string, unknown> = {
    model: `models/${configuredModel}`,
    content: { parts: [{ text: query }] },
    taskType: "RETRIEVAL_QUERY",
  };
  // Only sent when the corpus was embedded at a reduced width; asking for the model's native
  // width is what omitting it means.
  const requestedDim = process.env.GEMINI_EMBEDDING_DIM;
  if (requestedDim) body.outputDimensionality = Number(requestedDim);

  try {
    const response = await fetch(`${EMBED_ENDPOINT}/${configuredModel}:embedContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: "provider-error" };

    const payload = (await response.json()) as { embedding?: { values?: number[] } };
    const values = payload.embedding?.values;
    if (!Array.isArray(values) || values.length === 0) return { ok: false, reason: "provider-error" };
    if (values.length !== corpus.dim) return { ok: false, reason: "dimension-mismatch" };

    // L2-normalise, matching what the ingest pipeline stored. Cosine distance is scale-invariant
    // so this is not strictly required, but keeping both sides identical means a future switch to
    // inner product is a one-line change rather than a silent correctness bug.
    const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
    const unit = norm > 0 ? values.map((v) => v / norm) : values;

    return {
      ok: true,
      value: { embedding: `[${unit.join(",")}]`, model: configuredModel, dim: values.length },
    };
  } catch {
    return { ok: false, reason: "provider-error" };
  }
}

/** How a missing vector is explained in the tool payload, in the model's own terms. */
export const EMBEDDING_UNAVAILABLE_NOTE: Record<EmbeddingUnavailable, string> = {
  "no-api-key":
    "Vector search is off (no embedding provider key configured); these results are keyword matches only.",
  "no-model-configured":
    "Vector search is off (no embedding model configured); these results are keyword matches only.",
  "no-corpus-embedding":
    "Vector search is unavailable because the document corpus has not been embedded yet; these results are keyword matches only. Expect good matches on exact codes, titles and phrases, and poor ones on paraphrases.",
  "dimension-mismatch":
    "Vector search is unavailable because the configured embedding model does not match the one the corpus was embedded with; these results are keyword matches only.",
  "provider-error":
    "Vector search was unavailable for this query (the embedding provider did not respond); these results are keyword matches only.",
};
