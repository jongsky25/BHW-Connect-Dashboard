import "server-only";
import { createSupabaseServiceClient } from "@/lib/db/service-client";

/**
 * Read and write layer for the extraction review queue (docs/AI_ASSISTANT_PLAN.md §8, 3.2).
 *
 * WHAT THE QUEUE IS FOR, AND WHAT IT DELIBERATELY IS NOT FOR. Owner decision 5 gates *extraction*:
 * rows a model proposed land at `status = 'auto'` and are not citable until a person approves
 * them. Lineage edges from 1.5 are exempt and land approved — they are derived from committed
 * files and checkable by opening one, and §8 3.2 says routing them through here "would bury the
 * rows that need judgment among rows that do not". That exemption is not a convention this module
 * has to remember: every read below filters `status = 'auto'`, and 1.5's rows are never at `auto`.
 *
 * THREE ACTIONS, AND THE ONE THAT IS MISSING ON PURPOSE. Approve, reject with a reason, and edit
 * a node's label or summary. There is no *merge*, although 3.1 surfaced two cases that want one
 * (the deck names one programme two ways on two slides). Merging means re-pointing an edge at a
 * different node, and an edge's `evidence_quote` describes the endpoints it was extracted with —
 * re-pointing it would leave a quotation standing behind a fact it does not support, which is the
 * precise failure §7 calls worse than no citation. Rejecting the duplicate is the honest action;
 * re-extracting under a corrected prompt is the honest fix.
 *
 * Service-role only. Reads degrade to empty rather than throwing (`lib/db/doc-chunks.ts`), but
 * writes return their error text: a reviewer who clicks approve and is told nothing has no way to
 * know whether the row was judged, and a silent failure here is how a queue quietly stops working.
 */

export type ReviewStatus = "approved" | "rejected";

export function isReviewStatus(value: unknown): value is ReviewStatus {
  return value === "approved" || value === "rejected";
}

export type PendingNode = {
  nodeId: number;
  key: string;
  kind: string;
  label: string;
  summary: string | null;
  sourceRef: string;
  chunkId: number | null;
  evidence: string | null;
};

export type PendingEdge = {
  edgeId: number;
  srcKey: string;
  relation: string;
  dstKey: string;
  sourceRef: string;
  chunkId: number | null;
  evidence: string | null;
  /** Endpoint keys not yet approved. Non-empty means approving this edge will be refused. */
  blockedBy: string[];
};

export type JudgedRow = {
  kind: "node" | "edge";
  id: number;
  label: string;
  status: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  note: string | null;
};

export type ReviewCounts = {
  pendingNodes: number;
  pendingEdges: number;
  approvedExtracted: number;
  rejectedExtracted: number;
  assertedRows: number;
};

type NodeRow = {
  node_id: number;
  key: string;
  kind: string;
  label: string;
  summary: string | null;
  source_ref: string;
  source_chunk_id: number | null;
  evidence_quote: string | null;
};

export async function listPendingNodes(limit = 200): Promise<PendingNode[]> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("kb_node")
      .select("node_id, key, kind, label, summary, source_ref, source_chunk_id, evidence_quote")
      .eq("status", "auto")
      .order("key")
      .limit(limit);
    if (error || !data) return [];
    return (data as NodeRow[]).map((row) => ({
      nodeId: row.node_id,
      key: row.key,
      kind: row.kind,
      label: row.label,
      summary: row.summary,
      sourceRef: row.source_ref,
      chunkId: row.source_chunk_id,
      evidence: row.evidence_quote,
    }));
  } catch {
    return [];
  }
}

type EdgeRow = {
  edge_id: number;
  relation: string;
  source_ref: string;
  source_chunk_id: number | null;
  evidence_quote: string | null;
  src: { key: string; status: string } | null;
  dst: { key: string; status: string } | null;
};

export async function listPendingEdges(limit = 300): Promise<PendingEdge[]> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("kb_edge")
      .select(
        "edge_id, relation, source_ref, source_chunk_id, evidence_quote, " +
          "src:kb_node!kb_edge_src_node_id_fkey (key, status), " +
          "dst:kb_node!kb_edge_dst_node_id_fkey (key, status)",
      )
      .eq("status", "auto")
      .order("edge_id")
      .limit(limit);
    if (error || !data) return [];
    return (data as unknown as EdgeRow[])
      .filter((row) => row.src && row.dst)
      .map((row) => {
        const src = row.src!;
        const dst = row.dst!;
        return {
          edgeId: row.edge_id,
          srcKey: src.key,
          relation: row.relation,
          dstKey: dst.key,
          sourceRef: row.source_ref,
          chunkId: row.source_chunk_id,
          evidence: row.evidence_quote,
          blockedBy: [src, dst].filter((n) => n.status !== "approved").map((n) => n.key),
        };
      });
  } catch {
    return [];
  }
}

export async function getReviewCounts(): Promise<ReviewCounts> {
  const zero: ReviewCounts = {
    pendingNodes: 0,
    pendingEdges: 0,
    approvedExtracted: 0,
    rejectedExtracted: 0,
    assertedRows: 0,
  };
  try {
    const supabase = createSupabaseServiceClient();
    const head = { count: "exact" as const, head: true };
    const [
      pendingNodes,
      pendingEdges,
      approvedNodes,
      approvedEdges,
      rejectedNodes,
      rejectedEdges,
      assertedNodes,
      assertedEdges,
    ] = await Promise.all([
      supabase.from("kb_node").select("node_id", head).eq("status", "auto"),
      supabase.from("kb_edge").select("edge_id", head).eq("status", "auto"),
      supabase
        .from("kb_node")
        .select("node_id", head)
        .eq("origin", "extracted")
        .eq("status", "approved"),
      supabase
        .from("kb_edge")
        .select("edge_id", head)
        .eq("origin", "extracted")
        .eq("status", "approved"),
      supabase
        .from("kb_node")
        .select("node_id", head)
        .eq("origin", "extracted")
        .eq("status", "rejected"),
      supabase
        .from("kb_edge")
        .select("edge_id", head)
        .eq("origin", "extracted")
        .eq("status", "rejected"),
      supabase.from("kb_node").select("node_id", head).eq("origin", "asserted"),
      supabase.from("kb_edge").select("edge_id", head).eq("origin", "asserted"),
    ]);
    return {
      pendingNodes: pendingNodes.count ?? 0,
      pendingEdges: pendingEdges.count ?? 0,
      approvedExtracted: (approvedNodes.count ?? 0) + (approvedEdges.count ?? 0),
      rejectedExtracted: (rejectedNodes.count ?? 0) + (rejectedEdges.count ?? 0),
      assertedRows: (assertedNodes.count ?? 0) + (assertedEdges.count ?? 0),
    };
  } catch {
    return zero;
  }
}

/**
 * Judging a row. Returns null on success and the database's own message otherwise — a reviewer who
 * clicks approve and is told nothing has no way to know whether the row was judged.
 *
 * Both writes are scoped `.eq("status", "auto")`, so a second click on a stale page cannot
 * re-decide something another reviewer already settled.
 *
 * The two are written out rather than shared through one table-generic helper: the generated
 * `Update` types for the two tables intersect to `never`, and casting past that would give up the
 * one check that would catch a column renamed under this file.
 */
function reviewFields(status: ReviewStatus, reviewer: string, note: string | null) {
  const now = new Date().toISOString();
  return { status, reviewed_at: now, reviewed_by: reviewer, review_note: note, updated_at: now };
}

export async function judgeKbNode(
  nodeId: number,
  status: ReviewStatus,
  reviewer: string,
  note: string | null,
): Promise<string | null> {
  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase
      .from("kb_node")
      .update(reviewFields(status, reviewer, note))
      .eq("node_id", nodeId)
      .eq("status", "auto");
    return error ? error.message : null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : "the update did not complete";
  }
}

export async function judgeKbEdge(
  edgeId: number,
  status: ReviewStatus,
  reviewer: string,
  note: string | null,
): Promise<string | null> {
  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase
      .from("kb_edge")
      .update(reviewFields(status, reviewer, note))
      .eq("edge_id", edgeId)
      .eq("status", "auto");
    return error ? error.message : null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : "the update did not complete";
  }
}

/** Editing is presentational only: the label and the summary a reader sees, never the key, the
 * relation, or the evidence. Changing any of those would change what the slide was taken to say
 * while leaving the quotation that backs it untouched. */
export async function editKbNode(
  nodeId: number,
  label: string,
  summary: string | null,
): Promise<string | null> {
  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase
      .from("kb_node")
      .update({ label, summary, updated_at: new Date().toISOString() })
      .eq("node_id", nodeId)
      .eq("status", "auto");
    return error ? error.message : null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : "the update did not complete";
  }
}

/**
 * The last rows judged, so an approval is not a one-way door and so the reviewer is visible.
 *
 * §7's argument against reviewing answers is that unbounded review "gets done for a fortnight and
 * then rubber-stamped — which is worse than no review, because a checkmark then implies someone
 * looked". A queue that shows only what is left to do hides the record of who did the rest. This
 * section is that record, and the button beside each row is what makes a wrong approval fixable by
 * the next person rather than only by SQL.
 */
export async function listRecentlyJudged(limit = 12): Promise<JudgedRow[]> {
  try {
    const supabase = createSupabaseServiceClient();
    const [nodes, edges] = await Promise.all([
      supabase
        .from("kb_node")
        .select("node_id, key, status, reviewed_at, reviewed_by, review_note")
        .eq("origin", "extracted")
        .in("status", ["approved", "rejected"])
        .order("reviewed_at", { ascending: false, nullsFirst: false })
        .limit(limit),
      supabase
        .from("kb_edge")
        .select(
          "edge_id, relation, status, reviewed_at, reviewed_by, review_note, " +
            "src:kb_node!kb_edge_src_node_id_fkey (key), dst:kb_node!kb_edge_dst_node_id_fkey (key)",
        )
        .eq("origin", "extracted")
        .in("status", ["approved", "rejected"])
        .order("reviewed_at", { ascending: false, nullsFirst: false })
        .limit(limit),
    ]);

    const rows: JudgedRow[] = [];
    for (const row of nodes.data ?? []) {
      rows.push({
        kind: "node",
        id: row.node_id,
        label: row.key,
        status: row.status,
        reviewedAt: row.reviewed_at,
        reviewedBy: row.reviewed_by,
        note: row.review_note,
      });
    }
    for (const row of (edges.data ?? []) as unknown as {
      edge_id: number;
      relation: string;
      status: string;
      reviewed_at: string | null;
      reviewed_by: string | null;
      review_note: string | null;
      src: { key: string } | null;
      dst: { key: string } | null;
    }[]) {
      rows.push({
        kind: "edge",
        id: row.edge_id,
        label: `${row.src?.key ?? "?"} —${row.relation}→ ${row.dst?.key ?? "?"}`,
        status: row.status,
        reviewedAt: row.reviewed_at,
        reviewedBy: row.reviewed_by,
        note: row.review_note,
      });
    }
    return rows
      .sort((a, b) => (b.reviewedAt ?? "").localeCompare(a.reviewedAt ?? ""))
      .slice(0, limit);
  } catch {
    return [];
  }
}

const REOPENED = {
  status: "auto" as const,
  reviewed_at: null,
  reviewed_by: null,
  review_note: null,
};

/**
 * Returns a node to the queue — and its approved edges with it.
 *
 * Not a convenience: `kb_node_keeps_its_approved_edges()` refuses to un-approve a node that still
 * has an approved edge, because an approved edge with an unapproved endpoint is approved and
 * invisible to the traversal. Sending the edges back first is both what the database requires and
 * what the reviewer means — if the entity is under question again, so is every claim about it.
 */
export async function reopenKbNode(nodeId: number): Promise<string | null> {
  try {
    const supabase = createSupabaseServiceClient();
    const now = new Date().toISOString();
    const { error: edgeError } = await supabase
      .from("kb_edge")
      .update({ ...REOPENED, updated_at: now })
      .eq("origin", "extracted")
      .or(`src_node_id.eq.${nodeId},dst_node_id.eq.${nodeId}`)
      .in("status", ["approved", "rejected"]);
    if (edgeError) return edgeError.message;

    const { error } = await supabase
      .from("kb_node")
      .update({ ...REOPENED, updated_at: now })
      .eq("node_id", nodeId)
      .eq("origin", "extracted");
    return error ? error.message : null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : "the update did not complete";
  }
}

export async function reopenKbEdge(edgeId: number): Promise<string | null> {
  try {
    const supabase = createSupabaseServiceClient();
    const { error } = await supabase
      .from("kb_edge")
      .update({ ...REOPENED, updated_at: new Date().toISOString() })
      .eq("edge_id", edgeId)
      .eq("origin", "extracted");
    return error ? error.message : null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : "the update did not complete";
  }
}
