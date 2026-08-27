import "server-only";
import { createSupabaseServiceClient } from "@/lib/db/service-client";
import type { Json } from "@/lib/db/database.types";

/**
 * Write and read layer for the regression list (docs/AI_ASSISTANT_PLAN.md §8, Increment 2.4; §10).
 *
 * §10's point is that the list must *grow from real failures* rather than from an authoring
 * session, so that it tracks whatever sources have actually been loaded. That only works if
 * reporting a failure is one click and never fails loudly — a capture path that throws in front of
 * a reader who was trying to be helpful teaches them not to bother, and the list stops growing.
 * So writes degrade: a failure to record is reported as "not recorded", never as a crash over an
 * answer the reader has already read.
 *
 * Service-role only. These rows quote internal answers about internal data.
 */

export type RegressionCaseInput = {
  question: string;
  conversation: { role: "user" | "assistant"; content: string }[];
  answerGiven: string;
  toolCalls: { name: string; args: Record<string, unknown> }[];
  citations: unknown[];
  provider: string | null;
  note: string | null;
  reportedBy: string;
};

export type RegressionCase = {
  caseId: number;
  question: string;
  answerGiven: string;
  note: string | null;
  provider: string | null;
  status: string;
  source: string;
  toolNames: string[];
  citationCount: number;
  createdAt: string;
};

/** Returns the new case id, or null when the write did not land. Never throws. */
export async function recordRegressionCase(input: RegressionCaseInput): Promise<number | null> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("ai_regression_case")
      .insert({
        question: input.question,
        // These three are jsonb. Everything reaching here arrived as JSON over the wire and was
        // validated by the route's Zod schema, so it *is* JSON — but `unknown` and
        // `Record<string, unknown>` are wider than the generated `Json` type can prove. The cast
        // is confined to this call, and is sound precisely because the route parses before it
        // writes rather than after.
        conversation: input.conversation as unknown as Json,
        answer_given: input.answerGiven,
        tool_calls: input.toolCalls as unknown as Json,
        citations: input.citations as unknown as Json,
        provider: input.provider,
        note: input.note,
        source: "reported",
        reported_by: input.reportedBy,
      })
      .select("case_id")
      .single();

    if (error || !data) return null;
    return data.case_id;
  } catch {
    return null;
  }
}

/**
 * The open cases, newest first — what an admin reads to see whether the list is being used and
 * what is still failing. Degrades to an empty list, matching `lib/db/dataset-registry.ts`.
 */
export async function listOpenRegressionCases(limit = 20): Promise<RegressionCase[]> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("ai_regression_case")
      .select(
        "case_id, question, answer_given, note, provider, status, source, tool_calls, citations, created_at",
      )
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    return data.map((row) => {
      const toolCalls = Array.isArray(row.tool_calls) ? row.tool_calls : [];
      const citations = Array.isArray(row.citations) ? row.citations : [];
      return {
        caseId: row.case_id,
        question: row.question,
        answerGiven: row.answer_given,
        note: row.note,
        provider: row.provider,
        status: row.status,
        source: row.source,
        toolNames: toolCalls
          .map((call) =>
            call && typeof call === "object" && typeof (call as { name?: unknown }).name === "string"
              ? (call as { name: string }).name
              : null,
          )
          .filter((name): name is string => name !== null),
        citationCount: citations.length,
        createdAt: row.created_at,
      };
    });
  } catch {
    return [];
  }
}
