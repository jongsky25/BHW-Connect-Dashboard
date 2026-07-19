"use server";

import { revalidatePath } from "next/cache";
import { getAdminUser } from "@/lib/db/require-admin";
import { updateFeedbackStatus, type FeedbackStatus } from "@/lib/db/admin";

const VALID_STATUSES: FeedbackStatus[] = ["open", "resolved", "dismissed"];

function isFeedbackStatus(value: FormDataEntryValue | null): value is FeedbackStatus {
  return typeof value === "string" && (VALID_STATUSES as string[]).includes(value);
}

/** Re-checks admin access itself — never trust that a request reached this action legitimately
 * just because it's wired to a form on an admin page. */
export async function setFeedbackStatus(formData: FormData) {
  const admin = await getAdminUser();
  if (!admin) return;

  const id = Number(formData.get("id"));
  const status = formData.get("status");
  if (!Number.isFinite(id) || !isFeedbackStatus(status)) return;

  await updateFeedbackStatus(id, status);
  revalidatePath("/admin/feedback");
  revalidatePath("/admin");
}
