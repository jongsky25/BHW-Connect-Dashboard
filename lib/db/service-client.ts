import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Service-role Supabase client — bypasses RLS entirely. Reserved for the handful of tables that
 * are service-role-only by design (`ai_narrative_cache`, `ai_provider_quota`, `admin_users`,
 * `fact_*`, `ingestion_batches`) and for admin reads of insert-only public tables (`feedback`,
 * `usage_events`).
 *
 * One read behind a **public** page uses it, deliberately: D2.5's correction ledger
 * (`/districts/corrections`) over `district_correction`, which is insert-only for the same reason
 * `feedback` is — `submitter_email` sits on the table, so a SELECT policy wide enough to serve the
 * page would serve that column to anyone. The ledger therefore projects the publishable columns
 * server-side (`PUBLIC_CORRECTION_COLUMNS`, asserted by test) rather than relaxing the policy. Read
 * that module before using this client for another public surface: with RLS bypassed, the column
 * list *is* the access control.
 *
 * Never import this from a client component or expose the key to the browser —
 * every caller of this function must itself carry `import "server-only"` (lib/ai/*, app/admin/*,
 * app/api/ai/*, app/api/cron/*).
 */
export function createSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
