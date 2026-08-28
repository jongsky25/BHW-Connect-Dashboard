import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The run-record migration and the cron schedule, asserted against the committed files.
 *
 * The pattern this repository has settled on: "an assertion that can only be checked against a
 * running project is an assertion nobody checks in review" — and the rule it learned the hard way,
 * four times over: *parse the thing you mean to assert about; do not scan the file it lives in.*
 * So the column list is parsed out of the `create table` body and the cron schedules are parsed
 * into their five fields, rather than either being matched as a substring.
 *
 * The schedule assertions are the ones worth having. Vercel's Hobby plan allows **100 cron jobs per
 * project** (re-read on 2026-08-28, after the 2026-01-20 change that removed the old per-team cap
 * of 2 — which is what `BUILD_PLAN.md` P6 was written against) but still caps **frequency** at once
 * per day, with scheduling precision to the hour. A second daily job therefore fits, and a job that
 * would run twice in a day does not — it fails at deploy time, which is the worst place to find out.
 * These turn "once per day" from something a reader has to remember into something CI checks.
 */

const MIGRATION = fileURLToPath(
  new URL("../../supabase/migrations/20260828200000_ai_regression_run.sql", import.meta.url),
);
const sql = readFileSync(MIGRATION, "utf8");

const VERCEL = fileURLToPath(new URL("../../vercel.json", import.meta.url));
const vercel = JSON.parse(readFileSync(VERCEL, "utf8")) as {
  crons: { path: string; schedule: string }[];
};

/** Everything between `create table ... (` and the closing `);`, split into top-level items. */
function createTableBody(source: string, table: string): string[] {
  const start = source.indexOf(`create table if not exists ${table} (`);
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  let end = -1;
  for (let i = source.indexOf("(", start); i < source.length; i += 1) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  expect(end).toBeGreaterThan(-1);
  // Comment lines go first, before anything counts quotes: this header is prose, and prose has
  // apostrophes in it. Counting `'` across a comment is the same class of mistake as scanning a
  // migration for a bare word — it was made here first, and it made the split stop at column nine.
  const body = source
    .slice(source.indexOf("(", start) + 1, end)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("--"))
    .join("\n");

  // Split on commas that are not inside parentheses or a quoted literal, so a `check (... in
  // ('a', 'b'))` stays one item.
  const items: string[] = [];
  let current = "";
  let nested = 0;
  let quoted = false;
  for (const char of body) {
    if (char === "'") quoted = !quoted;
    if (!quoted && char === "(") nested += 1;
    if (!quoted && char === ")") nested -= 1;
    if (!quoted && nested === 0 && char === ",") {
      items.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  items.push(current);

  return items
    .map((item) =>
      item
        .split("\n")
        .map((line) => line.trim())
        .join(" ")
        .trim(),
    )
    .filter(Boolean);
}

const columns = createTableBody(sql, "ai_regression_run");
const columnNames = columns.map((item) => item.split(/\s+/)[0]);

describe("the ai_regression_run migration", () => {
  it("is idempotent — re-running it is a no-op on a database that already has the table", () => {
    expect(sql).toContain("create table if not exists ai_regression_run (");
    expect(sql).toContain("create index if not exists ai_regression_run_started_idx");
  });

  it("carries the pin tally as three counts and never as a failure total", () => {
    // The 2026-08-28 entry: "Every one came back `unmet`, not `unresolved` — and that distinction
    // is the reassuring part." A column called `failures` would be the place that got thrown away.
    expect(columnNames).toEqual(
      expect.arrayContaining(["pins", "pins_met", "pins_unmet", "pins_unresolved"]),
    );
    expect(columnNames).not.toContain("failures");
    expect(columnNames).not.toContain("pins_failed");
  });

  it("records what a run covered as well as what it found", () => {
    // A run that replayed twelve of eighteen cases has established nothing about the other six, and
    // a row that stored only the verdict counts could not say so.
    expect(columnNames).toEqual(expect.arrayContaining(["cases_open", "cases_replayed"]));
  });

  it("admits exactly the three outcomes, and no fourth that nothing writes", () => {
    const check = columns.find((item) => item.startsWith("outcome "));
    expect(check).toBeDefined();
    const values = [...check!.matchAll(/'([a-z]+)'/g)].map((match) => match[1]);
    expect(values).toEqual(["clean", "moved", "structural"]);
  });

  it("is service-role only: RLS on, and no policy granting anon or authenticated a read", () => {
    expect(sql).toContain("alter table ai_regression_run enable row level security");
    expect(sql).not.toMatch(/create\s+policy/i);
  });

  it("keeps a digest, which is what lets a repeat be recognised as one", () => {
    expect(columnNames).toContain("findings_digest");
  });
});

describe("the cron schedules in vercel.json", () => {
  it("registers the regression replay alongside the precompute job", () => {
    expect(vercel.crons.map((cron) => cron.path)).toEqual([
      "/api/cron/precompute",
      "/api/cron/regression-replay",
    ]);
  });

  it("keeps every job to at most one run per day, which is Vercel Hobby's hard limit", () => {
    // A cron expression runs more than once a day exactly when its minute or hour field names more
    // than one value. Hobby rejects those at deploy time.
    for (const cron of vercel.crons) {
      const [minute, hour] = cron.schedule.split(" ");
      expect(`${cron.path} minute=${minute}`).toMatch(/minute=\d+$/);
      expect(`${cron.path} hour=${hour}`).toMatch(/hour=\d+$/);
    }
  });

  it("spaces the two jobs beyond the hour of slack Hobby's scheduling precision allows", () => {
    // Hobby fires a job anywhere inside its hour, so two jobs an hour apart can overlap and two
    // jobs two hours apart cannot. The precompute run has a 50s budget and this one 45s; sharing a
    // window would put both against the same free-tier request caps.
    const hours = vercel.crons
      .map((cron) => Number(cron.schedule.split(" ")[1]))
      .sort((a, b) => a - b);
    for (let i = 1; i < hours.length; i += 1) {
      expect(hours[i] - hours[i - 1]).toBeGreaterThanOrEqual(2);
    }
  });
});
