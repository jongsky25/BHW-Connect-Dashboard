import Link from "next/link";
import { notFound } from "next/navigation";
import { getDocChunk } from "@/lib/db/doc-chunks";

/**
 * Where a citation resolves to (docs/AI_ASSISTANT_PLAN.md §8, Increment 2.3).
 *
 * "Clickable through to the stored chunk" is not a convenience link. §7 makes citation accuracy a
 * correctness requirement because for a prose claim the citation is the only check — and a check
 * nobody can perform is not a check. This page is where a reader performs it: it re-reads the
 * chunk **from the database by id**, rather than re-rendering what the stream already sent, so
 * what is shown is the stored text itself and not the assistant's copy of it. If the two ever
 * disagreed, this is the page that would reveal it.
 *
 * It also shows the offsets 2.1 asserted at ingest (`char_end - char_start = length(content)`,
 * enforced by a check constraint), which are what make the quotation resolvable back to a position
 * in the source PDF rather than merely plausible.
 *
 * Admin-gated by the `(dashboard)` layout, and reads a service-role-only table holding internal
 * budget material (§12.5) — the same boundary the assistant itself sits behind.
 */
export default async function AssistantSourcePage({
  params,
}: {
  params: Promise<{ chunkId: string }>;
}) {
  const { chunkId } = await params;
  const id = Number(chunkId);
  if (!Number.isInteger(id) || id < 1) notFound();

  const chunk = await getDocChunk(id);
  if (!chunk) notFound();

  const pageLabel =
    chunk.pageTo > chunk.pageFrom ? `Slides ${chunk.pageFrom}–${chunk.pageTo}` : `Slide ${chunk.pageFrom}`;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/admin/assistant" className="text-xs text-muted hover:underline">
          ← Back to the assistant
        </Link>
        <h2 className="mt-2 text-lg font-semibold">
          {chunk.documentTitle} — {pageLabel.toLowerCase()}
        </h2>
        {chunk.heading && <p className="text-sm text-muted">{chunk.heading}</p>}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-border p-4 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-muted">Document</dt>
          <dd className="font-mono">{chunk.document}</dd>
        </div>
        <div>
          <dt className="text-muted">As of</dt>
          <dd>{chunk.asOf ?? "not stated"}</dd>
        </div>
        <div>
          <dt className="text-muted">Chunk</dt>
          <dd className="font-mono">#{chunk.chunkId}</dd>
        </div>
        <div>
          <dt className="text-muted">Characters</dt>
          <dd className="font-mono">
            {chunk.charStart.toLocaleString()}–{chunk.charEnd.toLocaleString()}
          </dd>
        </div>
      </dl>

      <div>
        <h3 className="mb-2 text-sm font-medium">Stored text, verbatim</h3>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-surface p-4 text-xs leading-relaxed">
          {chunk.content}
        </pre>
        <p className="mt-2 text-xs text-muted">
          Read from <span className="font-mono">doc_chunk</span> by id just now — not the copy the
          answer was built from. A quotation that does not appear above did not come from this
          slide.
        </p>
      </div>

      <p className="text-xs text-muted">
        Extracted by <span className="font-mono">{chunk.extractor}</span> from{" "}
        <span className="font-mono">{chunk.sourcePath}</span>. Slide numbering is the PDF&apos;s, which
        is what the plan cites by; the deck&apos;s own printed numbers are absent from most slides and
        offset from the PDF page by a varying amount.
      </p>
    </div>
  );
}
