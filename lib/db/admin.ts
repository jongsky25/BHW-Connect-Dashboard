import "server-only";
import { createSupabaseServiceClient } from "./service-client";

export type FeedbackStatus = "open" | "resolved" | "dismissed";

export type FeedbackRow = {
  id: number;
  createdAt: string;
  pagePath: string;
  category: string;
  message: string;
  email: string | null;
  status: FeedbackStatus;
};

/** Every read here goes through the service-role client — `feedback`/`ingestion_batches`/
 * `ai_provider_quota` are all insert-only or service-role-only to the public (0.3/2.1). */
export async function listFeedback(status?: FeedbackStatus): Promise<FeedbackRow[]> {
  const supabase = createSupabaseServiceClient();
  let query = supabase
    .from("feedback")
    .select("id, created_at, page_path, category, message, email, status")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    pagePath: row.page_path,
    category: row.category,
    message: row.message,
    email: row.email,
    status: row.status,
  }));
}

export async function updateFeedbackStatus(id: number, status: FeedbackStatus): Promise<boolean> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from("feedback").update({ status }).eq("id", id);
  return !error;
}

export type IngestionBatchRow = {
  batchId: number;
  startedAt: string;
  finishedAt: string | null;
  sourceFile: string | null;
  rowCounts: unknown;
  qaReport: unknown;
};

export async function listIngestionBatches(): Promise<IngestionBatchRow[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("ingestion_batches")
    .select("batch_id, started_at, finished_at, source_file, row_counts, qa_report")
    .order("started_at", { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return data.map((row) => ({
    batchId: row.batch_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    sourceFile: row.source_file,
    rowCounts: row.row_counts,
    qaReport: row.qa_report,
  }));
}

export type AiQuotaRow = {
  id: number;
  provider: string;
  windowType: string;
  windowStart: string;
  requestCount: number;
  limitValue: number;
  isPaused: boolean;
  pausedUntil: string | null;
};

export async function listAiProviderQuota(): Promise<AiQuotaRow[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("ai_provider_quota")
    .select("id, provider, window_type, window_start, request_count, limit_value, is_paused, paused_until")
    .order("window_start", { ascending: false })
    .limit(100);
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    provider: row.provider,
    windowType: row.window_type,
    windowStart: row.window_start,
    requestCount: row.request_count,
    limitValue: row.limit_value,
    isPaused: row.is_paused,
    pausedUntil: row.paused_until,
  }));
}

export async function createChangelogEntry(title: string, bodyMd: string): Promise<boolean> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from("changelog_entries").insert({ title, body_md: bodyMd });
  return !error;
}
