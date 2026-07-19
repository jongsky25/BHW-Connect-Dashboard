"use server";

import { revalidatePath } from "next/cache";
import { getAdminUser } from "@/lib/db/require-admin";
import { createChangelogEntry } from "@/lib/db/admin";

export async function addChangelogEntry(formData: FormData) {
  const admin = await getAdminUser();
  if (!admin) return;

  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  const body = String(formData.get("body") ?? "").trim().slice(0, 5000);
  if (!title || !body) return;

  await createChangelogEntry(title, body);
  revalidatePath("/admin/changelog");
  revalidatePath("/methodology");
}
