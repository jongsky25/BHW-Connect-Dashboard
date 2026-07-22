import "server-only";
import type { Json } from "@/lib/db/database.types";
import { createSupabaseServiceClient } from "@/lib/db/service-client";

/**
 * Ask-the-Data capture log (docs/ASK_CACHE_PLAN.md §3): append-only record of every chat turn.
 * This is the corpus the answer bank is curated from and the measure of what the cache saves —
 * answers are never served from it. Best-effort like recordChatMessage: a logging failure
 * (including an unconfigured service client) must never block or crash the turn it's logging.
 */

export type AskOutcome = "answered" | "audited_empty" | "capacity" | "error";

export type AskLogEntry = {
  sessionId: string;
  questionRaw: string;
  questionNorm: string;
  geoCode: string | null;
  geoLevel: string | null;
  /** 0 = first question of a conversation (the only cacheable kind), >0 = follow-up. */
  turnIndex: number;
  /** Audited final text; null for capacity/error/audited_empty outcomes. */
  answerMd: string | null;
  outcome: AskOutcome;
  provider: string | null;
  /** 'cache' = exact-match bank hit, 'cache_near' = trigram near-match hit (A4), 'live' = generated. */
  servedFrom: "live" | "cache" | "cache_near";
  dataVersion: string | null;
  toolTrace: { name: string; args: Record<string, unknown> }[];
  latencyMs: number;
};

export async function recordAsk(entry: AskLogEntry): Promise<void> {
  try {
    const supabase = createSupabaseServiceClient();
    await supabase.from("ai_ask_log").insert({
      session_id: entry.sessionId,
      question_raw: entry.questionRaw,
      question_norm: entry.questionNorm,
      geo_code: entry.geoCode,
      geo_level: entry.geoLevel,
      turn_index: entry.turnIndex,
      answer_md: entry.answerMd,
      outcome: entry.outcome,
      provider: entry.provider,
      served_from: entry.servedFrom,
      data_version: entry.dataVersion,
      tool_trace: entry.toolTrace as unknown as Json,
      latency_ms: entry.latencyMs,
    });
  } catch {
    // best-effort
  }
}
