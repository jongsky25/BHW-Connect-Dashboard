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
  /**
   * Null on a seeded case. §10.1's seeds are figures already rendered on a page, not answers
   * anyone was given — there is no assistant turn, and inventing one to satisfy a NOT NULL is what
   * the migration's `ai_regression_case_answer_pairing` constraint now prevents.
   */
  answerGiven: string | null;
  note: string | null;
  provider: string | null;
  status: string;
  source: string;
  toolNames: string[];
  citationCount: number;
  /** How many figures this case pins. Zero for a case filed before §10's expected payload. */
  expectationCount: number;
  createdAt: string;
};

/**
 * One assertion about a payload a recorded tool call returns (§10's expected payload).
 *
 * §10 has recorded since 2.4 that "a `queryDataset` case is scored on whether the call still runs
 * and not on whether it returns the same figure". This is the thing that was missing, and its
 * shape is the design: not a stored payload (row order and an added column would both report a
 * regression that is not one) and not a single named figure (a page usually renders several — "
 * 12,605 of 18,891 (66.72%)" — and pinning one lets the other two drift), but a list, each element
 * scored on its own so a failure names *which* figure moved.
 *
 * `call` is an index into the case's `tool_calls`; `tool` is the name that index must have, so an
 * edited `tool_calls` cannot silently shift an assertion onto a different call. `where` selects one
 * row of the payload's `rows` array and must match exactly one — see `evaluateExpectation`, where
 * ambiguity is a failure rather than a first-row pick. Absent, the field is read off the payload
 * root, which is how a `mode: "count"` case reaches `matchingRows`.
 */
export type Expectation = {
  call: number;
  tool: string;
  where: Record<string, ExpectedValue> | null;
  field: string;
  value: ExpectedValue;
};

/** The scalars an assertion can carry. The migration's check constraint enforces the same set. */
export type ExpectedValue = string | number | boolean;

/**
 * A case with everything a replay needs, as against the summary the assistant page renders.
 *
 * The two readers are separate on purpose. `listOpenRegressionCases` returns tool *names* and a
 * citation *count* — enough to see the list growing, which is what that surface is for. A replay
 * needs the arguments and the cited passages themselves, and loading those for a page that only
 * counts them would pull the whole answer history into a render nobody asked for.
 */
export type ReplayableCase = {
  caseId: number;
  question: string;
  note: string | null;
  toolCalls: { name: string; args: Record<string, unknown> }[];
  citations: { chunkId: number; page: number; text: string }[];
  /** 'reported' or 'seeded' — what a `note` means differs between them, so the page needs it. */
  source: string;
  expectations: Expectation[];
  /**
   * Stored expectations this reader could not parse, rendered back as JSON.
   *
   * Reported rather than dropped, and that is the whole point of the field. A malformed element
   * silently skipped would remove an assertion while leaving the case green — it would pass having
   * checked less than it claims, which is the failure this column exists to prevent. The migration
   * refuses to store one; this catches a row written before that constraint, or under a later one
   * that relaxes it. An empty array is the normal case.
   */
  malformedExpectations: string[];
};

function isExpectedValue(value: unknown): value is ExpectedValue {
  return typeof value === "string" || typeof value === "boolean" || Number.isFinite(value);
}

/** One stored element → an `Expectation`, or a string saying it could not be read. */
function parseExpectation(raw: unknown): Expectation | { malformed: string } {
  const malformed = { malformed: JSON.stringify(raw) ?? String(raw) };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return malformed;
  const { call, tool, where, field, value } = raw as Record<string, unknown>;
  if (!Number.isInteger(call) || (call as number) < 0) return malformed;
  if (typeof tool !== "string" || tool === "") return malformed;
  if (typeof field !== "string" || field === "") return malformed;
  if (!isExpectedValue(value)) return malformed;

  let selector: Record<string, ExpectedValue> | null = null;
  if (where !== undefined && where !== null) {
    if (typeof where !== "object" || Array.isArray(where)) return malformed;
    selector = {};
    for (const [key, keyValue] of Object.entries(where as Record<string, unknown>)) {
      if (!isExpectedValue(keyValue)) return malformed;
      selector[key] = keyValue;
    }
    // An empty selector would match every row and resolve only on a single-row payload — an
    // accident that looks like a deliberate root read. `where` is omitted for that.
    if (Object.keys(selector).length === 0) return malformed;
  }

  return { call: call as number, tool, where: selector, field, value };
}

/** Splits stored expectations into the ones a replay can score and the ones it must report. */
export function readExpectations(stored: unknown): {
  expectations: Expectation[];
  malformed: string[];
} {
  const expectations: Expectation[] = [];
  const malformed: string[] = [];
  for (const raw of Array.isArray(stored) ? stored : []) {
    const parsed = parseExpectation(raw);
    if ("malformed" in parsed) malformed.push(parsed.malformed);
    else expectations.push(parsed);
  }
  return { expectations, malformed };
}

export async function loadReplayableCases(limit = 20): Promise<ReplayableCase[]> {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("ai_regression_case")
      .select("case_id, question, note, source, tool_calls, citations, expectations")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];

    return data.map((row) => {
      const { expectations, malformed } = readExpectations(row.expectations);
      return {
        caseId: row.case_id,
        question: row.question,
        note: row.note,
        source: row.source,
        toolCalls: (Array.isArray(row.tool_calls) ? row.tool_calls : [])
          .map((call) => {
            if (!call || typeof call !== "object") return null;
            const name = (call as { name?: unknown }).name;
            if (typeof name !== "string") return null;
            const args = (call as { args?: unknown }).args;
            return {
              name,
              args: (args && typeof args === "object" ? args : {}) as Record<string, unknown>,
            };
          })
          .filter((call): call is { name: string; args: Record<string, unknown> } => call !== null),
        // A citation with no chunk id cannot be re-resolved, so it is dropped rather than replayed
        // as a hole: a replay that reports "0 citations checked" is clearer than one reporting a
        // failure the case never actually made.
        citations: (Array.isArray(row.citations) ? row.citations : [])
          .map((cite) => {
            if (!cite || typeof cite !== "object") return null;
            const { chunkId, page, text } = cite as {
              chunkId?: unknown;
              page?: unknown;
              text?: unknown;
            };
            if (typeof chunkId !== "number" || typeof page !== "number") return null;
            return { chunkId, page, text: typeof text === "string" ? text : "" };
          })
          .filter((cite): cite is { chunkId: number; page: number; text: string } => cite !== null),
        expectations,
        malformedExpectations: malformed,
      };
    });
  } catch {
    return [];
  }
}

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
        "case_id, question, answer_given, note, provider, status, source, tool_calls, citations, expectations, created_at",
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
            call &&
            typeof call === "object" &&
            typeof (call as { name?: unknown }).name === "string"
              ? (call as { name: string }).name
              : null,
          )
          .filter((name): name is string => name !== null),
        citationCount: citations.length,
        expectationCount: Array.isArray(row.expectations) ? row.expectations.length : 0,
        createdAt: row.created_at,
      };
    });
  } catch {
    return [];
  }
}
