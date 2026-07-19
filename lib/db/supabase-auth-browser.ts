"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

/** Client-side Supabase Auth client — used only by the admin login/sign-out UI. */
export function createSupabaseAuthBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
