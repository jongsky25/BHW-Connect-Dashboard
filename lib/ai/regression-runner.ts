import "server-only";
import { createInternalTools } from "./dataset-tools";
import { getDocChunk } from "@/lib/db/doc-chunks";
import type { Expectation, ExpectedValue, ReplayableCase } from "@/lib/db/regression-cases";

/**
 * The §10 runner: re-executes a stored regression case against the build in front of it and diffs
 * what comes back (docs/AI_ASSISTANT_PLAN.md §10).
 *
 * WHY THIS IS THE THING THAT WAS MISSING. §10 says the list "becomes load-bearing exactly when a
 * change to one path can silently degrade another", and Phase 3 added a fourth retrieval path.
 * Increment 2.4 made a case *replayable* — every input a replay needs is in the row — and its own
 * entry is honest that nothing re-ran them: "the list accumulates evidence without automatically
 * spending it". This spends it.
 *
 * WHAT IT REPLAYS, AND WHAT IT DELIBERATELY DOES NOT. It re-issues the tool calls the case
 * recorded, with the arguments it recorded, and re-resolves every citation the answer leaned on.
 * It does **not** re-ask the question of a model. That half needs a provider key, and splitting
 * them is the same trade 2.1 made between extraction and `--embed`: the deterministic half is free
 * and can run on every build, and tying it to the expensive half would mean it never runs at all.
 *
 * The split is also where the value is. §10's own framing is that "the regressions worth catching
 * are usually in which tools were selected or which page was cited rather than in how the answer
 * reads" — and *which page was cited* is exactly what this can check without a model. A retrieval
 * change that silently stops returning the chunk an answer was built on is invisible in the prose
 * and obvious here.
 *
 * SAFETY. Every tool in `createInternalTools()` reads; none writes. A replay therefore cannot
 * change anything, which is why it is safe to run against production on demand. If a write tool is
 * ever added, this comment stops being true and this module has to gain an allowlist.
 */

export type ToolReplay = {
  name: string;
  args: Record<string, unknown>;
  status: "ok" | "error" | "unknown-tool";
  /** The tool's own message when it refused, so a failure explains itself. */
  detail: string | null;
  /** Chunks this call returned, for the citation check below. Empty for a non-document tool. */
  chunkIds: number[];
};

export type CitationReplay = {
  chunkId: number;
  page: number;
  /** The chunk is still in the corpus. */
  resolves: boolean;
  /** …and still on the page the case recorded. */
  pageUnchanged: boolean;
  /**
   * …and its stored text is byte-identical to what the case quoted — or null when the case
   * recorded no text to compare against. Not the same thing as a mismatch, and reporting it as
   * one would make every hand-seeded case (§10.1) look broken on its first replay.
   */
  textUnchanged: boolean | null;
  /** …and the case's own recorded search still surfaces it. */
  stillRetrieved: boolean;
};

export type ExpectationReplay = Expectation & {
  /**
   * met        — the payload still holds this value at this field.
   * unmet      — the field is there and the figure has changed. The regression route 1 exists for.
   * unresolved — the assertion could not be scored at all: the call did not run, the selector
   *              named no row or more than one, or the field is gone. Not the same as unmet, and
   *              collapsing the two would report a renamed column as a changed figure.
   */
  status: "met" | "unmet" | "unresolved";
  /** What was actually there, when a single value could be reached. Null otherwise. */
  actual: ExpectedValue | null;
  /** Why, in the words the finding uses. Null when met. */
  reason: string | null;
};

export type CaseReplay = {
  caseId: number;
  question: string;
  /**
   * broken   — something the case did no longer runs, a cited chunk is gone, or a figure the case
   *            pinned has changed or can no longer be found.
   * degraded — everything runs, but a citation moved, changed text, or dropped out of its search.
   * ok       — every recorded call ran, every citation still resolves and is still retrieved, and
   *            every pinned figure is unchanged.
   *
   * A moved figure is `broken` rather than `degraded` deliberately. It is the only check in this
   * runner that scores an answer's *content* rather than its plumbing, and grading it below a
   * citation changing pages would put the thing route 1 was seeded to catch in the quieter colour.
   */
  verdict: "ok" | "degraded" | "broken";
  findings: string[];
  toolCalls: ToolReplay[];
  citations: CitationReplay[];
  expectations: ExpectationReplay[];
  /**
   * Stored expectations this build could not read, counted rather than inferred from the finding
   * text. A caller deciding whether a run *checked* what it claims to needs this apart from the
   * findings list, and matching on a sentence is the string-scan mistake this repository has now
   * made four times (see `DECISIONS.md`, 2026-08-28).
   */
  malformedExpectations: number;
};

/** Stated once, in the result, so nobody reads a green run as more than it is. */
export const REPLAY_CAVEAT =
  "Tool calls, cited passages and pinned figures only. The answer text was not regenerated — that needs a provider key, and a case can pass here while reading badly.";

function chunkIdsIn(payload: unknown): number[] {
  if (!payload || typeof payload !== "object") return [];
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  return results
    .map((row) =>
      row && typeof row === "object" && typeof (row as { chunkId?: unknown }).chunkId === "number"
        ? (row as { chunkId: number }).chunkId
        : null,
    )
    .filter((id): id is number => id !== null);
}

/** Comma-grouped for a number, quoted for a string, so a finding reads like the page does. */
function describeValue(value: ExpectedValue): string {
  if (typeof value === "number") return new Intl.NumberFormat("en-US").format(value);
  if (typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** `{geo_code: "PH", cert_type: "tesda_certified"}` → `geo_code=PH, cert_type=tesda_certified`. */
function describeSelector(where: Record<string, ExpectedValue>): string {
  return Object.entries(where)
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : String(value)}`)
    .join(", ");
}

function isExpectedValue(value: unknown): value is ExpectedValue {
  return typeof value === "string" || typeof value === "boolean" || Number.isFinite(value);
}

/** What a payload holds where the expectation points, or why it could not be reached. */
function selectTarget(
  payload: unknown,
  from: string | null,
  where: Record<string, ExpectedValue> | null,
): { row: Record<string, unknown> } | { reason: string } {
  if (!payload || typeof payload !== "object") return { reason: "the call returned no payload" };
  if (where === null) return { row: payload as Record<string, unknown> };

  // `rows` when the assertion does not say otherwise, which is every case route 1 seeded. A named
  // list is how §10.1 route 3 reaches the arrays `getIndicatorByGeo` returns alongside its root
  // counts — `demographics`, `training`, `honorarium` — where most harvested answers' actual
  // subject lives.
  const list = from ?? "rows";
  const rows = (payload as Record<string, unknown>)[list];
  if (!Array.isArray(rows))
    return {
      reason:
        from === null
          ? "the payload has no rows to select from (a count payload has no `where`)"
          : `the payload has no ${list} array to select from`,
    };

  const candidates = rows.filter(
    (row): row is Record<string, unknown> =>
      !!row &&
      typeof row === "object" &&
      Object.entries(where).every(
        ([key, value]) => (row as Record<string, unknown>)[key] === value,
      ),
  );
  if (candidates.length === 1) return { row: candidates[0] };

  const selector = describeSelector(where);
  if (candidates.length === 0) {
    // A projection that dropped the selector's own key fails the same way as a row that is gone,
    // and the two are worth telling apart: the first is a broken case, the second a real finding.
    const missing = Object.keys(where).filter(
      (key) => !rows.some((row) => !!row && typeof row === "object" && key in row),
    );
    return {
      reason: missing.length
        ? `no row matched ${selector} — no row carries ${missing.join(", ")}`
        : `no row matched ${selector} (${rows.length} rows returned)`,
    };
  }
  // Never the first row. A selector that names more than one thing has stopped identifying
  // anything, and scoring one of them at random is how a case passes for the wrong reason. The
  // live shape of this is a republication: a second dataset_id doubles every geography's rows.
  return { reason: `${candidates.length} rows matched ${selector} — a selector must name one` };
}

/**
 * Scores one assertion against the payloads this replay collected.
 *
 * Exported because it is the whole of the new judgement and the only part of this module testable
 * without a service-role client: everything else needs the registry, and the registry is
 * service-role only.
 */
export function evaluateExpectation(
  expectation: Expectation,
  calls: { name: string; payload: unknown }[],
): ExpectationReplay {
  const base = { ...expectation, actual: null };
  const unresolved = (reason: string): ExpectationReplay => ({
    ...base,
    status: "unresolved",
    reason,
  });

  const call = calls[expectation.call];
  if (!call)
    return unresolved(
      `call ${expectation.call} was not made (the case records ${calls.length} tool ${calls.length === 1 ? "call" : "calls"})`,
    );
  if (call.name !== expectation.tool)
    return unresolved(
      `call ${expectation.call} is ${call.name}, but this expectation is about ${expectation.tool}`,
    );
  if (
    call.payload &&
    typeof call.payload === "object" &&
    typeof (call.payload as { error?: unknown }).error === "string"
  )
    return unresolved(`${call.name} refused, so there is no figure to compare`);

  const target = selectTarget(call.payload, expectation.from, expectation.where);
  if ("reason" in target) return unresolved(target.reason);

  if (!(expectation.field in target.row)) {
    const available = Object.keys(target.row);
    return unresolved(
      `no field ${expectation.field}` +
        (available.length ? ` (the row has: ${available.slice(0, 25).join(", ")})` : ""),
    );
  }
  const actual = target.row[expectation.field];
  if (!isExpectedValue(actual))
    return unresolved(
      `${expectation.field} is ${actual === null ? "null" : typeof actual}, not a value`,
    );

  if (actual === expectation.value) return { ...expectation, status: "met", actual, reason: null };

  // The type is named on a mismatch on purpose. Values are compared strictly, because every
  // numeric column these cases read was measured to arrive as a JSON number — so if a string ever
  // does turn up against a number, this finding is the evidence for adding a coercion rule rather
  // than the rule being written on a guess. See the migration header.
  const typed =
    typeof actual === typeof expectation.value
      ? ""
      : ` (${typeof expectation.value} → ${typeof actual})`;
  const list = expectation.from ? `${expectation.from} ` : "";
  const at = expectation.where ? `${list}${describeSelector(expectation.where)}: ` : "";
  return {
    ...expectation,
    status: "unmet",
    actual,
    reason: `${at}${expectation.field} was ${describeValue(expectation.value)}, now ${describeValue(actual)}${typed}`,
  };
}

export async function replayCase(stored: ReplayableCase): Promise<CaseReplay> {
  const tools = new Map(createInternalTools().map((tool) => [tool.definition.name, tool]));
  const findings: string[] = [];
  const toolCalls: ToolReplay[] = [];
  // Index-aligned with `stored.toolCalls`, including the calls that failed — an expectation names
  // its call by index, so a skipped entry would shift every later assertion onto the wrong call.
  // Kept local: returning whole payloads would put internal rows into a rendered page.
  const payloads: { name: string; payload: unknown }[] = [];
  const retrieved = new Set<number>();

  for (const call of stored.toolCalls) {
    const tool = tools.get(call.name);
    if (!tool) {
      // A tool the case used that this build does not have is not a degradation, it is a case that
      // can no longer be replayed at all — and a renamed tool is exactly how that happens quietly.
      toolCalls.push({
        name: call.name,
        args: call.args,
        status: "unknown-tool",
        detail: null,
        chunkIds: [],
      });
      payloads.push({ name: call.name, payload: undefined });
      findings.push(`${call.name} is not a tool in this build`);
      continue;
    }
    let payload: unknown;
    try {
      payload = await tool.execute(call.args);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "the call threw";
      toolCalls.push({ name: call.name, args: call.args, status: "error", detail, chunkIds: [] });
      payloads.push({ name: call.name, payload: undefined });
      findings.push(`${call.name} threw: ${detail}`);
      continue;
    }
    // Every tool in this set returns a refusal as data rather than throwing, so an `error` key is
    // the normal failure shape and has to be read as one.
    const error =
      payload &&
      typeof payload === "object" &&
      typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : null;
    const chunkIds = chunkIdsIn(payload);
    for (const id of chunkIds) retrieved.add(id);
    toolCalls.push({
      name: call.name,
      args: call.args,
      status: error ? "error" : "ok",
      detail: error,
      chunkIds,
    });
    payloads.push({ name: call.name, payload });
    if (error) findings.push(`${call.name} refused: ${error}`);
  }

  const citations: CitationReplay[] = [];
  for (const cited of stored.citations) {
    const chunk = await getDocChunk(cited.chunkId);
    const resolves = chunk !== null;
    const pageUnchanged = resolves && chunk.pageFrom === cited.page;
    // An empty stored text means the case never captured one — a seeded case, or one filed before
    // citations carried their passage. Checking it would invent a failure the case never made.
    const textUnchanged = cited.text ? resolves && chunk.content === cited.text : null;
    const stillRetrieved = retrieved.has(cited.chunkId);
    citations.push({
      chunkId: cited.chunkId,
      page: cited.page,
      resolves,
      pageUnchanged,
      textUnchanged,
      stillRetrieved,
    });
    if (!resolves)
      findings.push(`chunk ${cited.chunkId} (slide ${cited.page}) is no longer in the corpus`);
    else if (!pageUnchanged)
      findings.push(`chunk ${cited.chunkId} was slide ${cited.page}, now slide ${chunk.pageFrom}`);
    else if (textUnchanged === false)
      findings.push(
        `chunk ${cited.chunkId} (slide ${cited.page}) has different text than the case quoted`,
      );
    if (resolves && !stillRetrieved && stored.toolCalls.length > 0) {
      findings.push(`slide ${cited.page} is no longer returned by the search this answer used`);
    }
  }

  const expectations = stored.expectations.map((expectation) =>
    evaluateExpectation(expectation, payloads),
  );
  for (const scored of expectations) {
    if (scored.reason) findings.push(`${scored.tool}[${scored.call}] ${scored.reason}`);
  }
  // Reported, never skipped: an assertion this build could not read is one the case is no longer
  // checking, and a case that quietly checks less than it claims is the failure mode the whole
  // expected-payload design is arranged against.
  for (const raw of stored.malformedExpectations) {
    findings.push(`an expectation could not be read and was not checked: ${raw}`);
  }

  const broken =
    toolCalls.some((call) => call.status !== "ok") ||
    citations.some((cite) => !cite.resolves) ||
    expectations.some((scored) => scored.status !== "met") ||
    stored.malformedExpectations.length > 0;
  const degraded = citations.some(
    (cite) => !cite.pageUnchanged || cite.textUnchanged === false || !cite.stillRetrieved,
  );

  return {
    caseId: stored.caseId,
    question: stored.question,
    verdict: broken ? "broken" : degraded ? "degraded" : "ok",
    findings,
    toolCalls,
    citations,
    expectations,
    malformedExpectations: stored.malformedExpectations.length,
  };
}

export type SuiteReplay = {
  ran: number;
  /**
   * Cases handed to the suite that it did not reach before its deadline.
   *
   * Reported, never silently dropped, for the reason `malformedExpectations` is: a run that
   * replayed twelve of eighteen cases has not established anything about the other six, and a
   * summary that counted only what it looked at would say the list is green when a third of it
   * was never opened. Always 0 when no deadline was given.
   */
  skipped: number;
  ok: number;
  degraded: number;
  broken: number;
  caveat: string;
  cases: CaseReplay[];
};

/** Sequential on purpose: a replay is a diagnostic, not a page render, and firing twenty
 * concurrent tool loops at the database to save a few seconds is how a diagnostic becomes an
 * outage (guardrail 4's reasoning).
 *
 * `deadlineAt` is an epoch-millisecond wall clock, checked between cases and never inside one — a
 * half-replayed case would be scored on the calls that happened to finish, which is worse than not
 * replaying it. The first case always runs: a suite that yields before doing anything reports
 * nothing at all, and the caller cannot tell that from an empty list. Omitted, nothing yields, and
 * `/admin/regressions` behaves exactly as it did. */
export async function replaySuite(
  cases: ReplayableCase[],
  options: { deadlineAt?: number } = {},
): Promise<SuiteReplay> {
  const replays: CaseReplay[] = [];
  for (const stored of cases) {
    if (replays.length > 0 && options.deadlineAt !== undefined && Date.now() > options.deadlineAt)
      break;
    replays.push(await replayCase(stored));
  }
  return {
    ran: replays.length,
    skipped: cases.length - replays.length,
    ok: replays.filter((r) => r.verdict === "ok").length,
    degraded: replays.filter((r) => r.verdict === "degraded").length,
    broken: replays.filter((r) => r.verdict === "broken").length,
    caveat: REPLAY_CAVEAT,
    cases: replays,
  };
}
