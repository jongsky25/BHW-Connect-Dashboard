import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readExpectations, type Expectation } from "./regression-cases";

/**
 * §10.1 route 3, asserted against the committed migration.
 *
 * The pattern `dataset-review.test.ts`, `contradiction-review.test.ts` and
 * `ai-regression-case.test.ts` set: "an assertion that can only be checked against a running
 * project is an assertion nobody checks in review."
 *
 * Three things here are worth that treatment specifically.
 *
 * The **refusals** — a second case on the same source row, a harvest key on a case that was not
 * harvested, a `from` with no `where` — are the safety argument for the whole increment, and a
 * happy-path harvest exercises none of them.
 *
 * The **drift rules** are invisible until something drifts. A re-harvest that quietly kept the
 * pins of an edited answer would leave a case green against figures nobody verified, which is the
 * exact failure the expectations column exists to prevent; a re-harvest that deleted a case whose
 * source was unapproved would silently shrink the list. Both are one clause in one SQL function,
 * and both are asserted here rather than trusted.
 *
 * The **pins** are literal SQL, derived by `lib/ai/harvest-pins.ts` from live payloads. A pin that
 * names a tool its own `call` index is not, or a `from` naming a list its call cannot return, would
 * come back `unresolved` at replay time and read as a build problem rather than as a bad seed.
 */

const MIGRATION = fileURLToPath(
  new URL("../../supabase/migrations/20260828170000_ai_regression_harvest.sql", import.meta.url),
);
const sql = readFileSync(MIGRATION, "utf8");

/**
 * The migration with every comment line removed.
 *
 * The header discusses the swept path and the `--propose` mistake at length, so an assertion that
 * a word never appears would be asserting the reasoning away. What must hold is that no *statement*
 * introduces it. Same reasoning as `ai-regression-case.test.ts`.
 */
const statements = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

/** The plpgsql body of `harvest_ask_cache_cases`, comments stripped. */
const harvestBody = (() => {
  const start = statements.indexOf("create or replace function harvest_ask_cache_cases(");
  return statements.slice(start, statements.indexOf("\n$$;", start));
})();

/**
 * The pinned figures, reassembled from the `update` statements.
 *
 * Reassembled rather than regex-matched for a value: a naive pattern that stops at the first quote
 * hands back a truncated string and then asserts nothing, which is a mistake this repository has
 * made twice (see `contradiction-review.test.ts`). This reads to the real closing quote, doubled
 * quotes included — one of the seven keys contains an apostrophe.
 */
type Seed = { key: string; expectations: Expectation[]; malformed: string[] };

const seeds: Seed[] = (() => {
  const found: Seed[] = [];
  const source = sql.slice(sql.indexOf("update ai_regression_case set expectations"));
  const literals: string[] = [];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] !== "'") continue;
    let text = "";
    let j = i + 1;
    for (; j < source.length; j += 1) {
      if (source[j] !== "'") {
        text += source[j];
        continue;
      }
      if (source[j + 1] === "'") {
        text += "'";
        j += 1;
        continue;
      }
      break;
    }
    literals.push(text);
    i = j;
  }
  // Two literals per statement, in order: the expectations array, then the harvest key.
  for (let i = 0; i + 1 < literals.length; i += 2) {
    const read = readExpectations(JSON.parse(literals[i]));
    found.push({
      key: literals[i + 1],
      expectations: read.expectations,
      malformed: read.malformed,
    });
  }
  return found;
})();

describe("the harvested source", () => {
  it("adds a third source value, and this increment is what writes it", () => {
    expect(statements).toContain("check (source in ('reported', 'seeded', 'harvested'))");
    expect(statements).toContain("'harvested',");
  });

  it("still refuses a swept source, which remains a decision rather than an oversight", () => {
    // All 12 `kb_contradiction` rows are still at `status = 'auto'` (re-checked, not assumed) and
    // owner decision 5 says a person judges. A `source` value nothing writes is the `--propose`
    // mistake, and the difference with 'harvested' is exactly that this migration writes it.
    expect(statements).not.toContain("swept");
    expect(statements).not.toContain("kb_contradiction");
  });
});

describe("idempotence and drift", () => {
  it("makes a duplicate impossible by construction rather than by a query", () => {
    expect(sql).toContain("create unique index ai_regression_case_harvest_key_idx");
    expect(sql).toContain("where harvest_key is not null");
  });

  it("ties the three harvest columns to the harvested source, all or none", () => {
    expect(statements).toContain("(source = 'harvested') = (harvest_key is not null)");
    expect(statements).toContain("(harvest_key is null) = (harvest_fingerprint is null)");
    expect(statements).toContain("(harvest_key is null) = (harvest_last_seen_at is null)");
  });

  it("clears the pins when the source answer changes, rather than carrying them over", () => {
    // The rebuild branch, not the unchanged one. Pins derived from the previous answer's payloads
    // are not evidence about a new answer.
    const rebuild = harvestBody.slice(harvestBody.indexOf("elsif v_case.harvest_fingerprint"));
    expect(rebuild).toContain("expectations = '[]'::jsonb");
    expect(rebuild).toContain("harvest_fingerprint = v_fingerprint");
  });

  it("fingerprints the answer and the trace, which are what a case is built from", () => {
    expect(harvestBody).toContain("md5(v_row.answer_md || e'\\n' || v_row.trace_text)");
  });

  it("reports a case the run did not reproduce as stale, and never deletes one", () => {
    expect(harvestBody).toContain("action := 'stale'");
    expect(harvestBody).toContain("and rc.harvest_last_seen_at < v_seen_at");
    // 4.2's rule. Deleting would silently shrink the list, and a question verified once is still
    // worth re-running. Matched on the statement, not the word: the stale message itself says
    // "Kept, not deleted", and a scan for "delete" would fail on the sentence that promises it.
    expect(harvestBody).not.toMatch(/\bdelete\s+from\b/i);
    expect(statements).not.toMatch(/\bdelete\s+from\s+ai_regression_case\b/i);
  });

  it("takes one timestamp for the whole run, so staleness is an exact comparison", () => {
    expect(harvestBody).toContain("v_seen_at timestamptz := now()");
  });

  it("leaves updated_at alone when nothing about the case changed", () => {
    const unchanged = harvestBody.slice(harvestBody.lastIndexOf("action := 'unchanged'") - 300);
    expect(unchanged).toContain("update ai_regression_case set harvest_last_seen_at = v_seen_at");
    expect(unchanged.slice(0, unchanged.indexOf("action := 'unchanged'"))).not.toContain(
      "updated_at",
    );
  });
});

describe("recovering the tool calls", () => {
  it("matches the log row on a byte-identical answer, which is what makes it a derivation", () => {
    expect(harvestBody).toContain("and l.answer_md = c.answer_md");
    // A cache hit records no trace, because no tools ran on that turn.
    expect(harvestBody).toContain("and l.served_from = 'live'");
    expect(harvestBody).toContain("and jsonb_array_length(l.tool_trace) > 0");
  });

  it("harvests nothing when more than one log row qualifies", () => {
    // The same rule the expectation selector enforces one level down: not the first, not the
    // newest. A case built from one of several candidate traces is evidence about nothing.
    expect(harvestBody).toContain("if v_row.n_traces > 1 then");
    expect(harvestBody).toContain("a harvested case must name one");
    expect(harvestBody).toContain("count(distinct l.tool_trace::text)");
  });

  it("bounds itself, per guardrail 4", () => {
    expect(sql).toContain("p_statement_timeout text default '30s'");
    expect(harvestBody).toContain(
      "perform set_config('statement_timeout', p_statement_timeout, true)",
    );
  });

  it("pins its search_path and runs as the invoker, like every other function here", () => {
    expect(sql).toContain("set search_path = public, extensions");
    expect(sql).toContain("security invoker");
  });
});

describe("`from`, and the assertion shapes it admits", () => {
  it("refuses a `from` that is not a non-empty string", () => {
    expect(sql).toContain(
      "or (e ? 'from' and (jsonb_typeof(e -> 'from') <> 'string' or e ->> 'from' = ''))",
    );
  });

  it("refuses a `from` with no `where`, because the root read takes no list", () => {
    expect(sql).toContain("or (e ? 'from' and not (e ? 'where'))");
  });

  it("leaves the reader and the constraint agreeing about that shape", () => {
    const { expectations, malformed } = readExpectations([
      { call: 0, tool: "t", from: "demographics", field: "n", value: 1 },
      { call: 0, tool: "t", from: "", where: { a: "b" }, field: "n", value: 1 },
      { call: 0, tool: "t", from: 3, where: { a: "b" }, field: "n", value: 1 },
    ]);
    expect(expectations).toEqual([]);
    expect(malformed).toHaveLength(3);
  });

  it("reads a `from` the migration would accept, and defaults it to null", () => {
    const { expectations, malformed } = readExpectations([
      {
        call: 0,
        tool: "t",
        from: "demographics",
        where: { category: "YES" },
        field: "n",
        value: 30600,
      },
      { call: 0, tool: "t", where: { payerLevel: "region" }, field: "pctReceiving", value: 1.87 },
    ]);
    expect(malformed).toEqual([]);
    expect(expectations[0].from).toBe("demographics");
    expect(expectations[1].from).toBeNull();
  });
});

describe("the seven harvested cases' pinned figures", () => {
  it("pins 37 figures across seven cases, and none the reader cannot read", () => {
    expect(seeds).toHaveLength(7);
    expect(seeds.flatMap((seed) => seed.expectations)).toHaveLength(37);
    for (const seed of seeds) expect(seed.malformed).toEqual([]);
  });

  it("keys every pin on the source row rather than on a case id", () => {
    // Identity columns are not stable across a rebuild of the database; the identity of a
    // harvested case is the ask-cache row it came from.
    for (const seed of seeds) expect(seed.key).toMatch(/^\d{4}-\d{2}-\d{2}T.*\|/);
    expect(new Set(seeds.map((seed) => seed.key)).size).toBe(7);
  });

  it("only names public tools, which is what makes these replayable without a service key", () => {
    // `queryDataset` and `traverseGraph` read the registry and `kb_edge`, both service-role only.
    // Every harvested case's calls come from the ask route's public tool set, so a replay of one
    // needs nothing but the anon key — which is how this suite was first run end to end.
    const tools = new Set(seeds.flatMap((seed) => seed.expectations.map((pin) => pin.tool)));
    expect([...tools].sort()).toEqual([
      "getDataCompleteness",
      "getHonorariumStats",
      "getIndicatorByGeo",
      "getTrainingCoverage",
    ]);
  });

  it("only names a list on a tool whose payload has one", () => {
    // `getIndicatorByGeo` is the only tool in this set that returns a named array beside its root
    // counts. A `from` on any other would be unresolvable at replay time.
    for (const seed of seeds) {
      for (const pin of seed.expectations) {
        if (pin.from !== null) expect(pin.tool).toBe("getIndicatorByGeo");
      }
    }
  });

  it("gives every pin a selector unless it reads the payload root", () => {
    for (const seed of seeds) {
      for (const pin of seed.expectations) {
        if (pin.from !== null) expect(pin.where).not.toBeNull();
      }
    }
  });

  it("never keys a selector on the field it is asserting", () => {
    // A selector keyed on the figure being checked is trivially true or unresolvable, depending on
    // which moved. `deriveSelector` only uses string keys, and this is that rule at the data.
    for (const seed of seeds) {
      for (const pin of seed.expectations) {
        expect(Object.keys(pin.where ?? {})).not.toContain(pin.field);
      }
    }
  });
});
