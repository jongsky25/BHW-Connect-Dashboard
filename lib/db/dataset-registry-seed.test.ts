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

  it("registers all eleven objects, approved and public", () => {
    // Four from U5, plus agg_uuc_phc_criteria from U7, agg_uuc_phc_indicator_dist from U9, U10's
    // three data-quality relations, U11's ref_uuc_phc_list and U12b's agg_bhw_by_uuc_status. A new
    // relation the registry does not know about is one queryDataset refuses outright, so this list
    // is the thing that has to grow.
    expect(uuc.map((r) => r.tableName).sort()).toEqual([
      "agg_bhw_by_uuc_status",
      "agg_uuc_phc_counts",
      "agg_uuc_phc_criteria",
      "agg_uuc_phc_indicator_dist",
      "fact_uuc_phc_barangay",
      "fact_uuc_phc_indicators",
      "ref_uuc_phc_benchmark_gaps",
      "ref_uuc_phc_list",
      "ref_uuc_phc_provincial",
      "ref_uuc_phc_published_delta",
      "ref_uuc_phc_quality",
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
    // Both relations that return a barangay's own values, because the caveat has to travel with
    // whichever one a caller actually queried. ref_uuc_phc_list (U11) is additionally the relation
    // the downloadable file is built from, so its meanings are what a reader sees offline.
    const bounded = ["imr", "ufmr", "fic", "abr", "pre_natal", "sba", "water"];
    for (const table of ["fact_uuc_phc_indicators", "ref_uuc_phc_list"]) {
      for (const name of bounded) {
        const column = columns.find((c) => c.tableName === table && c.columnName === name);
        expect(column, `${table}.${name}`).toBeDefined();
        expect(column?.meaning, `${table}.${name}`).toMatch(/capped_indicators/);
      }
    }
  });

  it("does not mark the provincial benchmarks as capped — they never were", () => {
    // FIC's benchmark is uncapped while barangay FIC is capped at 100, which is why 113 barangays
    // read as worse-than-province by construction. Describing both as bounded would hide that.
    for (const column of columns.filter(
      (c) =>
        (c.tableName === "fact_uuc_phc_indicators" || c.tableName === "ref_uuc_phc_list") &&
        c.columnName.endsWith("_prov_ref"),
    )) {
      expect(column.meaning, `${column.tableName}.${column.columnName}`).toMatch(
        /NEVER capped|Never capped/,
      );
    }
  });

  it("refuses an average of the export view's boundable indicators, in the column meaning itself", () => {
    // The strongest form of the caveat, and it belongs on ref_uuc_phc_list (U11) rather than being
    // retrofitted onto fact_uuc_phc_indicators: this view's meanings are what the XLSX dictionary
    // sheet is built from, so they are the only text still attached to a value once the file has
    // left the site and there is nobody to ask.
    for (const name of ["imr", "ufmr", "fic", "abr", "pre_natal", "sba", "water"]) {
      const column = columns.find(
        (c) => c.tableName === "ref_uuc_phc_list" && c.columnName === name,
      );
      expect(column?.meaning, name).toMatch(/NEVER AVERAGE THIS COLUMN/);
    }
    const capped = columns.find(
      (c) => c.tableName === "ref_uuc_phc_list" && c.columnName === "capped_indicators",
    );
    expect(capped?.meaning).toMatch(/NEVER AVERAGE THOSE COLUMNS/);
  });

  it("keeps the export view's route flags from being added together", () => {
    // ref_uuc_phc_list (U11) is the first relation to carry the four routes per barangay rather
    // than as counts, and a boolean column is the shape most likely to be summed. Every one says
    // so, on agg_uuc_phc_criteria's precedent.
    const table = uuc.find((r) => r.tableName === "ref_uuc_phc_list");
    expect(table?.notesMd).toMatch(/ROUTE FLAGS OVERLAP/);
    for (const name of ["route_ip", "route_conflict", "route_four_ps", "route_health"]) {
      const column = columns.find(
        (c) => c.tableName === "ref_uuc_phc_list" && c.columnName === name,
      );
      expect(column, name).toBeDefined();
      expect(column?.meaning, name).toMatch(/OVERLAP/);
    }
    // route_health without health_evaluable is the reading that turns "never asked" into "failed".
    const health = columns.find(
      (c) => c.tableName === "ref_uuc_phc_list" && c.columnName === "route_health",
    );
    expect(health?.meaning).toMatch(/health_evaluable/);
  });

  it("says a route flag is false for a missing value, not only for a low one", () => {
    // The three socio-economic routes read a null as 0, following agg_uuc_phc_criteria — which is
    // what makes the flags in a downloaded file add up to the counts /uuc-phc/criteria prints. The
    // per-barangay disclosure renders the same null as "—", so without this sentence a reader
    // comparing the two would think they disagree about 17 barangays.
    for (const name of ["route_ip", "route_conflict", "route_four_ps"]) {
      const column = columns.find(
        (c) => c.tableName === "ref_uuc_phc_list" && c.columnName === name,
      );
      expect(column?.meaning, name).toMatch(/FALSE WHERE THE VALUE BEHIND IT IS MISSING/);
    }
  });

  it("tells a caller how to scope the export view, since queryDataset cannot join", () => {
    // The whole reason this view is reachable at all: it is the only UUC relation carrying both
    // barangay values and the ancestor codes above them. A caller that does not know that will try
    // a geo_code prefix, which the Sulu remap makes wrong.
    const table = uuc.find((r) => r.tableName === "ref_uuc_phc_list");
    expect(table?.notesMd).toMatch(/region_code, province_code or citymun_code/);
    expect(table?.notesMd).toMatch(/never on a prefix of geo_code/);
  });

  it("says on agg_bhw_by_uuc_status that it is a check, not a finding — and on both sides", () => {
    // The one thing a model must not do with this table is report the average gap as a discovery.
    // UUC status is defined partly on distance to a health facility, so the gap is partly
    // definitional; and the compositional caveat has to travel with the households columns, since
    // a column meaning is the only text that reaches a returned value.
    const table = registry.find((r) => r.tableName === "agg_bhw_by_uuc_status");
    expect(table?.notesMd).toMatch(/CONSISTENCY CHECK, NOT A FINDING/);
    expect(table?.notesMd).toMatch(/EXCEPTION/);
    for (const name of ["listed_households", "other_households"]) {
      const column = columns.find(
        (c) => c.tableName === "agg_bhw_by_uuc_status" && c.columnName === name,
      );
      expect(column, name).toBeDefined();
      expect(column?.meaning, name).toMatch(/barangay size/i);
    }
  });

  it("tells a reader of agg_bhw_by_uuc_status what 'other' is, and what it is not", () => {
    // "Not listed" reads as "assessed and found adequate". Those barangays were never loaded, so
    // that group does not exist in this database at all.
    const column = columns.find(
      (c) => c.tableName === "agg_bhw_by_uuc_status" && c.columnName === "n_barangays_other",
    );
    expect(column?.meaning).toMatch(/EVERY OTHER barangay/);
    expect(column?.meaning).toMatch(/NOT assessed and found adequate/);
  });

  it("warns that a suppressed side is null, not zero, on every column that can be nulled", () => {
    const nullable = [
      "listed_n_bhw",
      "other_n_bhw",
      "listed_households",
      "other_households",
      "listed_registered_universe",
      "other_registered_universe",
      "listed_n_profiled",
      "other_n_profiled",
    ];
    for (const name of nullable) {
      const column = columns.find(
        (c) => c.tableName === "agg_bhw_by_uuc_status" && c.columnName === name,
      );
      expect(column, name).toBeDefined();
      expect(column?.meaning, name).toMatch(/NULL when|suppress/i);
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

  it("forbids deriving an average from the binned distributions, on the bins themselves", () => {
    // U9's equivalent of the capped_indicators case. A histogram is publishable where a mean is
    // not, but a bin midpoint weighted by bin_counts *is* a mean — the one way a model can walk
    // straight back into what U3 refused while believing it is reporting a distribution. The
    // warning has to be on the column a query returns, not only on the table.
    const table = registry.find((r) => r.tableName === "agg_uuc_phc_indicator_dist");
    expect(table?.notesMd).toMatch(/NO AVERAGE/);
    const bins = columns.find(
      (c) => c.tableName === "agg_uuc_phc_indicator_dist" && c.columnName === "bin_counts",
    );
    expect(bins).toBeDefined();
    expect(bins?.isQueryable).toBe(true);
    expect(bins?.meaning).toMatch(/DO NOT COMPUTE A MEAN/);
    // And bin_capped has to say it is a subset, or the two get added together.
    const capped = columns.find(
      (c) => c.tableName === "agg_uuc_phc_indicator_dist" && c.columnName === "bin_capped",
    );
    expect(capped?.meaning).toMatch(/subset of bin_counts/i);
  });

  it("says on n_worse that it is a count and must stay one", () => {
    // Evaluable denominators differ between areas for data-quality reasons, so a share of
    // worse-than-province invites a comparison across areas that the data cannot carry.
    const worse = columns.find(
      (c) => c.tableName === "agg_uuc_phc_indicator_dist" && c.columnName === "n_worse",
    );
    expect(worse?.meaning).toMatch(/never as a share/i);
  });

  it("keeps the barangay count and the value count apart on the data-quality totals", () => {
    // U10's central trap, and the one a model would fall into first: 1,584 values fall across
    // 1,397 barangays, so reporting the value count as a barangay count overstates the affected
    // share of the list by about 13%. Both columns say so, because a column meaning is the only
    // text that travels with a returned value.
    const brgy = columns.find(
      (c) => c.tableName === "ref_uuc_phc_quality" && c.columnName === "n_barangays_capped",
    );
    const values = columns.find(
      (c) => c.tableName === "ref_uuc_phc_quality" && c.columnName === "n_values_capped",
    );
    expect(brgy?.meaning).toMatch(/BARANGAYS/);
    expect(brgy?.meaning).toMatch(/NOT the number of bounded values/i);
    expect(values?.meaning).toMatch(/VALUES/);
  });

  it("says the recomputed criterion (d) columns are a measurement, never a score", () => {
    // The one place in this dataset where a derivation the docs warn against is performed on
    // purpose. If the dictionary does not say why, a reader of the column has every reason to
    // treat it as the score.
    const table = registry.find((r) => r.tableName === "ref_uuc_phc_quality");
    expect(table?.notesMd).toMatch(/MEASUREMENT OF A GAP, NEVER A SCORE/);
    const disagreement = columns.find(
      (c) => c.tableName === "ref_uuc_phc_quality" && c.columnName === "n_score_disagreement",
    );
    expect(disagreement?.meaning).toMatch(/NOT A CORRECTION/);
  });

  it("keeps the two benchmark findings from being added together", () => {
    // 226 barangays cannot support criterion (d) at all; a different 113 are affected on FIC
    // alone and remain evaluable on the other six indicators. Summing them to 339 would be wrong
    // in both directions at once.
    const finding = columns.find(
      (c) => c.tableName === "ref_uuc_phc_benchmark_gaps" && c.columnName === "finding",
    );
    expect(finding?.meaning).toMatch(/never added together/i);
    const table = registry.find((r) => r.tableName === "ref_uuc_phc_benchmark_gaps");
    expect(table?.notesMd).toMatch(/MUST NOT BE ADDED TOGETHER/);
  });

  it("marks the published-total gap as closed, and its absence as agreement", () => {
    // Two ways to misread this table now that the final-list alignment has emptied it: reading no
    // rows as no data rather than as the two sources agreeing, and reporting the reconciliation as
    // still open. It held the 5,991-vs-5,987 gap until the source office's final list closed it.
    const table = registry.find((r) => r.tableName === "ref_uuc_phc_published_delta");
    expect(table?.notesMd).toMatch(/EMPTY, AND EMPTY IS THE ANSWER/);
    expect(table?.notesMd).toMatch(/ABSENCE FROM A GEOGRAPHY MEANS THE TWO SOURCES AGREE/);
    const delta = columns.find(
      (c) => c.tableName === "ref_uuc_phc_published_delta" && c.columnName === "delta",
    );
    expect(delta?.meaning).toMatch(/Never zero/);
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
      (c) =>
        c.tableName === "agg_uuc_phc_counts" && ["n_listed", "n_barangays"].includes(c.columnName),
    );
    expect(counts.map((c) => c.role)).toEqual(["measure", "measure"]);
  });
});
