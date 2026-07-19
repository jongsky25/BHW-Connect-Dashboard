import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

/**
 * Server-side Supabase Auth client (anon key + cookie-based session), for `app/admin/*` — reads
 * the signed-in user, if any. Never used for data access beyond auth itself; every admin data
 * read/write goes through `createSupabaseServiceClient()` after the caller has independently
 * confirmed an `admin_users` row exists (`lib/db/require-admin.ts`).
 */
export async function createSupabaseAuthServerClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables.");
  }

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render, which can't set cookies on the response —
          // middleware.ts refreshes the session cookie on every /admin request instead, so this
          // is safe to ignore rather than throw.
        }
      },
    },
  });
}
