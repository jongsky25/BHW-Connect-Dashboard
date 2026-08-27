import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Invariants of the committed registry seed (plan U5).
 *
 * The dictionary in `20260826090100_seed_dataset_registry.sql` is not documentation: `queryDataset`
 * refuses a table with no approved dictionary outright and enforces `is_queryable` per column, so
 * the seed *is* the allowlist. These tests read the committed file — not the live database — for
 * the same reason the lineage seed is generated from committed files: an assertion that can only
 * be checked against a running project is an assertion nobody checks in review.
 *
 * The last case exists because of the specific debt U5 paid off. PRs #75 and #76 were written
 * against each other's absence, and the registry landed carrying a note saying
 * `fact_uuc_phc_barangay` "has no committed migration in supabase/migrations" — true when written,
 * false by the time both merged, and nothing anywhere would have said so.
 */

const MIGRATIONS = fileURLToPath(new URL("../../supabase/migrations", import.meta.url));
const SEED = `${MIGRATIONS}/20260826090100_seed_dataset_registry.sql`;

/** Split a `('a','b',3,…)` tuple list on top-level commas, respecting SQL string literals. */
function splitTuples(block: string): string[][] {
  const tuples: string[][] = [];
  let depth = 0;
  let inString = false;
  let current = "";
  for (const char of block) {
    if (char === "'") inString = !inString;
    if (!inString) {
      if (char === "(") {
        depth += 1;
        if (depth === 1) {
          current = "";
          continue;
        }
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          tuples.push(splitFields(current));
          continue;
        }
      }
    }
    if (depth >= 1) current += char;
  }
  return tuples;
}

function splitFields(raw: string): string[] {
  const fields: string[] = [];
  let field = "";
  let depth = 0;
  let inString = false;
  for (const char of raw) {
    if (char === "'") inString = !inString;
    if (!inString) {
      if (char === "(" || char === "[") depth += 1;
      else if (char === ")" || char === "]") depth -= 1;
      else if (char === "," && depth === 0) {
        fields.push(field.trim());
        field = "";
        continue;
      }
    }
    field += char;
  }
  fields.push(field.trim());
  return fields;
}

function unquote(field: string): string | null {
  const value = field.trim();
  if (value.toLowerCase() === "null") return null;
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  return value;
}

const seed = readFileSync(SEED, "utf8");

/** The `insert into dataset_registry (…) values (…)` block, up to its `on conflict`. */
function registryRows() {
  const start = seed.indexOf("insert into dataset_registry");
  const block = seed.slice(seed.indexOf("values", start), seed.indexOf("on conflict", start));
  return splitTuples(block)
    .filter((fields) => fields.length === 11)
    .map((fields) => {
      const [tableName, title, summary, grain, datasetSlug, exposure] = fields.map(unquote);
      return {
        tableName: tableName as string,
        title,
        summary,
        grain,
        datasetSlug,
        exposure,
        status: unquote(fields[8]),
        notesMd: unquote(fields[9]),
        docPath: unquote(fields[10]),
      };
    });
}

/** The `dataset_column` dictionary block. */
function columnRows() {
  const start = seed.indexOf("insert into dataset_column");
  // Slice *past* `from (values` — that opening paren wraps the whole tuple list, so including it
  // would make the depth counter treat all 250-odd rows as one tuple.
  const open = seed.indexOf("from (values", start) + "from (values".length;
  const block = seed.slice(open, seed.indexOf(") as c (", start));
  return splitTuples(block)
    .filter((fields) => fields.length === 11)
    .map((fields) => ({
      tableName: unquote(fields[0]) as string,
      columnName: unquote(fields[1]) as string,
      ordinal: Number(fields[2]),
      dataType: unquote(fields[3]),
      meaning: unquote(fields[5]) as string,
      role: unquote(fields[7]),
      isQueryable: fields[10].trim() === "true",
    }));
}

const registry = registryRows();
const columns = columnRows();

describe("the committed dataset registry seed", () => {
  it("parses into the rows the file declares", () => {
    // A guard on the parser itself: a silently-empty parse would make every case below vacuous.
    expect(registry.length).toBeGreaterThan(20);
    expect(columns.length).toBeGreaterThan(200);
  });

  it("gives every registered table a dictionary — a table without one is unqueryable", () => {
    const described = new Set(columns.map((c) => c.tableName));
    const undescribed = registry.map((r) => r.tableName).filter((name) => !described.has(name));
    expect(undescribed).toEqual([]);
  });

  it("describes no table it has not registered", () => {
    const registered = new Set(registry.map((r) => r.tableName));
    const orphans = [...new Set(columns.map((c) => c.tableName))].filter((n) => !registered.has(n));
    expect(orphans).toEqual([]);
  });

  it("keeps column names and ordinals unique within each table", () => {
    for (const table of new Set(columns.map((c) => c.tableName))) {
      const own = columns.filter((c) => c.tableName === table);
      expect(new Set(own.map((c) => c.columnName)).size).toBe(own.length);
      expect(new Set(own.map((c) => c.ordinal)).size).toBe(own.length);
    }
  });

  it("registers every relation against a migration that actually creates it", () => {
    // The invariant behind U5's carried debt: a registry row is a promise that the relation exists
    // and is accounted for by a committed file. `built` is read the same way
    // ingestion/build_kb_lineage.py reads it, so the registry and the lineage graph cannot
    // disagree about what this repository builds.
    const built = new Set<string>();
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
      const sql = readFileSync(`${MIGRATIONS}/${file}`, "utf8");
      for (const [, name] of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(\w+)/gi))
        built.add(name.toLowerCase());
      for (const [, name] of sql.matchAll(
        /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(\w+)/gi,
      ))
        built.add(name.toLowerCase());
    }
    const unbuilt = registry.map((r) => r.tableName).filter((name) => !built.has(name));
    expect(unbuilt).toEqual([]);
  });
});

describe("the UUC for PHC entries (plan U5)", () => {
  const uuc = registry.filter((r) => r.datasetSlug === "uuc-phc-2025");

  it("registers all five objects, approved and public", () => {
    // Four from U5, plus agg_uuc_phc_criteria from U7. A new relation the registry does not know
    // about is one queryDataset refuses outright, so this list is the thing that has to grow.
    expect(uuc.map((r) => r.tableName).sort()).toEqual([
      "agg_uuc_phc_counts",
      "agg_uuc_phc_criteria",
      "fact_uuc_phc_barangay",
      "fact_uuc_phc_indicators",
      "ref_uuc_phc_provincial",
    ]);
    for (const row of uuc) {
      expect(row.status).toBe("approved");
      expect(row.exposure).toBe("public");
    }
  });

  it("no longer claims fact_uuc_phc_barangay has no committed migration", () => {
    const row = uuc.find((r) => r.tableName === "fact_uuc_phc_barangay");
    expect(row?.notesMd).not.toMatch(/no committed migration/i);
  });

  it("carries the capping caveat on capped_indicators, not only on the table", () => {
    // A model reading a bare 100 with no adjacent explanation reports full coverage — the exact
    // failure U3 built this column to prevent. The caveat has to be on the column a query returns,
    // because the table's own note is not what travels with the value.
    const capped = columns.find(
      (c) => c.tableName === "fact_uuc_phc_indicators" && c.columnName === "capped_indicators",
    );
    expect(capped).toBeDefined();
    expect(capped?.isQueryable).toBe(true);
    expect(capped?.meaning).toMatch(/bounded/i);
    expect(capped?.meaning).toMatch(/never average/i);
  });

  it("warns on every indicator that can be capped, where the value itself is read", () => {
    const bounded = ["imr", "ufmr", "fic", "abr", "pre_natal", "sba", "water"];
    for (const name of bounded) {
      const column = columns.find(
        (c) => c.tableName === "fact_uuc_phc_indicators" && c.columnName === name,
      );
      expect(column, name).toBeDefined();
      expect(column?.meaning, name).toMatch(/capped_indicators/);
    }
  });

  it("does not mark the provincial benchmarks as capped — they never were", () => {
    // FIC's benchmark is uncapped while barangay FIC is capped at 100, which is why 113 barangays
    // read as worse-than-province by construction. Describing both as bounded would hide that.
    for (const column of columns.filter(
      (c) => c.tableName === "fact_uuc_phc_indicators" && c.columnName.endsWith("_prov_ref"),
    )) {
      expect(column.meaning, column.columnName).toMatch(/Never capped/);
    }
  });

  it("warns that the four route counts overlap, on the table and on every route column", () => {
    // The single thing a model must not do with agg_uuc_phc_criteria is add the four counts or
    // derive a remainder from them. The table's note says so, and each route column repeats it,
    // because a column meaning is the only text that travels with a returned value.
    const table = registry.find((r) => r.tableName === "agg_uuc_phc_criteria");
    expect(table?.notesMd).toMatch(/do not sum/i);
    for (const name of ["n_route_ip", "n_route_conflict", "n_route_four_ps", "n_route_health"]) {
      const column = columns.find(
        (c) => c.tableName === "agg_uuc_phc_criteria" && c.columnName === name,
      );
      expect(column, name).toBeDefined();
      expect(column?.meaning, name).toMatch(/do not add them/i);
    }
  });

  it("says on the health route which denominator it takes", () => {
    // n_route_health over n_listed is the wrong figure and looks entirely plausible, so the
    // correction has to be on the column rather than only in the plan.
    const health = columns.find(
      (c) => c.tableName === "agg_uuc_phc_criteria" && c.columnName === "n_route_health",
    );
    expect(health?.meaning).toMatch(/n_health_evaluable/);
    expect(health?.meaning).toMatch(/NEVER n_listed/);
  });

  it("describes health_indicators as a recorded score, not a derivable one", () => {
    // docs/UUC_PHC_2025_PLAN.md §10 asks for this column to be dropped or recomputed before
    // anything depends on it. U7 depends on it, so the dictionary carries why it is neither.
    const score = columns.find(
      (c) => c.tableName === "fact_uuc_phc_indicators" && c.columnName === "health_indicators",
    );
    expect(score).toBeDefined();
    expect(score?.isQueryable).toBe(true);
    expect(score?.meaning).toMatch(/NOT recomputable/i);
  });

  it("states the overlap at the figure the criteria page prints, and no other", () => {
    // The caveat said "about 141 percent". The live national row is 61 + 38 + 12 + 35 = 146 with
    // route (d) over its own denominator — what /uuc-phc/criteria prints beneath the four tracks —
    // and 145 as a naive sum over n_listed. A dictionary that disagrees with the page about the
    // one number the caveat exists to make vivid teaches the model to contradict the screen.
    const table = registry.find((r) => r.tableName === "agg_uuc_phc_criteria");
    expect(table?.notesMd).toMatch(/sum to 146 percent/);
    expect(table?.notesMd).not.toMatch(/141 percent/);
  });

  it("carries the corrected not-evaluable figure, not the 238 U7 replaced", () => {
    // The dictionary is what a model reads before composing a query, so a stale figure here is
    // worse than a stale figure in prose: nothing renders it for a person to notice. U7 corrected
    // 238 -> 226 in the plan, the cleaning report and the page, and left this copy behind.
    const view = registry.find((r) => r.tableName === "ref_uuc_phc_provincial");
    expect(view?.notesMd).toMatch(/226 barangays carry no usable reference/);
    for (const r of registry) expect(r.notesMd ?? "", r.tableName).not.toMatch(/238 barangays/);
  });

  it("marks surrogate ids unqueryable and measures as measures", () => {
    const ids = columns.filter((c) => c.tableName.includes("uuc") && c.columnName === "id");
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id.isQueryable, id.tableName).toBe(false);
      expect(id.role, id.tableName).toBe("meta");
    }
    const counts = columns.filter(
      (c) => c.tableName === "agg_uuc_phc_counts" && ["n_listed", "n_barangays"].includes(c.columnName),
    );
    expect(counts.map((c) => c.role)).toEqual(["measure", "measure"]);
  });
});
