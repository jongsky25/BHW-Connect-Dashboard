import Link from "next/link";
import {
  getReviewCounts,
  listPendingEdges,
  listPendingNodes,
  listRecentlyJudged,
  type JudgedRow,
  type PendingEdge,
  type PendingNode,
} from "@/lib/db/kb-review";
import { editNode, judgeEdge, judgeNode, reopenRow } from "./actions";

/**
 * The extraction review queue (docs/AI_ASSISTANT_PLAN.md §8, Increment 3.2).
 *
 * Owner decision 5, in one screen: a model proposed these rows, nothing here is citable, and a
 * person decides. Three things about the layout are load-bearing rather than cosmetic.
 *
 * **The evidence is on the card, not behind a link.** §7's argument for citations applies to a
 * reviewer more than to a reader: the only way to judge "UUC for PHC is defined by AO 2020-0023"
 * is to see the words the claim was taken from. The link to the stored chunk (2.3's page) is there
 * for the fuller context, but a queue that makes you click to see the evidence is a queue that
 * gets approved without it.
 *
 * **Nodes come before edges, and the queue says why.** `traverse_kb` needs both endpoints approved,
 * so an edge approved ahead of its nodes is approved and invisible. The database refuses that; this
 * page shows which endpoints are holding an edge back rather than letting a reviewer discover it
 * as an error.
 *
 * **Asserted rows are not here at all.** §8 3.2: routing 1.5's lineage edges through the queue
 * "would bury the rows that need judgment among rows that do not". The header counts them so their
 * absence reads as a decision rather than an omission.
 */
export default async function AdminKbReviewPage() {
  const [nodes, edges, counts, judged] = await Promise.all([
    listPendingNodes(),
    listPendingEdges(),
    getReviewCounts(),
    listRecentlyJudged(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Knowledge graph review</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Awaiting review"
            value={counts.pendingNodes + counts.pendingEdges}
            hint="not citable"
          />
          <Stat
            label="Approved"
            value={counts.approvedExtracted}
            hint="extracted, now traversable"
          />
          <Stat label="Rejected" value={counts.rejectedExtracted} hint="kept, with a reason" />
          <Stat label="Asserted" value={counts.assertedRows} hint="lineage — never queued" />
        </div>
        <p className="text-xs text-muted">
          These rows were <span className="font-medium">proposed by a model</span> reading the
          document corpus. Nothing here can be cited or traversed until it is approved. Lineage rows
          are derived from committed migrations and ingestion scripts, land approved, and never
          appear in this queue — they are checkable by opening the file they name.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Entities ({nodes.length})</h3>
        <p className="text-xs text-muted">
          Approve these first. An edge cannot be approved while either of its endpoints is
          unapproved.
        </p>
        {nodes.length === 0 ? (
          <p className="text-sm text-muted">Nothing awaiting review.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {nodes.map((node) => (
              <NodeCard key={node.nodeId} node={node} />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Relations ({edges.length})</h3>
        {edges.length === 0 ? (
          <p className="text-sm text-muted">Nothing awaiting review.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {edges.map((edge) => (
              <EdgeCard key={edge.edgeId} edge={edge} />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Recently judged</h3>
        <p className="text-xs text-muted">
          Who decided, when, and why. An approval is not a one-way door: returning a row to the
          queue also returns every claim that depends on it.
        </p>
        {judged.length === 0 ? (
          <p className="text-sm text-muted">Nothing judged yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {judged.map((row) => (
              <JudgedCard key={`${row.kind}-${row.id}`} row={row} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function JudgedCard({ row }: { row: JudgedRow }) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
      <span
        className={
          row.status === "approved"
            ? "rounded-full bg-accent-subtle px-2 py-0.5 text-xs text-accent"
            : "rounded-full bg-surface px-2 py-0.5 text-xs text-danger"
        }
      >
        {row.status}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs">{row.label}</span>
      <span className="text-xs text-muted">
        {row.reviewedBy ?? "unrecorded"}
        {row.reviewedAt ? ` · ${row.reviewedAt.slice(0, 10)}` : ""}
        {row.note ? ` · ${row.note}` : ""}
      </span>
      <form action={reopenRow}>
        <input type="hidden" name="kind" value={row.kind} />
        <input type="hidden" name="rowId" value={row.id} />
        <button
          type="submit"
          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-surface"
        >
          Return to review
        </button>
      </form>
    </li>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value.toLocaleString()}</p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}

/** The quoted span, shown as stored — line breaks and all. Table-heavy slides extract in poor
 * reading order (2.2's finding), and tidying that here would hide from the reviewer exactly the
 * thing they are being asked to judge. */
function Evidence({
  quote,
  chunkId,
  sourceRef,
}: {
  quote: string | null;
  chunkId: number | null;
  sourceRef: string;
}) {
  return (
    <div className="mt-2 rounded-md border border-border bg-surface p-3">
      <p className="text-xs text-muted">
        {sourceRef}
        {chunkId !== null && (
          <>
            {" · "}
            <Link href={`/admin/assistant/source/${chunkId}`} className="hover:underline">
              open the stored slide
            </Link>
          </>
        )}
      </p>
      <pre className="mt-1 whitespace-pre-wrap font-mono text-xs">
        {quote ?? "(no quote — this row should not exist)"}
      </pre>
    </div>
  );
}

function JudgeButtons({
  field,
  id,
  action,
  disabled,
}: {
  field: "nodeId" | "edgeId";
  id: number;
  action: (formData: FormData) => void;
  disabled?: string;
}) {
  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name={field} value={id} />
      <input
        type="text"
        name="note"
        maxLength={500}
        placeholder="Reason (required in spirit for a rejection)"
        className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs"
      />
      <button
        type="submit"
        name="status"
        value="approved"
        disabled={Boolean(disabled)}
        title={disabled}
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Approve
      </button>
      <button
        type="submit"
        name="status"
        value="rejected"
        className="rounded-md border border-border px-3 py-1.5 text-xs text-danger hover:bg-surface"
      >
        Reject
      </button>
    </form>
  );
}

function NodeCard({ node }: { node: PendingNode }) {
  return (
    <li className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-muted">{node.kind}</span>
        <span className="font-mono text-sm">{node.key}</span>
      </div>
      <Evidence quote={node.evidence} chunkId={node.chunkId} sourceRef={node.sourceRef} />
      <form action={editNode} className="mt-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="nodeId" value={node.nodeId} />
        <input
          type="text"
          name="label"
          defaultValue={node.label}
          maxLength={200}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
        <input
          type="text"
          name="summary"
          defaultValue={node.summary ?? ""}
          maxLength={1000}
          placeholder="Summary (optional)"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs"
        />
        <button
          type="submit"
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-surface"
        >
          Save wording
        </button>
      </form>
      <JudgeButtons field="nodeId" id={node.nodeId} action={judgeNode} />
    </li>
  );
}

function EdgeCard({ edge }: { edge: PendingEdge }) {
  const blocked = edge.blockedBy.length
    ? `Approve ${edge.blockedBy.join(" and ")} first — an approved edge with an unapproved endpoint is invisible to the traversal.`
    : undefined;
  return (
    <li className="rounded-lg border border-border p-4">
      <p className="font-mono text-sm">
        {edge.srcKey} <span className="text-accent">—{edge.relation}→</span> {edge.dstKey}
      </p>
      <Evidence quote={edge.evidence} chunkId={edge.chunkId} sourceRef={edge.sourceRef} />
      {blocked && <p className="mt-2 text-xs text-danger">{blocked}</p>}
      <JudgeButtons field="edgeId" id={edge.edgeId} action={judgeEdge} disabled={blocked} />
    </li>
  );
}
