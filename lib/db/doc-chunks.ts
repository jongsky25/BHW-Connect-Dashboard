import "server-only";
import { createSupabaseServiceClient } from "@/lib/db/service-client";

/**
 * Read layer for the document corpus (docs/AI_ASSISTANT_PLAN.md §8, Increments 2.1 and 2.3).
 *
 * Service-role only, and deliberately so: `doc_chunk` and `doc_source` hold internal budget
 * material whose own slide 26 records the BHW Connect site under system hold (§12.5). Every caller
 * must itself be admin-gated — today that is the citation click-through page and nothing else.
 *
 * Reads degrade to null rather than throwing, matching `lib/db/dataset-registry.ts`: a citation
 * that cannot be resolved should render as "not found", never as a stack trace on an admin page.
 */

export type DocChunk = {
  chunkId: number;
  document: string;
  documentTitle: string;
  asOf: string | null;
  sourcePath: string;
  extractor: string;
  pageFrom: number;
  pageTo: number;
  charStart: number;
  charEnd: number;
  heading: string | null;
  content: string;
};

export async function getDocChunk(chunkId: number): Promise<DocChunk | null> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("doc_chunk")
      .select(
        "chunk_id, page_from, page_to, char_start, char_end, heading, content, doc_source (key, title, as_of, source_path, extractor)",
      )
      .eq("chunk_id", chunkId)
      .maybeSingle();

    if (error || !data) return null;
    // PostgREST types an embedded one-to-one as an object here; the FK guarantees it exists.
    const source = data.doc_source as unknown as {
      key: string;
      title: string;
      as_of: string | null;
      source_path: string;
      extractor: string;
    } | null;
    if (!source) return null;

    return {
      chunkId: data.chunk_id,
      document: source.key,
      documentTitle: source.title,
      asOf: source.as_of,
      sourcePath: source.source_path,
      extractor: source.extractor,
      pageFrom: data.page_from,
      pageTo: data.page_to,
      charStart: data.char_start,
      charEnd: data.char_end,
      heading: data.heading,
      content: data.content,
    };
  } catch {
    return null;
  }
}
