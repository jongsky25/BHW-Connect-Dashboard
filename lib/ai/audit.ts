/**
 * Post-hoc numeric audit (BUILD_PLAN.md §4.5, pitfall P13): every number in AI-generated prose
 * must be traceable back to a value actually returned by a tool call this turn. A sentence
 * containing an untraceable number is dropped rather than shown — silently, not surfaced as an
 * error, since the surrounding sentences are usually still a valid, grounded answer on their own.
 *
 * Deliberately pure (no I/O, no "server-only") so it's directly unit-testable, including the
 * adversarial cases required by 2.2's Verify checklist.
 */

/** Numbers allowed in any narrative without being traced to a tool payload — the dataset's fixed
 * snapshot years and the two trivial percentage bounds. Kept tiny and explicit on purpose. */
const ALWAYS_ALLOWED = [0, 100, 2025, 2026];

const NUMBER_TOKEN_RE = /-?\d[\d,]*(?:\.\d+)?%?/g;

function parseToken(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").replace(/%$/, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Every number literal appearing in a piece of text, as parsed values (commas/percent signs stripped). */
export function extractNumbers(text: string): number[] {
  const matches = text.match(NUMBER_TOKEN_RE) ?? [];
  return matches.map(parseToken).filter((n): n is number => n !== null);
}

function collectFromValue(value: unknown, out: number[]): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFromValue(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectFromValue(v, out);
  }
}

/** Every number appearing anywhere in a set of tool-result payloads — the model's only legitimate source of numbers. */
export function collectAllowedNumbers(toolPayloads: unknown[]): number[] {
  const out: number[] = [...ALWAYS_ALLOWED];
  for (const payload of toolPayloads) collectFromValue(payload, out);
  return out;
}

/** A number is traceable if it matches an allowed value exactly, or matches it after rounding
 * either side to the nearest integer (covers "65.72%" reported as "about 66%", and vice versa). */
function isTraceable(n: number, allowed: number[]): boolean {
  return allowed.some(
    (a) => Math.abs(a - n) < 1e-9 || Math.abs(Math.round(a) - n) < 1e-9 || Math.abs(a - Math.round(n)) < 1e-9,
  );
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type AuditResult = {
  /** The narrative with every untraceable-number sentence removed. */
  text: string;
  /** Sentences that were dropped, for logging. */
  rejectedSentences: string[];
};

/** Strips every sentence containing a number that isn't traceable to `toolPayloads`. */
export function auditNarrative(rawText: string, toolPayloads: unknown[]): AuditResult {
  const allowed = collectAllowedNumbers(toolPayloads);
  const sentences = splitSentences(rawText);
  const kept: string[] = [];
  const rejectedSentences: string[] = [];

  for (const sentence of sentences) {
    const numbers = extractNumbers(sentence);
    const allTraceable = numbers.every((n) => isTraceable(n, allowed));
    if (allTraceable) {
      kept.push(sentence);
    } else {
      rejectedSentences.push(sentence);
    }
  }

  return { text: kept.join(" "), rejectedSentences };
}
