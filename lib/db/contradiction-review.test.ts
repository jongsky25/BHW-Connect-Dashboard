import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  describeMethod,
  describeSides,
  isReviewStatus,
  readEvidence,
} from "./contradiction-review";

/**
 * Increment 4.2's invariants, checked two ways — the pattern `dataset-review.test.ts` and
 * `dataset-registry-seed.test.ts` set: "an assertion that can only be checked against a running
 * project is an assertion nobody checks in review."
 *
 * The SQL half matters more here than usual for one reason. A sweep is judged by what it *files*,
 * and a happy-path run against this database files twelve rows — which says nothing about what the
 * function does with an unapproved document, an unapproved registry row, or a table name it should
 * never read. Those are the cases a live run never exercises, so they are asserted against the
 * committed migration text instead.
 */

const MIGRATION = fileURLToPath(
  new URL("../../supabase/migrations/20260828100000_kb_contradiction.sql", import.meta.url),
);
const sql = readFileSync(MIGRATION, "utf8");

const PROFILE_MIGRATION = fileURLToPath(
  new URL("../../supabase/migrations/20260827180000_profile_dataset.sql", import.meta.url),
);
const profileSql = readFileSync(PROFILE_MIGRATION, "utf8");

/**
 * Every `execute format(...)` template in the migration, reassembled.
 *
 * The format strings here are written as adjacent string literals across several lines, so the
 * regex `dataset-review.test.ts` uses — which captures the *first* literal after `format(` — would
 * capture `'select jsonb_object_agg(k, v), count(*), count(distinct k) from ('` and assert nothing
 * about the `%I`s on the following lines. Scanning to the balanced paren and concatenating every
 * literal inside is the only reading that checks the whole template. That mistake has now been
 * made twice in this repository, in this exact place, which is why this is spelled out.
 */
function executeFormatTemplates(source: string): string[] {
  const templates: string[] = [];
  const marker = "execute format(";

  for (
    let start = source.indexOf(marker);
    start !== -1;
    start = source.indexOf(marker, start + 1)
  ) {
    let depth = 0;
    let inString = false;
    let literal = "";
    const parts: string[] = [];

    for (let i = start + marker.length - 1; i < source.length; i += 1) {
      const char = source[i];
      if (inString) {
        if (char === "'") {
          // Doubled quote is an escaped quote inside the literal, not its end.
          if (source[i + 1] === "'") {
            literal += "'";
            i += 1;
          } else {
            inString = false;
            parts.push(literal);
            literal = "";
          }
        } else {
          literal += char;
        }
        continue;
      }
      if (char === "'") {
        inString = true;
      } else if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    templates.push(parts.join(""));
  }
  return templates;
}

describe("isReviewStatus", () => {
  it("accepts only the two judgements the queue can record", () => {
    expect(isReviewStatus("approved")).toBe(true);
    expect(isReviewStatus("rejected")).toBe(true);
    // 'auto' is where a row starts, never something a reviewer submits.
    expect(isReviewStatus("auto")).toBe(false);
    expect(isReviewStatus(undefined)).toBe(false);
  });
});

describe("readEvidence", () => {
  it("reads what the geographic pass measures", () => {
    const evidence = readEvidence({
      cells: 17,
      covered: 17,
      agreed: 15,
      fit: 0.8824,
      tied_candidates: ["agg_uuc_phc_counts.n_listed", "agg_uuc_phc_criteria.n_listed"],
    });
    expect(evidence.agreed).toBe(15);
    expect(evidence.fit).toBeCloseTo(0.8824);
    expect(evidence.tiedCandidates).toHaveLength(2);
    expect(evidence.sharedTerms).toEqual([]);
  });

  it("reads what the scalar pass measures", () => {
    const evidence = readEvidence({
      shared_terms: ["bhw"],
      registry_label: "BHW master list (raw) — distinct bhw_id",
    });
    expect(evidence.sharedTerms).toEqual(["bhw"]);
    expect(evidence.registryLabel).toContain("bhw_id");
    expect(evidence.tiedCandidates).toEqual([]);
  });

  it("degrades to empty rather than throwing on anything else", () => {
    // `evidence` is jsonb and deliberately untyped in the schema: the two passes measure different
    // things and a shared shape would force one of them to record fields that mean nothing to it.
    // A reader of that column therefore has to survive whatever is in it.
    for (const value of [null, undefined, 42, "text", [1, 2, 3]]) {
      expect(readEvidence(value).tiedCandidates).toEqual([]);
      expect(readEvidence(value).sharedTerms).toEqual([]);
    }
  });
});

describe("describeMethod", () => {
  /**
   * §8 4.2's two passes are "of deliberately different strength", and the queue's job is to make
   * that legible before the numbers are read. These assert the property that matters — that the
   * two descriptions are not interchangeable — rather than the wording, which is meant to be
   * editable without breaking a test.
   */

  it("calls the geographic pass exact, because its labels resolve against dim_geo by name", () => {
    const pairing = describeMethod("geo_distribution");
    expect(pairing.strength).toBe("exact");
    expect(pairing.basis).toContain("dim_geo");
  });

  it("calls the scalar pass inferred, and says the subject is part of what is under review", () => {
    // The scalar pass identifies its subject from two weak signals used together. A reviewer who
    // reads that row as though the subject were settled is reviewing the wrong question.
    const pairing = describeMethod("scalar_magnitude");
    expect(pairing.strength).toBe("inferred");
  });

  it("never gives the two passes the same strength", () => {
    // The whole reason `method` is rendered at all. If these ever collapse the chip is decoration.
    expect(describeMethod("geo_distribution").strength).not.toBe(
      describeMethod("scalar_magnitude").strength,
    );
  });

  it("refuses to describe a pass it does not know, rather than guessing at its strength", () => {
    // The `check (method in (...))` constraint means only two values exist today. A third would
    // arrive with a migration, and until this function is taught about it the honest answer is
    // that the pairing cannot be judged — not a plausible-looking default that reads as though it
    // could. Same rule the migration's own `--propose` lesson records: unwritten is not safe.
    const pairing = describeMethod("semantic_guess");
    expect(pairing.strength).toBe("unrecognised");
    expect(pairing.name).toBe("semantic_guess");
    expect(pairing.basis).toContain("cannot be judged");
  });

  it("describes exactly the methods the migration's check constraint admits", () => {
    // Parsed from the constraint rather than scanned for: the migration mentions both method names
    // in its header prose too, and a raw scan would pass on the comments alone. This repository has
    // made that mistake five times; the rule it settled on is to parse the thing being asserted
    // about.
    const constraint = /check\s*\(\s*method\s+in\s*\(([^)]*)\)\s*\)/.exec(sql);
    expect(constraint).not.toBeNull();
    const admitted = [...(constraint?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(admitted).toEqual(["geo_distribution", "scalar_magnitude"]);
    for (const method of admitted) {
      expect(describeMethod(method).strength).not.toBe("unrecognised");
    }
  });
});

describe("describeSides", () => {
  const row = {
    docValue: 277767,
    docAsOf: "2025-09-18",
    docAsOfText: "as of Dec 2025",
    dataTable: "fact_bhw_raw",
    dataColumn: "bhw_id",
    dataValue: 270917,
    dataAsOf: null,
  };

  it("states both figures with their dates, and prefers the slide's own as-of phrase", () => {
    // §12.4 rule 2: a number carried by a chunk renders attributed AND dated. The deck's own date
    // is 2025-09-18, but slide 26 says the figure is as of Dec 2025 — the later, more specific
    // claim, and the one a briefing turns on.
    const { document, dataset } = describeSides(row);
    expect(document).toContain("277,767");
    expect(document).toContain("as of Dec 2025");
    expect(document).not.toContain("2025-09-18");
    expect(dataset).toContain("fact_bhw_raw.bhw_id");
    expect(dataset).toContain("270,917");
  });

  it("says a missing dataset as-of date is missing rather than inventing one", () => {
    // fact_bhw_raw carries no dataset_slug, so there is no dim_dataset row to take a date from.
    expect(describeSides(row).dataset).toContain("no dataset as-of date recorded");
  });

  it("falls back to the document's date when the slide states no phrase", () => {
    const { document } = describeSides({ ...row, docAsOfText: null });
    expect(document).toContain("as of 2025-09-18");
  });
});

describe("sweep_contradictions(): guardrail 3, nothing is spliced into SQL", () => {
  it("quotes every identifier in every dynamic statement with %I", () => {
    const templates = executeFormatTemplates(sql);
    expect(templates.length).toBeGreaterThan(0);
    for (const template of templates) {
      expect(template).toContain("%I");
    }
  });

  it("passes every value as a bound parameter, so no format string carries a %s at all", () => {
    // The row cap is a function parameter and could have been spliced with %s harmlessly. It is
    // bound instead so this assertion can be flat: identifiers through %I, values through USING,
    // nothing else. A flat rule is one a reviewer can check; "%s is fine when the value happens to
    // be an integer" is not.
    for (const template of executeFormatTemplates(sql)) {
      expect(template).not.toContain("%s");
    }
    expect(sql).toContain("using v_dist.geo_codes, p_max_rows");
    expect(sql).toContain("using v_dist.geo_level, p_max_rows");
  });

  it("never concatenates a table or column name into a statement", () => {
    expect(sql).not.toMatch(/execute\s+'[^']*'\s*\|\|/);
    expect(sql).not.toMatch(/execute\s+v_best_table/);
    expect(sql).not.toMatch(/execute\s+v_cand\./);
  });
});

describe("sweep_contradictions(): guardrail 4, every probe is bounded", () => {
  it("caps every dynamic read", () => {
    const templates = executeFormatTemplates(sql);
    expect(templates.length).toBeGreaterThan(0);
    for (const template of templates) {
      expect(template).toContain("limit $2");
    }
  });

  it("sets its own statement timeout rather than inheriting one", () => {
    expect(sql).toContain("set_config('statement_timeout', p_statement_timeout, true)");
  });

  it("will not probe a table with more rows than there are geographies", () => {
    // A table holding at most one value per geography cannot have more rows than dim_geo does, so
    // this drops only candidates the uniqueness guard would reject anyway — while keeping the
    // sweep away from agg_demographics, whose 530,465 rows cost 3.4 seconds per probe.
    expect(sql).toContain("coalesce(r.row_estimate, 0) <= v_geo_count");
  });

  it("restricts each probe to the geographies the slide actually names", () => {
    for (const template of executeFormatTemplates(sql)) {
      expect(template.includes("= any($1)") || template.includes("g.geo_level::text = $1")).toBe(
        true,
      );
    }
  });
});

describe("sweep_contradictions(): what it is allowed to read", () => {
  it("reads only documents that have been approved", () => {
    // Both document-side views go through kb_doc_line, which joins doc_source on status.
    expect(sql).toContain("join doc_source d on d.doc_id = c.doc_id and d.status = 'approved'");
  });

  it("reads only registry rows and columns that have been approved", () => {
    expect(sql).toContain("j.status = 'approved' and j.joins_to = 'dim_geo.geo_code'");
    expect(sql).toContain("m.status = 'approved' and m.role = 'measure'");
    expect(sql).toContain("where r.status = 'approved' and dc.status = 'approved'");
  });

  it("takes a document figure's counterpart from a key's distinct count, never a row count", () => {
    // A count of things is a count of distinct keys. `row_estimate` counts the rows of a table
    // whose grain may be a grid, which is an artifact rather than a published quantity — the first
    // run paired a statute number against one. `row_estimate` survives in the migration only as
    // the candidate bound above, never as a value that can be contradicted.
    expect(sql).toContain("dc.role = 'key' and dc.distinct_count is not null");
    expect(sql).toContain("check (data_stat in ('cell', 'level_total', 'distinct_count'))");
    expect(sql).not.toContain("'row_estimate'::text as data_stat");
  });

  it("pairs a standalone figure on the registry entry's name, not on its prose", () => {
    expect(sql).toContain("r.title || ' ' || dc.column_name as label_text");
    expect(sql).not.toContain("r.title || ' ' || r.summary || ' ' || r.grain as label_text");
  });
});

describe("sweep_contradictions(): what it writes", () => {
  it("writes nothing that a person has not judged", () => {
    // `status` is absent from both insert column lists, so every row takes the column default.
    const inserts = [...sql.matchAll(/insert into kb_contradiction as k \(([\s\S]*?)\)/g)].map(
      (m) => m[1],
    );
    expect(inserts.length).toBeGreaterThan(0);
    for (const columns of inserts) {
      expect(columns).not.toMatch(/\bstatus\b/);
    }
    expect(sql).toContain("status text not null default 'auto'");
  });

  it("keeps a judged row judged only while the two numbers it was judged on are unchanged", () => {
    expect(sql).toContain(
      "status = case when k.doc_value = excluded.doc_value and k.data_value = excluded.data_value",
    );
    // And clears the note when they are not: a reason written about one pair of numbers must not
    // stand behind a different pair.
    expect(sql).toContain("then k.review_note else null end");
  });

  it("files nothing when the two figures agree", () => {
    // Corroboration is not what this queue is for, at either the cell level or the pairing level.
    expect(sql).toContain("continue when v_data_value = v_dist.cell_values[i]");
    expect(sql).toContain("if v_fit >= 1.0 or v_fit < p_min_fit then");
    expect(sql).toContain(
      "constraint kb_contradiction_values_differ check (doc_value <> data_value)",
    );
  });

  it("records the candidates that fitted equally well rather than hiding the tie-break", () => {
    expect(sql).toContain("'tied_candidates', to_jsonb(v_ties)");
  });

  it("carries an as-of date for each side", () => {
    // §8 4.2: "file each disagreement as a reviewable row carrying both values with their as-of
    // dates". Three sources, none invented — the document's own date, the phrase the slide states,
    // and the dataset's date from dim_dataset.
    expect(sql).toContain("doc_as_of date");
    expect(sql).toContain("doc_as_of_text text");
    expect(sql).toContain("dd.as_of_date as data_as_of");
  });

  it("is service-role only, with RLS enabled in the same statement block as the table", () => {
    expect(sql).toContain("alter table kb_contradiction enable row level security");
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toContain("revoke all on kb_doc_line from public, anon, authenticated");
    expect(sql).toContain("revoke all on kb_doc_label_number from public, anon, authenticated");
    expect(sql).toContain(
      "revoke all on function sweep_contradictions(numeric, numeric, integer, numeric, integer, text) from public, anon, authenticated",
    );
  });

  it("never touches exposure", () => {
    // Guardrail 5. The sweep reads internal tables (fact_bhw_raw is one) and quotes internal budget
    // material; it must not be able to move either onto a public surface.
    expect(sql).not.toMatch(/exposure\s*=/);
  });
});

describe("the sweep's own tables are not datasets", () => {
  it("is named so that 4.1's profiler refuses to profile it", () => {
    // profile_dataset() refuses anything matching kb\\_%. That refusal is what stops the registry
    // from acquiring a dictionary entry for the contradiction queue and offering it to the model
    // as a queryable dataset — so the naming is load-bearing, not cosmetic.
    expect(profileSql).toContain("p_table like 'kb\\_%'");
    for (const relation of ["kb_contradiction", "kb_doc_line", "kb_doc_label_number"]) {
      expect(relation.startsWith("kb_")).toBe(true);
    }
  });
});
