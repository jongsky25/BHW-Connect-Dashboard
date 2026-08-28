import type { Expectation, ExpectedValue } from "@/lib/db/regression-cases";

/**
 * Deriving §10's pinned figures for a harvested case (docs/AI_ASSISTANT_PLAN.md §10.1 route 3).
 *
 * WHAT PROBLEM THIS SOLVES. `ai_ask_cache` stores an approved question and answer and nothing
 * else — no tool calls, no citations, no payload. `harvest_ask_cache_cases()` recovers the tool
 * calls from `ai_ask_log.tool_trace`, which makes a harvested case replayable. It cannot recover
 * the *figures*: those are numerals inside prose, and which payload field each one came from is
 * not written down anywhere.
 *
 * It is nevertheless derivable, and that is the point. Every number in an approved answer passed
 * `auditNarrative`, which means it appears somewhere in a tool payload. Re-issue the recorded
 * calls, enumerate every field the expectation language can address, and match by exact equality.
 * No model reads the answer; nothing here needs a provider key. `extractNumbers` is the audit's
 * own tokeniser, reused rather than reimplemented so a number the audit admits and a number this
 * pins are the same set.
 *
 * WHY EQUALITY IS EXACT HERE AND ROUNDED IN THE AUDIT. `isTraceable` allows "65.72%" to be
 * reported as "about 66%", because its job is to decide whether a *sentence* may be shown. A pin's
 * job is to be compared byte-for-byte on a later build, so a rounded match would write an expected
 * value that was never in a payload and fail on the first replay. Exact or nothing.
 *
 * WHY AN AMBIGUOUS NUMBER IS LEFT UNPINNED. A number can equal several addressable fields at once.
 * Where those addresses name the same row and the same field — `{payerLevel: "barangay"}`
 * `pctReceiving`, reachable both through `getHonorariumStats().rows` and through the array
 * `getIndicatorByGeo(honorarium_amount)` embeds — they are the same quantity read two ways, and
 * the first is pinned. Where they name *different* rows or *different* fields they are different
 * quantities that happen to be equal today, and pinning either would record a claim the answer
 * never made: a later divergence would report a regression in a figure the sentence was not about.
 * Those are reported as ambiguous and pinned not at all. Measured, not assumed: on the seven
 * approved rows this rule pins 37 of 41 distinct numbers and declines 2 (the other 2 are in no
 * payload at all — "near 100%" and "below 12%" are prose, not figures).
 */

import { extractNumbers } from "./audit";

/** One place in a payload that an `Expectation` can name, and what is there now. */
export type Address = {
  call: number;
  tool: string;
  /** The array the row came from, or null for a field on the payload root. */
  from: string | null;
  where: Record<string, string> | null;
  field: string;
  value: number;
};

export type Pin = {
  expectation: Expectation;
  /** Every address that carries this value — one, or several naming the same quantity. */
  addresses: Address[];
};

export type DerivedPins = {
  pins: Pin[];
  /** Numbers matching addresses that disagree about which quantity they are. */
  ambiguous: { value: number; addresses: Address[] }[];
  /** Numbers in the answer that no addressable field carries. Prose, or a figure out of reach. */
  unmatched: number[];
};

function isRowArray(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((row) => !!row && typeof row === "object" && !Array.isArray(row))
  );
}

/**
 * A selector naming exactly one row of `rows`, or null when none does.
 *
 * **String keys only, and that is a rule rather than a convenience.** A selector keyed on a measure
 * would put the very figure being checked inside the thing that selects the row to check it in —
 * the assertion would then be trivially true, or unresolvable, depending on which moved. The
 * smallest such selector is preferred (one key, then two) because a selector that later matches
 * two rows is scored `unresolved`, which is a finding, whereas a needlessly wide one hides that a
 * row lost its identity.
 */
export function deriveSelector(
  rows: Record<string, unknown>[],
  index: number,
): Record<string, string> | null {
  const row = rows[index];
  const keys = Object.keys(row).filter((key) => typeof row[key] === "string");
  for (const key of keys) {
    if (rows.filter((other) => other[key] === row[key]).length === 1) {
      return { [key]: row[key] as string };
    }
  }
  for (let a = 0; a < keys.length; a += 1) {
    for (let b = a + 1; b < keys.length; b += 1) {
      const [first, second] = [keys[a], keys[b]];
      const matches = rows.filter(
        (other) => other[first] === row[first] && other[second] === row[second],
      );
      if (matches.length === 1) {
        return { [first]: row[first] as string, [second]: row[second] as string };
      }
    }
  }
  return null;
}

/**
 * Every numeric field one payload exposes to the expectation language, as addresses.
 *
 * Root scalars first, then each array of objects the payload carries. `rows` is written as an
 * absent `from` so a derived pin has the same shape as route 1's hand-written seeds; any other
 * array names itself. A row no selector can identify contributes nothing — its figures are real
 * but unaddressable, and inventing a positional selector would pin a figure to a row index that
 * reorders.
 */
export function addressesIn(call: number, tool: string, payload: unknown): Address[] {
  const found: Address[] = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return found;
  const entries = Object.entries(payload as Record<string, unknown>);

  for (const [field, value] of entries) {
    if (typeof value === "number" && Number.isFinite(value)) {
      found.push({ call, tool, from: null, where: null, field, value });
    }
  }
  for (const [listName, list] of entries) {
    if (!isRowArray(list)) continue;
    list.forEach((row, index) => {
      const where = deriveSelector(list, index);
      if (!where) return;
      for (const [field, value] of Object.entries(row)) {
        if (typeof value === "number" && Number.isFinite(value)) {
          found.push({
            call,
            tool,
            from: listName === "rows" ? null : listName,
            where,
            field,
            value,
          });
        }
      }
    });
  }
  return found;
}

/** The quantity an address names, independent of which call or which array reached it. */
function quantity(address: Address): string {
  return `${JSON.stringify(address.where)}|${address.field}`;
}

function toExpectation(address: Address): Expectation {
  return {
    call: address.call,
    tool: address.tool,
    from: address.from,
    where: address.where,
    field: address.field,
    value: address.value as ExpectedValue,
  };
}

/**
 * The figures a harvested answer can pin, given the payloads its recorded calls returned now.
 *
 * `payloads` must be index-aligned with the case's `tool_calls`, failed calls included — an
 * expectation names its call by index, so a skipped entry would shift every pin onto the wrong
 * call. Same rule as `replayCase`, and for the same reason.
 */
export function derivePins(
  answer: string,
  payloads: { name: string; payload: unknown }[],
): DerivedPins {
  const addresses = payloads.flatMap((call, index) => addressesIn(index, call.name, call.payload));
  const pins: Pin[] = [];
  const ambiguous: DerivedPins["ambiguous"] = [];
  const unmatched: number[] = [];

  for (const value of [...new Set(extractNumbers(answer))]) {
    const matches = addresses.filter((address) => address.value === value);
    if (matches.length === 0) {
      unmatched.push(value);
      continue;
    }
    if (new Set(matches.map(quantity)).size > 1) {
      ambiguous.push({ value, addresses: matches });
      continue;
    }
    // Same quantity, reached more than one way: the earliest call is pinned, which is the one the
    // answer's own tool loop made first.
    pins.push({ expectation: toExpectation(matches[0]), addresses: matches });
  }
  return { pins, ambiguous, unmatched };
}
