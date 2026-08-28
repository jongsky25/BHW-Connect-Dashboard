import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readExpectations, type Expectation } from "./regression-cases";

/**
 * §10's expected payload, asserted against the committed migration.
 *
 * The pattern `dataset-review.test.ts`, `contradiction-review.test.ts` and
 * `dataset-registry-seed.test.ts` set: "an assertion that can only be checked against a running
 * project is an assertion nobody checks in review." It matters more than usual here for two
 * reasons.
 *
 * The **refusals** — a malformed expectation, a case with a provider but no answer, a `source` this
 * table does not yet accept — are exactly what a happy-path replay never exercises, and they are
 * the whole safety argument for the column.
 *
 * The **seeds** are hand-written SQL, and route 1's claim is that their expected values are "not
 * authored — they are on screen". A seed that pins a field its own call never projects, or names a
 * tool its own `call` index is not, would fail silently at replay time as `unresolved` and read as
 * a build problem rather than as a typo in the seed. These check that before it can happen.
 */

const MIGRATION = fileURLToPath(
  new URL(
    "../../supabase/migrations/20260828120000_ai_regression_expectation.sql",
    import.meta.url,
  ),
);
const sql = readFileSync(MIGRATION, "utf8");

const RESEED = fileURLToPath(
  new URL(
    "../../supabase/migrations/20260828190000_reseed_uuc_pins_final_list.sql",
    import.meta.url,
  ),
);
const reseedSql = readFileSync(RESEED, "utf8");

const ORIGINAL = fileURLToPath(
  new URL("../../supabase/migrations/20260826160200_ai_regression_case.sql", import.meta.url),
);
const originalSql = readFileSync(ORIGINAL, "utf8");

/**
 * Every SQL string literal in a slice of the migration, in file order, with whether it was cast to
 * jsonb.
 *
 * A plain `/'(.*?)'/` would stop at the first `''` escape inside a literal and hand back a
 * truncated string — the same class of mistake `contradiction-review.test.ts` documents having been
 * made twice in this repository. This scans to the real closing quote.
 */
function sqlLiterals(source: string): { text: string; jsonb: boolean }[] {
  const found: { text: string; jsonb: boolean }[] = [];
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
    found.push({ text, jsonb: source.slice(j + 1, j + 8) === "::jsonb" });
    i = j;
  }
  return found;
}

/**
 * The migration with every comment line removed.
 *
 * The header discusses the swept path at length — why it is *not* built — so an assertion that the
 * word never appears would be asserting the reasoning away. What must hold is that no *statement*
 * introduces it.
 */
const statements = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

type Call = { name: string; args: Record<string, unknown> };
type Seed = {
  question: string;
  toolCalls: Call[];
  expectations: Expectation[];
  malformed: string[];
  note: string;
  source: string;
};

/** The seeded rows, reassembled — five literals each, in the insert's column order. */
const seeds: Seed[] = (() => {
  const literals = sqlLiterals(sql.slice(sql.indexOf("insert into ai_regression_case")));
  // The column list itself contributes no literals; the first is the first row's question.
  const rows: Seed[] = [];
  for (let i = 0; i + 4 < literals.length; i += 5) {
    const [question, toolCalls, expectations, note, source] = literals.slice(i, i + 5);
    const read = readExpectations(JSON.parse(expectations.text));
    rows.push({
      question: question.text,
      toolCalls: JSON.parse(toolCalls.text) as Call[],
      expectations: read.expectations,
      malformed: read.malformed,
      note: note.text,
      source: source.text,
    });
  }
  return rows;
})();

describe("the expectations column", () => {
  it("relaxes the two NOT NULLs a seeded case cannot honestly satisfy", () => {
    // §10.1's seeds are figures on a page, not answers anyone was given. The one seeded case that
    // predates this had to invent both — and a provider to attribute the invented answer to.
    expect(sql).toContain("alter column conversation drop not null");
    expect(sql).toContain("alter column answer_given drop not null");
    expect(originalSql).toContain("conversation jsonb not null");
    expect(originalSql).toContain("answer_given text not null");
  });

  it("replaces them with constraints that say what the NOT NULLs did not", () => {
    expect(sql).toContain("check ((conversation is null) = (answer_given is null))");
    expect(sql).toContain("check (provider is null or answer_given is not null)");
  });

  it("clears the fabricated provider on the seeded case that predates this", () => {
    expect(sql).toContain(
      "update ai_regression_case set provider = null where source = 'seeded' and provider is not null;",
    );
  });

  it("guards the shape of every element rather than trusting the reader", () => {
    expect(sql).toContain("check (ai_regression_expectation_well_formed(expectations))");
  });

  it("uses `is distinct from` for the required keys, because `<>` accepts a missing one", () => {
    // `jsonb_typeof(e -> 'call')` is NULL when the key is absent, and `NULL <> 'number'` is NULL,
    // which a `where` reads as no-match — so `<>` would admit an element with no `call` at all.
    // This is the exact defect the constraint exists to prevent, and it was in the first draft.
    for (const key of ["call", "tool", "field"]) {
      expect(sql).toContain(`jsonb_typeof(e -> '${key}') is distinct from`);
    }
    expect(sql).not.toMatch(/jsonb_typeof\(e -> '(call|tool|field)'\) <>/);
  });

  it("admits only scalar expected values, JSON null included in the refusal", () => {
    expect(sql).toContain(
      "coalesce(jsonb_typeof(e -> 'value'), 'null') not in ('number', 'string', 'boolean')",
    );
  });

  it("still refuses a swept source, which is a decision rather than an oversight", () => {
    // §8 4.2 says the sweep feeds this list, and this column is what it was waiting for. All 12
    // `kb_contradiction` rows are at `status = 'auto'` and owner decision 5 says a person judges,
    // so there is nothing confirmed to file — and a `source` value nothing writes is the
    // `--propose` mistake again. The value goes in with the migration that files the first row.
    expect(originalSql).toContain("check (source in ('reported', 'seeded'))");
    expect(statements).not.toContain("swept");
    expect(statements).not.toContain("kb_contradiction");
    expect(statements).not.toContain("source in (");
  });
});

describe("route 1's seeded cases", () => {
  it("seeds ten, all of them seeded and none of them carrying an invented answer", () => {
    expect(seeds).toHaveLength(10);
    const insert = sql.slice(sql.indexOf("insert into ai_regression_case"));
    expect(insert).toContain(
      "insert into ai_regression_case (question, tool_calls, expectations, note, source) values",
    );
    // The column list is the assertion: conversation, answer_given and provider are absent, so
    // every seeded row takes the null the relaxed columns now allow.
    for (const column of ["conversation", "answer_given", "provider"]) {
      expect(insert.slice(0, insert.indexOf("values"))).not.toContain(column);
    }
    expect(seeds.map((seed) => seed.source)).toEqual(Array(10).fill("seeded"));
  });

  it("stores no expectation this build cannot read", () => {
    for (const seed of seeds) expect(seed.malformed).toEqual([]);
    expect(seeds.every((seed) => seed.expectations.length > 0)).toBe(true);
  });

  it("names, on every expectation, the tool its own call index actually is", () => {
    for (const seed of seeds) {
      for (const pinned of seed.expectations) {
        expect(seed.toolCalls[pinned.call]?.name).toBe(pinned.tool);
      }
    }
  });

  it("only pins fields its own call projects", () => {
    // A `where` key or an asserted field left out of `columns` comes back `unresolved` at replay
    // time and reads as a build problem rather than as a typo in the seed.
    for (const seed of seeds) {
      for (const pinned of seed.expectations) {
        const projection = seed.toolCalls[pinned.call]?.args.columns;
        if (!Array.isArray(projection)) continue;
        for (const key of Object.keys(pinned.where ?? {})) expect(projection).toContain(key);
        if (pinned.where) expect(projection).toContain(pinned.field);
      }
    }
  });

  it("carries no `from`, so the list-naming §10.1 route 3 added did not change these", () => {
    // `queryDataset` puts everything in `rows`, which is what an absent `from` means. A seed that
    // silently gained one would be reading a different part of the payload than it was verified on.
    for (const seed of seeds) {
      for (const pinned of seed.expectations) expect(pinned.from).toBeNull();
    }
  });

  it("says, on every case, which screen renders the figure it pins", () => {
    // Route 1's claim is that its expected answers are "not authored — they are on screen". That
    // is only checkable if the screen is written down; a seed with no page named is an authored
    // expectation wearing route 1's clothes.
    for (const seed of seeds) {
      expect(seed.note, seed.question).toMatch(/\/[a-z-]+/);
    }
  });

  it("covers the selector's branches, so none of them ships unexercised", () => {
    const all = seeds.flatMap((seed) => seed.expectations);
    // The payload root (a count call has no rows array to select from).
    expect(all.some((pinned) => pinned.where === null)).toBe(true);
    // A selector needing two keys to name one of several rows returned.
    expect(all.some((pinned) => Object.keys(pinned.where ?? {}).length === 2)).toBe(true);
    // A key that is not a geography.
    expect(all.some((pinned) => "income_class" in (pinned.where ?? {}))).toBe(true);
    // And all three value types.
    expect(all.some((pinned) => typeof pinned.value === "boolean")).toBe(true);
    expect(all.some((pinned) => Number.isInteger(pinned.value))).toBe(true);
    expect(
      all.some((pinned) => typeof pinned.value === "number" && !Number.isInteger(pinned.value)),
    ).toBe(true);
  });
});

describe("readExpectations", () => {
  it("reports every malformed shape the database refuses, rather than skipping it", () => {
    const bad = [
      { tool: "queryDataset", field: "n", value: 1 },
      { call: 0, field: "n", value: 1 },
      { call: 0, tool: "queryDataset", value: 1 },
      { call: 0, tool: "queryDataset", field: "n" },
      { call: 0, tool: "queryDataset", field: "n", value: null },
      { call: 0, tool: "queryDataset", field: "n", value: { a: 1 } },
      { call: "0", tool: "queryDataset", field: "n", value: 1 },
      { call: -1, tool: "queryDataset", field: "n", value: 1 },
      { call: 0, tool: "queryDataset", where: "geo_code", field: "n", value: 1 },
      { call: 0, tool: "queryDataset", where: { geo_code: { a: 1 } }, field: "n", value: 1 },
      // An empty selector matches every row and resolves only on a single-row payload — an
      // accident that looks exactly like a deliberate root read.
      { call: 0, tool: "queryDataset", where: {}, field: "n", value: 1 },
      "not an object",
    ];
    const { expectations, malformed } = readExpectations(bad);
    expect(expectations).toEqual([]);
    expect(malformed).toHaveLength(bad.length);
  });

  it("reads the shapes the seeds use", () => {
    const { expectations, malformed } = readExpectations([
      { call: 0, tool: "queryDataset", field: "matchingRows", value: 5991 },
      { call: 1, tool: "queryDataset", where: { geo_code: "PH" }, field: "n_total", value: 270917 },
      { call: 2, tool: "queryDataset", where: { income_class: 4 }, field: "x", value: false },
    ]);
    expect(malformed).toEqual([]);
    expect(expectations[0].where).toBeNull();
    expect(expectations[1].where).toEqual({ geo_code: "PH" });
    expect(expectations[2].value).toBe(false);
  });
});

/**
 * The re-seed that followed the source office's final 5,987 list.
 *
 * Four of route 1's ten cases pin figures from the UUC dataset, and eight of their eleven pins
 * stopped matching when `20260828180000_uuc_phc_final_list_alignment.sql` landed. That is the first
 * regression this list has caught since it gained an expected payload, and what it caught was a
 * deliberate correction — so the pins are re-derived, never relaxed.
 *
 * These assertions exist because the tempting shortcuts are all silent. Keying the update on
 * `case_id` would work here and break on a fresh database. Leaving a note quoting 5,991 would keep
 * the pins right while making their provenance a lie. And dropping a pin rather than re-deriving it
 * would turn a caught regression into a smaller suite.
 */
describe("the UUC re-seed", () => {
  const questions = [
    "How many barangays are on the 2025 UUC for PHC list, and out of how many?",
    "How many barangays are on the UUC for PHC list in total?",
    "Which routes carried barangays onto the 2025 UUC for PHC list?",
    "How many BHWs serve the barangays on the UUC for PHC list?",
  ];

  it("updates exactly the four seeded cases that read a UUC table", () => {
    expect(reseedSql.match(/^update ai_regression_case set$/gm)).toHaveLength(4);
    for (const question of questions) expect(reseedSql).toContain(question);
    // Every seed naming a UUC table must be one of the four; a fifth would have been missed.
    const uucSeeds = seeds.filter((seed) =>
      seed.toolCalls.some((call) => String(call.args.table ?? "").includes("uuc")),
    );
    expect(uucSeeds.map((seed) => seed.question).sort()).toEqual([...questions].sort());
  });

  it("keys on the question, not on a case id an identity sequence happened to assign", () => {
    // The seeds' ids skipped four values while the original migration's refusals were exercised,
    // so they are an artifact of how that migration was run rather than a property of the data.
    expect(reseedSql).toContain("where source = 'seeded'");
    expect(reseedSql).not.toMatch(/where\s+case_id/);
  });

  it("re-derives every pin rather than dropping any", () => {
    // Pin counts per case are unchanged: 2, 1, 5, 3 — the same eleven the originals carried.
    const arrays = reseedSql.match(/'\[\{"call"[\s\S]*?\]'::jsonb/g) ?? [];
    expect(arrays).toHaveLength(4);
    const counts = arrays.map((a) => JSON.parse(a.slice(1, -8)).length);
    expect(counts).toEqual([2, 1, 5, 3]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(uucPinCount());
  });

  it("leaves no pin on 5,991, and no note claiming the page still renders it", () => {
    // Asserted on the *parsed pins*, not on a scan of the file. A raw scan fails on the case-8
    // note, which mentions 5,991 legitimately — as the figure the final list replaced. That is
    // provenance worth keeping, and a test that forced it out would be the instrument being wrong
    // rather than the migration. This repository has now made the naive-string-scan mistake in a
    // migration test four times; the parsed value is what the assertion is actually about.
    const values = reseedPins().map((pin) => pin.value);
    expect(values).not.toContain(5991);
    expect(values).toContain(5987);
    // The notes must name 5,987 as what is on screen. Route 1's claim is that a seeded case's
    // expected answer is on a page; a note quoting the superseded figure makes that uncheckable.
    for (const note of reseedNotes()) {
      if (note.includes("5,991")) expect(note).toContain("5,987");
    }
    expect(reseedNotes().filter((note) => note.includes("5,987")).length).toBeGreaterThanOrEqual(3);
  });

  it("keeps the three UUC pins that did not move", () => {
    // n_barangays counts every barangay in the country, not the list; the other two genuinely did
    // not change. Re-deriving a figure that did not move would still be correct, but asserting it
    // here is what catches a re-seed that quietly rewrote something it had not measured.
    expect(reseedSql).toContain('"field":"n_barangays","value":41958');
    expect(reseedSql).toContain('"field":"n_route_four_ps","value":726');
    expect(reseedSql).toContain('"field":"n_listed_no_bhw","value":100');
  });
});

/** Every pin the re-seed writes, across all four cases. */
function reseedPins(): Expectation[] {
  const arrays = reseedSql.match(/'\[\{"call"[\s\S]*?\]'::jsonb/g) ?? [];
  return arrays.flatMap((a) => readExpectations(JSON.parse(a.slice(1, -8))).expectations);
}

/** The `note` each update writes — the literal following its expectations array. */
function reseedNotes(): string[] {
  return sqlLiterals(reseedSql)
    .filter((lit) => lit.text.trimStart().startsWith("/") || lit.text.includes("5,987"))
    .map((lit) => lit.text);
}

/** The eleven pins the original four UUC seeds carried, read from the seeding migration. */
function uucPinCount() {
  return seeds
    .filter((seed) => seed.toolCalls.some((call) => String(call.args.table ?? "").includes("uuc")))
    .reduce((total, seed) => total + seed.expectations.length, 0);
}
