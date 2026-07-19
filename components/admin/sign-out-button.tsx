"use client";

import { useRouter } from "next/navigation";
import { createSupabaseAuthBrowserClient } from "@/lib/db/supabase-auth-browser";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createSupabaseAuthBrowserClient();
    await supabase.auth.signOut();
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface"
    >
      Sign out
    </button>
  );
}
