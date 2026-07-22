"use server";

import { revalidatePath } from "next/cache";
import { getAdminUser } from "@/lib/db/require-admin";
import {
  deleteAskBankEntry,
  isAskBankStatus,
  setAskBankStatus,
  updateAskBankAnswer,
} from "@/lib/db/ask-bank";

/** Every action re-checks admin access itself — a form being wired to an admin page is not proof
 * the request reached it legitimately (same discipline as feedback/actions.ts). */

export async function setAskStatus(formData: FormData) {
  const admin = await getAdminUser();
  if (!admin) return;

  const cacheKey = String(formData.get("cacheKey") ?? "");
  const status = formData.get("status");
  if (!cacheKey || !isAskBankStatus(status)) return;

  await setAskBankStatus(cacheKey, status);
  revalidatePath("/admin/answer-bank");
}

export async function editAskAnswer(formData: FormData) {
  const admin = await getAdminUser();
  if (!admin) return;

  const cacheKey = String(formData.get("cacheKey") ?? "");
  const answerMd = String(formData.get("answerMd") ?? "").trim().slice(0, 5000);
  if (!cacheKey || !answerMd) return;

  await updateAskBankAnswer(cacheKey, answerMd);
  revalidatePath("/admin/answer-bank");
}

export async function deleteAskEntry(formData: FormData) {
  const admin = await getAdminUser();
  if (!admin) return;

  const cacheKey = String(formData.get("cacheKey") ?? "");
  if (!cacheKey) return;

  await deleteAskBankEntry(cacheKey);
  revalidatePath("/admin/answer-bank");
}
