import "server-only";
import { createSupabaseAuthServerClient } from "./supabase-auth-server";
import { createSupabaseServiceClient } from "./service-client";

export type AdminUser = { id: string; email: string | null; role: "admin" | "editor" };

export type AdminAuthResult =
  | { status: "signed_out" }
  | { status: "not_admin"; email: string | null }
  | { status: "ok"; admin: AdminUser };

/**
 * The single admin-access check, used by the `/admin` layout (via `getAdminAuthResult`, which
 * distinguishes "not signed in" from "signed in but not an admin" for the UI) and every admin
 * server action (via `getAdminUser`, which only needs the pass/fail result). Deliberately fails
 * closed: any error — including missing env vars — resolves to "not authorized," never throws
 * and never grants access on a failure. This is the opposite default from the AI features
 * (lib/ai/*), which fail *open* to keep the public site available; an admin-access check failing
 * safe means denying access, not any risk of granting it.
 */
export async function getAdminAuthResult(): Promise<AdminAuthResult> {
  try {
    const auth = await createSupabaseAuthServerClient();
    const {
      data: { user },
    } = await auth.auth.getUser();
    if (!user) return { status: "signed_out" };

    const service = createSupabaseServiceClient();
    const { data } = await service.from("admin_users").select("role").eq("user_id", user.id).maybeSingle();
    if (!data) return { status: "not_admin", email: user.email ?? null };

    return { status: "ok", admin: { id: user.id, email: user.email ?? null, role: data.role } };
  } catch {
    return { status: "signed_out" };
  }
}

export async function getAdminUser(): Promise<AdminUser | null> {
  const result = await getAdminAuthResult();
  return result.status === "ok" ? result.admin : null;
}
