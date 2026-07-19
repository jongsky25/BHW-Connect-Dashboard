import { redirect } from "next/navigation";
import { getAdminAuthResult } from "@/lib/db/require-admin";
import { AdminNav } from "@/components/admin/admin-nav";
import { SignOutButton } from "@/components/admin/sign-out-button";

/**
 * Gates every `/admin/*` page except `/admin/login` (a sibling route outside this route group).
 * `proxy.ts` already redirects a fully unauthenticated visitor to `/admin/login`; this is the
 * actual security boundary — it re-checks from scratch (BUILD_PLAN.md §8 2.5's Verify: "non-admin
 * authenticated user is denied") rather than trusting anything proxy.ts decided.
 *
 * Forced dynamic: every page under here reads the caller's auth cookie and does a service-role
 * DB read scoped to that specific request — none of it is safe or meaningful to statically
 * prerender or cache. Without this, `next build` attempts to prerender leaf pages like
 * `/admin/ai-quota` at build time (no per-request cookie exists then), which fails outright in
 * any build environment that doesn't also have `SUPABASE_SERVICE_ROLE_KEY` set — caught by
 * actually running `next build` locally, not by lint/typecheck/tests.
 */
export const dynamic = "force-dynamic";

export default async function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  const authResult = await getAdminAuthResult();
  if (authResult.status === "signed_out") redirect("/admin/login");
  if (authResult.status === "not_admin") {
    return (
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center">
        <h1 className="text-lg font-semibold">Not authorized</h1>
        <p className="text-sm text-muted">
          {authResult.email ?? "This account"} doesn&apos;t have admin access to BHW Connect.
        </p>
        <SignOutButton />
      </div>
    );
  }

  const admin = authResult.admin;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">BHW Connect admin</h1>
          <p className="text-xs text-muted">
            Signed in as {admin.email ?? admin.id} ({admin.role})
          </p>
        </div>
        <SignOutButton />
      </div>

      <div className="flex flex-col gap-6 sm:flex-row">
        <AdminNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
