import { readFileSync, readdirSync } from "node:fs";
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
/** The 4.2 migration: where `kb_contradiction` and both document-side views are defined. */
const sql = readFileSync(MIGRATION, "utf8");

const MIGRATIONS_DIR = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));

/**
 * Every migration that defines `sweep_contradictions`, in the order the database applies them.
 *
 * The function is `create or replace`d, so the file that first created it stops describing what
 * runs the moment a later migration redefines it — and a test pinned to that first file goes on
 * passing, asserting about a body nothing executes. That is the same class of mistake as scanning
 * a migration for a string: the assertion still passes, and it has stopped meaning anything.
 * Guardrail assertions below therefore run against *every* definition (each one is live between
 * its own migration and the next), and behavioural assertions against the last.
 */
const sweepDefinitions = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => ({ file, sql: readFileSync(`${MIGRATIONS_DIR}${file}`, "utf8") }))
  .filter((migration) =>
    /create\s+or\s+replace\s+function\s+sweep_contradictions\s*\(/.test(migration.sql),
  );

/** The definition the database actually runs once every migration has been applied. */
const currentSweep = sweepDefinitions[sweepDefinitions.length - 1];

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

/**
 * The same source with `--` comments and `'…'` literals blanked to spaces, offsets preserved.
 *
 * Everything below reasons about where a keyword sits relative to a loop, and this migration's
 * comments talk about loops at length. Blanking rather than deleting keeps every index usable
 * against the original text.
 */
function blankCommentsAndLiterals(source: string): string {
  const out = source.split("");
  let i = 0;
  while (i < source.length) {
    if (source[i] === "-" && source[i + 1] === "-") {
      while (i < source.length && source[i] !== "\n") {
        out[i] = " ";
        i += 1;
      }
      continue;
    }
    if (source[i] === "'") {
      out[i] = " ";
      i += 1;
      while (i < source.length) {
        if (source[i] === "'") {
          out[i] = " ";
          // A doubled quote is an escaped quote, not the end of the literal.
          if (source[i + 1] === "'") {
            out[i + 1] = " ";
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        if (source[i] !== "\n") out[i] = " ";
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return out.join("");
}

type LoopBlock = { bodyStart: number; endStart: number };

/**
 * The loop opened at or after `from`, matched to its own `end loop`.
 *
 * `end loop` is matched ahead of the bare keyword in the same alternation, so the two never
 * collide, and nested loops are counted rather than assumed absent. This is what makes "inside the
 * candidate loop" and "after it" checkable claims rather than guesses about line order.
 */
function loopFrom(code: string, from: number): LoopBlock {
  const keyword = /\bend\s+loop\b|\bloop\b/g;
  keyword.lastIndex = from;
  let depth = 0;
  let bodyStart = -1;
  let match: RegExpExecArray | null;
  while ((match = keyword.exec(code)) !== null) {
    if (match[0].startsWith("end")) {
      depth -= 1;
      if (depth === 0) return { bodyStart, endStart: match.index };
    } else {
      if (depth === 0) bodyStart = match.index + match[0].length;
      depth += 1;
    }
  }
  throw new Error(`no matching "end loop" after offset ${from}`);
}

function offsetsOf(code: string, pattern: RegExp): number[] {
  return [...code.matchAll(pattern)].map((match) => match.index ?? -1);
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
    for (const definition of sweepDefinitions) {
      const templates = executeFormatTemplates(definition.sql);
      expect(templates.length, definition.file).toBeGreaterThan(0);
      for (const template of templates) {
        expect(template, definition.file).toContain("%I");
      }
    }
  });

  it("passes every value as a bound parameter, so no format string carries a %s at all", () => {
    // The row cap is a function parameter and could have been spliced with %s harmlessly. It is
    // bound instead so this assertion can be flat: identifiers through %I, values through USING,
    // nothing else. A flat rule is one a reviewer can check; "%s is fine when the value happens to
    // be an integer" is not.
    for (const definition of sweepDefinitions) {
      for (const template of executeFormatTemplates(definition.sql)) {
        expect(template, definition.file).not.toContain("%s");
      }
      expect(definition.sql, definition.file).toContain("using v_dist.geo_codes, p_max_rows");
      expect(definition.sql, definition.file).toContain("using v_dist.geo_level, p_max_rows");
    }
  });

  it("never concatenates a table or column name into a statement", () => {
    for (const { file, sql: source } of sweepDefinitions) {
      expect(source, file).not.toMatch(/execute\s+'[^']*'\s*\|\|/);
      expect(source, file).not.toMatch(/execute\s+v_best_table/);
      expect(source, file).not.toMatch(/execute\s+v_cand\./);
    }
  });
});

describe("sweep_contradictions(): guardrail 4, every probe is bounded", () => {
  it("caps every dynamic read", () => {
    for (const definition of sweepDefinitions) {
      const templates = executeFormatTemplates(definition.sql);
      expect(templates.length, definition.file).toBeGreaterThan(0);
      for (const template of templates) {
        expect(template, definition.file).toContain("limit $2");
      }
    }
  });

  it("sets its own statement timeout rather than inheriting one", () => {
    for (const { file, sql: source } of sweepDefinitions) {
      expect(source, file).toContain("set_config('statement_timeout', p_statement_timeout, true)");
    }
  });

  it("will not probe a table with more rows than there are geographies", () => {
    // A table holding at most one value per geography cannot have more rows than dim_geo does, so
    // this drops only candidates the uniqueness guard would reject anyway — while keeping the
    // sweep away from agg_demographics, whose 530,465 rows cost 3.4 seconds per probe.
    for (const { file, sql: source } of sweepDefinitions) {
      expect(source, file).toContain("coalesce(r.row_estimate, 0) <= v_geo_count");
    }
  });

  it("restricts each probe to the geographies the slide actually names", () => {
    for (const definition of sweepDefinitions) {
      for (const template of executeFormatTemplates(definition.sql)) {
        expect(
          template.includes("= any($1)") || template.includes("g.geo_level::text = $1"),
          definition.file,
        ).toBe(true);
      }
    }
  });
});

describe("sweep_contradictions(): what it is allowed to read", () => {
  it("reads only documents that have been approved", () => {
    // Both document-side views go through kb_doc_line, which joins doc_source on status.
    expect(sql).toContain("join doc_source d on d.doc_id = c.doc_id and d.status = 'approved'");
  });

  it("reads only registry rows and columns that have been approved", () => {
    for (const { file, sql: source } of sweepDefinitions) {
      expect(source, file).toContain("j.status = 'approved' and j.joins_to = 'dim_geo.geo_code'");
      expect(source, file).toContain("m.status = 'approved' and m.role = 'measure'");
      expect(source, file).toContain("where r.status = 'approved' and dc.status = 'approved'");
    }
  });

  it("takes a document figure's counterpart from a key's distinct count, never a row count", () => {
    // A count of things is a count of distinct keys. `row_estimate` counts the rows of a table
    // whose grain may be a grid, which is an artifact rather than a published quantity — the first
    // run paired a statute number against one. `row_estimate` survives in the migration only as
    // the candidate bound above, never as a value that can be contradicted.
    expect(sql).toContain("check (data_stat in ('cell', 'level_total', 'distinct_count'))");
    for (const { file, sql: source } of sweepDefinitions) {
      expect(source, file).toContain("dc.role = 'key' and dc.distinct_count is not null");
      expect(source, file).not.toContain("'row_estimate'::text as data_stat");
    }
  });

  it("pairs a standalone figure on the registry entry's name, not on its prose", () => {
    for (const { file, sql: source } of sweepDefinitions) {
      expect(source, file).toContain("r.title || ' ' || dc.column_name as label_text");
      expect(source, file).not.toContain(
        "r.title || ' ' || r.summary || ' ' || r.grain as label_text",
      );
    }
  });
});

describe("sweep_contradictions(): what it writes", () => {
  it("writes nothing that a person has not judged", () => {
    // `status` is absent from both insert column lists, so every row takes the column default.
    expect(sql).toContain("status text not null default 'auto'");
    for (const definition of sweepDefinitions) {
      const inserts = [
        ...definition.sql.matchAll(/insert into kb_contradiction as k \(([\s\S]*?)\)/g),
      ].map((m) => m[1]);
      expect(inserts.length, definition.file).toBeGreaterThan(0);
      for (const columns of inserts) {
        expect(columns, definition.file).not.toMatch(/\bstatus\b/);
      }
    }
  });

  it("keeps a judged row judged only while the two numbers it was judged on are unchanged", () => {
    for (const { file, sql: source } of sweepDefinitions) {
      expect(source, file).toContain(
        "status = case when k.doc_value = excluded.doc_value and k.data_value = excluded.data_value",
      );
      // And clears the note when they are not: a reason written about one pair of numbers must
      // not stand behind a different pair.
      expect(source, file).toContain("then k.review_note else null end");
    }
  });

  it("files nothing when the two figures agree", () => {
    // Corroboration is not what this queue is for, at either the cell level or the pairing level.
    expect(sql).toContain(
      "constraint kb_contradiction_values_differ check (doc_value <> data_value)",
    );
    for (const { file, sql: source } of sweepDefinitions) {
      expect(source, file).toContain("continue when v_data_value = v_dist.cell_values[i]");
    }
  });

  it("records the candidates that fitted equally well rather than hiding the tie-break", () => {
    for (const { file, sql: source } of sweepDefinitions) {
      expect(source, file).toContain("'tied_candidates', to_jsonb(v_ties)");
    }
  });

  it("carries an as-of date for each side", () => {
    // §8 4.2: "file each disagreement as a reviewable row carrying both values with their as-of
    // dates". Three sources, none invented — the document's own date, the phrase the slide states,
    // and the dataset's date from dim_dataset.
    expect(sql).toContain("doc_as_of date");
    expect(sql).toContain("doc_as_of_text text");
    for (const { file, sql: source } of sweepDefinitions) {
      expect(source, file).toContain("dd.as_of_date as data_as_of");
    }
  });

  it("is service-role only, with RLS enabled in the same statement block as the table", () => {
    expect(sql).toContain("alter table kb_contradiction enable row level security");
    expect(sql).toContain("revoke all on kb_doc_line from public, anon, authenticated");
    expect(sql).toContain("revoke all on kb_doc_label_number from public, anon, authenticated");
    // Every migration that redefines the function re-states the revoke, so a replacement can
    // never be the step that quietly hands it back.
    for (const { file, sql: source } of sweepDefinitions) {
      expect(source, file).not.toMatch(/create policy/i);
      expect(source, file).toContain(
        "revoke all on function sweep_contradictions(numeric, numeric, integer, numeric, integer, text) from public, anon, authenticated",
      );
    }
  });

  it("never touches exposure", () => {
    // Guardrail 5. The sweep reads internal tables (fact_bhw_raw is one) and quotes internal budget
    // material; it must not be able to move either onto a public surface.
    expect(sql).not.toMatch(/exposure\s*=/);
    for (const { file, sql: source } of sweepDefinitions) {
      expect(source, file).not.toMatch(/exposure\s*=/);
    }
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

describe("sweep_contradictions(): corroboration suppresses the slide, not just the candidate", () => {
  /**
   * The defect the 2026-08-28 re-run found, and the reason this suite parses rather than scans.
   *
   * The geographic pass discards a candidate fitting every cell, because corroboration is not what
   * this queue is for. Written as a `continue`, that discards **the candidate, not the slide**: a
   * slide whose true counterpart agrees everywhere falls through to the best-fitting column that
   * *disagrees*, which for a corroborated slide is necessarily a different measure. Cue-cards p37
   * and its repeat at slide 141 filed ten rows against `agg_uuc_phc_criteria.n_health_evaluable` —
   * a subset of the listed count — the moment the data improved enough for four columns to agree
   * on all 17 regions.
   *
   * What makes this checkable only by parsing is the ordering. Candidates are iterated
   * `order by 1, 3`, so the corroborating one is often probed *after* a disagreeing one has already
   * been recorded as the best fit. A guard that assumes the perfect fit arrives first is wrong, and
   * a guard placed inside the candidate loop cannot see the ones that come later. Only the position
   * of the read — after the loop, before anything is filed — distinguishes the two, and position is
   * not something a string scan can assert about.
   */

  const code = blankCommentsAndLiterals(currentSweep.sql);
  const distributionLoop = loopFrom(code, code.indexOf("for v_dist in"));
  const candidateLoopStart = code.indexOf("for v_cand in");
  const candidateLoop = loopFrom(code, candidateLoopStart);

  const setsTrue = offsetsOf(code, /\bv_corroborated\s*:=\s*true\b/g);
  const setsFalse = offsetsOf(code, /\bv_corroborated\s*:=\s*false\b/g);
  const reads = offsetsOf(code, /\bv_corroborated\b(?!\s*:=)/g);

  it("nests the candidate loop inside the distribution loop, which is what the rest assumes", () => {
    expect(candidateLoopStart).toBeGreaterThan(distributionLoop.bodyStart);
    expect(candidateLoop.endStart).toBeLessThan(distributionLoop.endStart);
  });

  it("records a perfect fit as a fact about the slide, from inside the candidate loop", () => {
    // `v_fit >= 1.0` can only hold when the candidate carried a value for every geography the
    // slide names and agreed on all of them — the coverage guard makes it strictly stronger than
    // "agreed wherever it had a value". That is corroboration of the distribution itself.
    const perfectFit = offsetsOf(code, /v_fit\s*>=\s*1(\.0)?\b/g);
    expect(perfectFit).toHaveLength(1);
    expect(perfectFit[0]).toBeGreaterThan(candidateLoop.bodyStart);
    expect(perfectFit[0]).toBeLessThan(candidateLoop.endStart);

    expect(setsTrue).toHaveLength(1);
    expect(setsTrue[0]).toBeGreaterThan(candidateLoop.bodyStart);
    expect(setsTrue[0]).toBeLessThan(candidateLoop.endStart);
  });

  it("reads that fact after the candidate loop, so probe order cannot defeat it", () => {
    // The assertion that matters. A read *inside* the loop would only suppress candidates probed
    // after the corroborating one; a read after it sees every candidate, whichever order they came
    // in. This is the difference between the fix and a fix-shaped bug.
    const afterLoop = reads.filter(
      (at) => at > candidateLoop.endStart && at < distributionLoop.endStart,
    );
    expect(afterLoop.length).toBeGreaterThan(0);
    expect(
      reads.filter((at) => at > candidateLoop.bodyStart && at < candidateLoop.endStart),
    ).toEqual([]);
  });

  it("suppresses the cell rows and the level_total together", () => {
    // A corroborated slide's total row would compare the slide's own cells against a *different*
    // column's level-wide total — the runner-up's, since the label and the total probe both read
    // the winning candidate. That is the same mispairing restated, not a scope finding, so the
    // guard has to stand ahead of both inserts rather than only the cell one.
    const guard = Math.min(
      ...reads.filter((at) => at > candidateLoop.endStart && at < distributionLoop.endStart),
    );
    const inserts = offsetsOf(code, /insert into kb_contradiction\b/g).filter(
      (at) => at > distributionLoop.bodyStart && at < distributionLoop.endStart,
    );
    // One for the differing cells, one for the level total.
    expect(inserts).toHaveLength(2);
    for (const insert of inserts) {
      expect(insert).toBeGreaterThan(guard);
    }
  });

  it("clears the flag per distribution, not once per sweep", () => {
    // Left set from a previous slide it would silence every slide after the first corroborated
    // one — a failure that a run over a corpus whose first slide is corroborated reports as
    // "nothing to file", which looks exactly like success.
    expect(setsFalse).toHaveLength(1);
    expect(setsFalse[0]).toBeGreaterThan(distributionLoop.bodyStart);
    expect(setsFalse[0]).toBeLessThan(candidateLoopStart);
  });

  it("leaves the fit floor a separate question from corroboration", () => {
    // p_min_fit still gates a *disagreeing* candidate, and still does so on its own. The re-run
    // entry argued the floor is not what was wrong here, and the measured fits say so precisely:
    // the ten false rows sat at 0.7647 and slide 161's genuine three-cell case sits at 0.6667, so
    // no floor separates them. Suppression had to come from corroboration instead.
    expect(currentSweep.sql).toContain("p_min_fit numeric default 0.5");
    const floor = offsetsOf(code, /v_fit\s*<\s*p_min_fit\b/g);
    expect(floor).toHaveLength(1);
    expect(floor[0]).toBeGreaterThan(candidateLoop.bodyStart);
    expect(floor[0]).toBeLessThan(candidateLoop.endStart);
  });
});
