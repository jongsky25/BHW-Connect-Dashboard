"use server";

import { revalidatePath } from "next/cache";
import { getAdminUser } from "@/lib/db/require-admin";
import {
  editKbNode,
  isReviewStatus,
  judgeKbEdge,
  judgeKbNode,
  reopenKbEdge,
  reopenKbNode,
} from "@/lib/db/kb-review";

/**
 * Server actions for the extraction review queue (Increment 3.2).
 *
 * Every action re-checks admin access itself, matching `answer-bank/actions.ts` and
 * `feedback/actions.ts`: a form being wired to an admin page is not proof the request reached it
 * legitimately.
 *
 * The reviewer's identity is taken from the admin session, never from the form. A review queue
 * whose "who approved this" field can be set by the request is a queue that records nothing.
 */

const MAX_NOTE = 500;

function note(formData: FormData): string | null {
  const raw = String(formData.get("note") ?? "").trim();
  return raw ? raw.slice(0, MAX_NOTE) : null;
}

function id(formData: FormData, field: string): number | null {
  const value = Number(formData.get(field));
  return Number.isInteger(value) && value > 0 ? value : null;
}

export async function judgeNode(formData: FormData) {
  const admin = await getAdminUser();
  if (!admin) return;

  const nodeId = id(formData, "nodeId");
  const status = formData.get("status");
  if (nodeId === null || !isReviewStatus(status)) return;

  await judgeKbNode(nodeId, status, admin.email ?? admin.id, note(formData));
  revalidatePath("/admin/kb-review");
}

export async function judgeEdge(formData: FormData) {
  const admin = await getAdminUser();
  if (!admin) return;

  const edgeId = id(formData, "edgeId");
  const status = formData.get("status");
  if (edgeId === null || !isReviewStatus(status)) return;

  await judgeKbEdge(edgeId, status, admin.email ?? admin.id, note(formData));
  revalidatePath("/admin/kb-review");
}

export async function editNode(formData: FormData) {
  const admin = await getAdminUser();
  if (!admin) return;

  const nodeId = id(formData, "nodeId");
  const label = String(formData.get("label") ?? "")
    .trim()
    .slice(0, 200);
  const summaryRaw = String(formData.get("summary") ?? "")
    .trim()
    .slice(0, 1000);
  if (nodeId === null || !label) return;

  await editKbNode(nodeId, label, summaryRaw || null);
  revalidatePath("/admin/kb-review");
}

/** Returns a judged row to the queue. Reopening a node reopens its edges too — see
 * `reopenKbNode`; the database refuses to leave an approved edge hanging off an unapproved node. */
export async function reopenRow(formData: FormData) {
  const admin = await getAdminUser();
  if (!admin) return;

  const kind = formData.get("kind");
  const rowId = id(formData, "rowId");
  if (rowId === null) return;

  if (kind === "node") await reopenKbNode(rowId);
  else if (kind === "edge") await reopenKbEdge(rowId);
  else return;

  revalidatePath("/admin/kb-review");
}
