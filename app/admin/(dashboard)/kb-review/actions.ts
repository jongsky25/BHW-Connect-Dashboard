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
import {
  approveAllColumns,
  editDatasetColumnMeaning,
  isReviewStatus as isDatasetReviewStatus,
  judgeDataset,
  judgeDatasetColumn,
} from "@/lib/db/dataset-review";
import {
  isReviewStatus as isContradictionReviewStatus,
  judgeContradiction,
  reopenContradiction,
} from "@/lib/db/contradiction-review";

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

/**
 * The profiled-dataset half of the queue (Increment 4.1).
 *
 * Same three rules as the graph actions above: admin re-checked per call, never trusting that the
 * form was reached through the page; the row id validated as a positive integer; the status
 * validated against the vocabulary rather than passed through. What differs is what approval
 * grants — a queryable table rather than one traversable fact — which is why `exposure` appears in
 * none of them.
 */
export async function judgeDatasetRow(formData: FormData) {
  const admin = await getAdminUser();
  if (!admin) return;

  const registryId = id(formData, "registryId");
  const status = formData.get("status");
  if (registryId === null || !isDatasetReviewStatus(status)) return;

  await judgeDataset(registryId, status);
  revalidatePath("/admin/kb-review");
}

export async function judgeColumnRow(formData: FormData) {
  const admin = await getAdminUser();
  if (!admin) return;

  const columnId = id(formData, "columnId");
  const status = formData.get("status");
  if (columnId === null || !isDatasetReviewStatus(status)) return;

  await judgeDatasetColumn(columnId, status);
  revalidatePath("/admin/kb-review");
}

/** Writing the meaning the profile could not supply — the edit this queue exists for. */
export async function editColumnMeaning(formData: FormData) {
  const admin = await getAdminUser();
  if (!admin) return;

  const columnId = id(formData, "columnId");
  const meaning = String(formData.get("meaning") ?? "")
    .trim()
    .slice(0, 1000);
  const unit = String(formData.get("unit") ?? "")
    .trim()
    .slice(0, 60);
  if (columnId === null || !meaning) return;

  await editDatasetColumnMeaning(columnId, meaning, unit || null);
  revalidatePath("/admin/kb-review");
}

/** Refuses while any column still carries a placeholder meaning — see `approveAllColumns`. */
export async function approveDatasetColumns(formData: FormData) {
  const admin = await getAdminUser();
  if (!admin) return;

  const registryId = id(formData, "registryId");
  if (registryId === null) return;

  await approveAllColumns(registryId);
  revalidatePath("/admin/kb-review");
}

/**
 * The contradiction half of the queue (Increment 4.2).
 *
 * The same three rules again, and one difference worth stating: neither judgement here says which
 * number is right. `approved` means the two figures are about the same measure and an answer must
 * surface both with their dates (§12.4 rule 3); `rejected` means the sweep paired two different
 * quantities. There is deliberately no "correct value" field for a reviewer to fill in — see the
 * header of `lib/db/contradiction-review.ts`.
 */
export async function judgeContradictionRow(formData: FormData) {
  const admin = await getAdminUser();
  if (!admin) return;

  const contradictionId = id(formData, "contradictionId");
  const status = formData.get("status");
  if (contradictionId === null || !isContradictionReviewStatus(status)) return;

  await judgeContradiction(contradictionId, status, admin.email ?? admin.id, note(formData));
  revalidatePath("/admin/kb-review");
}

export async function reopenContradictionRow(formData: FormData) {
  const admin = await getAdminUser();
  if (!admin) return;

  const contradictionId = id(formData, "contradictionId");
  if (contradictionId === null) return;

  await reopenContradiction(contradictionId);
  revalidatePath("/admin/kb-review");
}
