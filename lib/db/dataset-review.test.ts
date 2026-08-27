import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NEEDS_REVIEW_PREFIX, isReviewStatus, needsReview } from "./dataset-review";

/**
 * Increment 4.1's invariants, checked two ways.
 *
 * The TypeScript half is ordinary unit testing. The SQL half reads the committed migration, on the
 * precedent `dataset-registry-seed.test.ts` sets: "an assertion that can only be checked against a
 * running project is an assertion nobody checks in review". That argument is stronger here than it
 * was there, because the thing being asserted is a set of *refusals* — the cases where
 * `profile_dataset()` must not act — and a refusal is exactly what a happy-path run against a live
 * database never exercises.
 *
 * The previous entry in `DECISIONS.md` is the reason this file exists at all: `extract_kb.py
 * --propose` was "written, typed and unrun", and was broken on its first line of real work by a
 * format string no test evaluated. A profiling function that builds SQL with `format()` is the same
 * hazard in the same shape, so the identifier-quoting rule below is asserted rather than assumed.
 */

const MIGRATION = fileURLToPath(
  new URL("../../supabase/migrations/20260827180000_profile_dataset.sql", import.meta.url),
);
const sql = readFileSync(MIGRATION, "utf8");

describe("needsReview", () => {
  it("recognises the placeholder profile_dataset() writes", () => {
    expect(
      needsReview(`${NEEDS_REVIEW_PREFIX} geo_code — no approved dictionary describes this`),
    ).toBe(true);
    expect(needsReview("  (needs review) leading whitespace still counts")).toBe(true);
  });

  it("does not flag a real meaning that merely mentions review", () => {
    expect(needsReview("PSGC code of the barangay; needs review against the 2024 vintage")).toBe(
      false,
    );
  });

  it("treats a missing meaning as not-a-placeholder rather than throwing", () => {
    // `meaning` is NOT NULL in the schema, so null here means the read degraded, not that the
    // column is undocumented. Reporting it as a placeholder would invent a finding.
    expect(needsReview(null)).toBe(false);
    expect(needsReview(undefined)).toBe(false);
  });
});

describe("isReviewStatus", () => {
  it("accepts only the two judgements the queue can record", () => {
    expect(isReviewStatus("approved")).toBe(true);
    expect(isReviewStatus("rejected")).toBe(true);
    // 'auto' is where a row starts, never something a reviewer submits — a form posting it would
    // otherwise re-open a judged row through the judge action.
    expect(isReviewStatus("auto")).toBe(false);
    expect(isReviewStatus("")).toBe(false);
    expect(isReviewStatus(undefined)).toBe(false);
  });
});

describe("profile_dataset(): what it refuses", () => {
  it("refuses identity, telemetry and free-text tables by name", () => {
    for (const table of ["admin_users", "usage_events", "feedback", "ingestion_batches"]) {
      expect(sql).toContain(`'${table}'`);
    }
  });

  it("refuses the assistant's own bookkeeping and the registry/graph tables by prefix", () => {
    expect(sql).toContain("p_table like 'ai\\_%'");
    expect(sql).toContain("p_table like 'dataset\\_%'");
    expect(sql).toContain("p_table like 'kb\\_%'");
    expect(sql).toContain("p_table like 'doc\\_%'");
  });

  it("resolves the table against information_schema rather than trusting the argument", () => {
    expect(sql).toContain("from information_schema.tables");
    expect(sql).toContain("table_schema = 'public'");
  });

  it("will not overwrite an approved dictionary without p_force", () => {
    expect(sql).toMatch(/if not p_force and exists/);
    expect(sql).toMatch(/r\.status = 'approved'/);
  });
});

describe("profile_dataset(): guardrail 3, no interpolated identifiers", () => {
  /**
   * Every dynamic statement must pass its identifiers through `%I`. `%s` in an `execute format(...)`
   * would splice a name in unquoted, which is the injection shape guardrail 3 forbids — and the
   * table name reaching this function comes from a caller, not from the catalogue.
   */
  it("quotes every identifier in every dynamic statement with %I", () => {
    // Match the format *string* rather than the whole call: a call ends at a balanced paren, and
    // these format strings contain `count(*)`, so a non-greedy match to the first `)` truncates
    // them and silently asserts nothing. That mistake is why this comment is here.
    const formatStrings = [...sql.matchAll(/execute format\(\s*'((?:[^']|'')*)'/g)].map(
      (m) => m[1],
    );
    expect(formatStrings.length).toBeGreaterThan(0);
    for (const template of formatStrings) {
      expect(template).toContain("%I");
      expect(template).not.toMatch(/%s/);
    }
  });

  it("never concatenates the caller's table name into SQL", () => {
    expect(sql).not.toMatch(/execute\s+'[^']*'\s*\|\|\s*p_table/);
    expect(sql).not.toMatch(/execute\s+p_table/);
  });
});

describe("profile_dataset(): what it writes", () => {
  it("writes every row at status auto, so nothing it profiles is queryable unreviewed", () => {
    // The registry insert and the column insert both carry the literal, and the upsert branch
    // returns an already-approved row to 'auto' rather than leaving it approved.
    expect(sql).toContain("'auto',");
    expect(sql).toContain("status = 'auto'");
  });

  it("writes exposure = internal and never grants public exposure", () => {
    // A new row is always internal.
    expect(sql).toContain("'internal',");
    // On re-profiling, the only expression assigned to `exposure` preserves a tag someone else
    // approved and otherwise falls back to internal. It can keep `public`, never grant it —
    // guardrail 5. Asserted as the whole expression because a looser regex matches the comparison
    // inside it and proves nothing.
    expect(sql).toContain(
      "exposure = case when r.exposure = 'public' then 'public' else 'internal' end",
    );
    // With that one expression removed, no assignment of 'public' to exposure remains anywhere.
    // Written as a removal rather than a negative-lookahead regex because the lookahead backtracks
    // over the whitespace and matches the very expression it is meant to exempt.
    const withoutPreserveBranch = sql.replace(
      "exposure = case when r.exposure = 'public' then 'public' else 'internal' end",
      "",
    );
    expect(withoutPreserveBranch).not.toContain("exposure = 'public'");
    expect(withoutPreserveBranch).not.toMatch(/set\s+exposure/i);
  });

  it("marks array and json columns as not queryable", () => {
    expect(sql).toContain("v_col.dtype not in ('ARRAY', 'jsonb', 'json')");
  });

  it("leaves an undocumented column visibly undocumented rather than describing it", () => {
    expect(sql).toContain("(needs review) %s");
    expect(sql).toContain("'placeholder'");
  });
});

describe("profile_dataset_role(): the vocabulary is the one the schema allows", () => {
  /**
   * `dataset_column.role` has a CHECK constraint of key/dimension/measure/meta. The first draft of
   * this function returned 'time' for date and `_year` columns, which typechecks nowhere and would
   * have failed at the first insert against a table with a date column.
   */
  it("returns nothing outside key/dimension/measure/meta", () => {
    const body = sql.slice(sql.indexOf("create or replace function profile_dataset_role"));
    const roleFunction = body.slice(0, body.indexOf("$$;"));
    const literals = new Set(
      (roleFunction.match(/then '([a-z]+)'|else '([a-z]+)'/g) ?? []).map((m) =>
        m.replace(/^(then|else) '/, "").replace(/'$/, ""),
      ),
    );
    for (const role of literals) {
      expect(["key", "dimension", "measure", "meta"]).toContain(role);
    }
    expect(literals.has("measure")).toBe(true);
  });

  it("classifies a near-unique numeric column as an identifier, not a measure", () => {
    // The rule that stops the assistant averaging `bhw_id`. Measured — distinct over rows — rather
    // than guessed from the column's name.
    expect(sql).toContain("p_distinct::numeric / p_row_estimate >= 0.9");
  });
});

describe("profile_dataset(): joins are measured, not guessed", () => {
  it("only proposes a join against a column the registry already calls a join key", () => {
    expect(sql).toContain("dc.status = 'approved' and dc.is_join_key and dc.joins_to is not null");
  });

  it("requires a measured overlap before recording the join", () => {
    expect(sql).toContain("v_best_overlap >= 0.95");
  });

  it("bounds the overlap sample so profiling never scans a fact table unbounded", () => {
    // Guardrail 4 applies to the profiler as much as to queryDataset.
    expect(sql).toMatch(/limit 500/);
  });
});
