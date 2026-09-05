"use server";

import { revalidatePath } from "next/cache";
import { getAdminUser } from "@/lib/db/require-admin";
import { isDistrictCorrectionDecision, judgeDistrictCorrection } from "@/lib/db/district-corrections";

/**
 * Server action for D2.4's admin review queue, following `kb-review/actions.ts`'s three rules:
 * admin access re-checked here rather than trusted from the page, the reviewer's identity taken
 * from the session never the form, and every id/enum validated before it reaches the DB layer.
 *
 * One difference from `kb-review`: the plan calls `review_note` mandatory here (§5 D2.4), so unlike
 * `kb-review`'s "reason (required in spirit)" placeholder, a blank note is refused rather than
 * merely discouraged.
 */

const MAX_NOTE = 500;
const MAX_NAME = 200;

function id(formData: FormData, field: string): number | null {
  const value = Number(formData.get(field));
  return Number.isInteger(value) && value > 0 ? value : null;
}

export async function judgeCorrection(formData: FormData) {
  const admin = await getAdminUser();
  if (!admin) return;

  const correctionId = id(formData, "correctionId");
  const decision = formData.get("decision");
  const note = String(formData.get("note") ?? "").trim().slice(0, MAX_NOTE);
  if (correctionId === null || !isDistrictCorrectionDecision(decision) || !note) return;

  const newDistrictName =
    String(formData.get("newDistrictName") ?? "")
      .trim()
      .slice(0, MAX_NAME) || null;

  await judgeDistrictCorrection(correctionId, decision, admin.email ?? admin.id, note, newDistrictName);

  revalidatePath("/admin/district-corrections");
  revalidatePath("/districts");
  // A move touches two district pages; every other action leaves one of these hidden fields blank.
  const districtCode = String(formData.get("districtCode") ?? "");
  const toDistrictCode = String(formData.get("toDistrictCode") ?? "");
  if (districtCode) revalidatePath(`/districts/${districtCode}`);
  if (toDistrictCode) revalidatePath(`/districts/${toDistrictCode}`);
}
