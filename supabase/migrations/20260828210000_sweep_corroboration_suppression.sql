-- The contradiction sweep: corroboration suppresses the slide, not just the candidate
-- (docs/AI_ASSISTANT_PLAN.md §8, Increment 4.2).
--
-- 20260828100000_kb_contradiction.sql built the sweep. This replaces one function in it, for a
-- defect that only a data change could expose and that the 2026-08-28 re-run exposed.
--
-- WHAT WAS WRONG. The geographic pass probes every approved (table, measure column) candidate for
-- a slide that lists geographies against numbers and keeps the best-fitting one. A candidate
-- fitting every cell was treated as corroboration and skipped — but the skip was a `continue`,
-- which discards *the candidate*, not *the slide*. So when a slide's true structured counterpart
-- is found and agrees on every cell, the pass does not conclude "this slide is corroborated"; it
-- concludes "this column is uninteresting" and keeps looking. Whatever it settles on next is, by
-- construction, the best-fitting column that DISAGREES — and for a slide whose counterpart agrees
-- everywhere, a column that disagrees is a column measuring something else.
--
-- That is not hypothetical. The UUC final-list alignment moved
-- `agg_bhw_by_uuc_status.n_barangays_listed` to agree with cue-cards p37 on all 17 regions. The
-- three real p37 rows resolved, exactly as predicted — and the slide fell through to
-- `agg_uuc_phc_criteria.n_health_evaluable` at 13 of 17, filing five rows on p37 and five more on
-- its repeat at slide 141. `n_health_evaluable` is a SUBSET of the listed count: it equals it in 13
-- regions and differs in exactly the four holding the 226 barangays whose provincial benchmarks
-- cannot support criterion (d). The registry's own `meaning` for the column says so — "n_listed
-- minus this is the excluded count" — and the pass cannot read it, because 4.2's own rule, arrived
-- at after a statute number was paired with a row count on four slides, is that the pairing
-- vocabulary is an entry's NAME, not its prose.
--
-- So the sweep's precision fell as the data improved. Correcting the data turned three true
-- findings into ten false ones.
--
-- WHAT THIS CHANGES. Once any candidate corroborates a slide's distribution, that distribution is
-- accounted for and no weaker-fitting column is filed against it. The perfect fit now suppresses
-- the whole (chunk, geo_level) group — its cell rows and its level_total alike — rather than
-- suppressing itself and handing the slide to the runner-up.
--
-- THE GUARD HOLDS REGARDLESS OF PROBE ORDER, which is the part that is easy to get wrong.
-- Candidates are iterated `order by 1, 3`, so a corroborating candidate is often probed *after* a
-- disagreeing one has already been recorded as the best fit. A check made at the moment of insert
-- — "has a perfect fit been seen for this slide?" — is therefore the only correct shape; a check
-- that assumes the perfect fit arrives first is not. `v_corroborated` is that check: set anywhere
-- in the candidate loop, read after it, and reset per distribution.
--
-- WHY THE LEVEL_TOTAL GOES TOO. A corroborated slide's total row would be the slide's own cells
-- summed against a *different* column's level-wide total — the runner-up's, since the label and
-- the total probe both read the winning candidate. That is not a scope finding, it is the same
-- mispairing restated over 17 cells at once. The reading where a corroborated slide can still have
-- an interesting total — the table covers geographies the slide does not list — is real, but it is
-- a comparison against the CORROBORATING column, which this function has never computed and does
-- not compute here. Filing the runner-up's total in its place would be worse than filing nothing.
--
-- NOT CHANGED: `p_min_fit`. The re-run entry argues the floor is not what is wrong, and the fits
-- say so precisely — the ten false rows sat at 0.7647 and slide 161's genuine three-cell case sits
-- at 0.6667, so the false rows fit BETTER than the true one and no floor separates them. A floor
-- is a statement about how much disagreement is worth reading; this defect is about a slide whose
-- disagreement had already been explained away. See DECISIONS.md.
--
-- Everything else about the pass is untouched: same candidate set, same probes, same evidence,
-- same guardrails. Identifiers go through `format('%I')`, values through `USING`, no `%s` appears
-- in any dynamic statement, every probe is capped and the function sets its own statement timeout.

create or replace function sweep_contradictions(
  -- Below this, a standalone figure in prose is not worth pairing on magnitude: page numbers,
  -- item counts and small enumerations dominate, and the false-pair rate swamps the queue. The
  -- geographic pass has no floor — its identification comes from the label, not the size.
  p_min_value numeric default 1000,
  -- Two values further apart than this are two different quantities, not two measurements of one.
  p_rel_tolerance numeric default 0.10,
  -- Fewer resolved geographies than this is not a distribution, it is a coincidence.
  p_min_cells integer default 3,
  -- A structured column agreeing with fewer than this share of the slide's cells is a different
  -- measure, not a disagreeing one.
  p_min_fit numeric default 0.5,
  -- Guardrail 4. Applies to every probe of a registered table, passed as a bound parameter so no
  -- `%s` appears in any format string and guardrail 3's rule is a flat one: identifiers go through
  -- `%I`, values go through `USING`, and nothing else is spliced.
  p_max_rows integer default 5000,
  p_statement_timeout text default '60s'
)
returns table (
  found_by text,
  finding text,
  slide integer,
  scope text,
  document_value numeric,
  dataset_ref text,
  dataset_value numeric,
  relative_difference numeric,
  stat text
)
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
declare
  v_swept_at timestamptz := now();
  v_generic text[] := kb_generic_terms();
  v_dist record;
  v_cand record;
  v_map jsonb;
  v_rows bigint;
  v_distinct_keys bigint;
  v_covered integer;
  v_matched integer;
  v_fit numeric;
  v_best_fit numeric;
  v_best record;
  v_ties text[];
  v_cell record;
  v_data_value numeric;
  v_doc_total numeric;
  v_data_total numeric;
  v_total_rows bigint;
  v_total_keys bigint;
  v_label text;
  v_best_table text;
  v_best_column text;
  v_best_join text;
  v_best_as_of date;
  v_best_covered integer;
  v_best_matched integer;
  v_geo_count bigint;
  -- Set when some candidate agrees with this slide on every cell it lists. Read after the
  -- candidate loop, never during it: candidates are iterated `order by 1, 3`, so the corroborating
  -- one may well be probed after a disagreeing one has already been recorded as the best fit, and
  -- a guard that assumes the perfect fit arrives first would file that disagreement anyway.
  v_corroborated boolean;
begin
  perform set_config('statement_timeout', p_statement_timeout, true);
  select count(*) into v_geo_count from dim_geo;

  -- =========================================================================================
  -- Pass 1 — geographic distributions.
  -- =========================================================================================
  --
  -- `as materialized` is load-bearing, not decoration. A plpgsql FOR-over-query runs as a cursor,
  -- and a cursor is planned for a fast first row (`cursor_tuple_fraction`), which flipped the join
  -- below from a hash join over 268 label rows into a nested loop that re-derived the label view
  -- once per row of dim_geo. Same answer, 54 seconds instead of one. Materializing the label rows
  -- fixes the join order by taking the choice away.
  for v_dist in
    with labels as materialized (
      select l.chunk_id, l.doc_id, l.page_from, l.doc_as_of, l.ord, l.label, l.value
      from kb_doc_label_number l
    ),
    resolved as materialized (
      select p.chunk_id, p.doc_id, p.page_from, p.doc_as_of, p.ord,
             g.geo_code, g.geo_level::text as geo_level, p.value
      from labels p
      join dim_geo g
        on upper(regexp_replace(btrim(g.geo_name), '\s+', ' ', 'g')) = p.label
    ),
    -- A slide may repeat a geography (a two-column table). Keep its first mention only, so the
    -- comparison is against a value the slide states once.
    deduped as materialized (
      select distinct on (chunk_id, geo_level, geo_code) *
      from resolved
      order by chunk_id, geo_level, geo_code, ord
    )
    select d.chunk_id, d.doc_id, d.page_from, d.doc_as_of, d.geo_level,
           count(*)::integer as cells,
           array_agg(geo_code order by ord) as geo_codes,
           array_agg(value order by ord) as cell_values,
           sum(value) as doc_total,
           bool_and(value = trunc(value)) as all_integers,
           (select c.heading from doc_chunk c where c.chunk_id = d.chunk_id) as heading
    from deduped d
    group by d.chunk_id, d.doc_id, d.page_from, d.doc_as_of, d.geo_level
    having count(*) >= p_min_cells
    order by d.chunk_id
  loop
    v_best_fit := null;
    v_best_table := null;
    v_best_column := null;
    v_best_join := null;
    v_best_as_of := null;
    v_best_covered := 0;
    v_best_matched := 0;
    v_ties := '{}'::text[];
    -- Per distribution, not per sweep. Left set from a previous slide it would silence every
    -- slide after the first corroborated one.
    v_corroborated := false;

    -- Candidates: every approved measure column on an approved table that joins to dim_geo. The
    -- registry is the allowlist; `role = 'measure'` is the registry's own rule that this is a
    -- column a stated number may come from. When the slide's cells are all whole numbers, only
    -- integer-typed measures are considered — a percentage column is not a candidate for a table
    -- of counts, and saying so here removes most of the probes.
    for v_cand in
      select distinct r.table_name, j.column_name as join_col, m.column_name as measure_col,
             dd.as_of_date as data_as_of
      from dataset_registry r
      join dataset_column j
        on j.registry_id = r.registry_id and j.status = 'approved' and j.joins_to = 'dim_geo.geo_code'
      join dataset_column m
        on m.registry_id = r.registry_id and m.status = 'approved' and m.role = 'measure'
      left join dim_dataset dd on dd.slug = r.dataset_slug
      where r.status = 'approved'
        -- Necessary condition rather than a heuristic: a table holding at most one value per
        -- geography cannot have more rows than there are geographies. Every candidate this drops
        -- is one the uniqueness guard below would reject anyway, so nothing is lost — and it is
        -- what keeps the sweep away from agg_demographics (530,465 rows, twenty-odd per
        -- geography), whose probe alone costs 3.4 seconds. Guardrail 4 satisfied by arithmetic
        -- over the registry rather than by a blacklist of table names.
        and coalesce(r.row_estimate, 0) <= v_geo_count
        and m.data_type in ('smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision')
        and (not v_dist.all_integers
             or m.data_type in ('smallint', 'integer', 'bigint'))
      order by 1, 3
    loop
      begin
        execute format(
          'select jsonb_object_agg(k, v), count(*), count(distinct k) from ('
          '  select t.%I::text as k, t.%I::numeric as v from %I t'
          '  where t.%I = any($1) and t.%I is not null limit $2'
          ') s',
          v_cand.join_col, v_cand.measure_col, v_cand.table_name,
          v_cand.join_col, v_cand.measure_col
        )
        into v_map, v_rows, v_distinct_keys
        using v_dist.geo_codes, p_max_rows;
      exception when others then
        v_map := null; v_rows := 0; v_distinct_keys := 0;
      end;

      -- More rows than geographies means this table holds several values per geography at this
      -- level (one per indicator, per category, per year). Which of them the slide is quoting is
      -- not decidable from the numbers, so the candidate is skipped rather than guessed at. This
      -- is the guard that keeps agg_demographics and agg_cohorts out without naming them.
      continue when v_map is null or v_rows = 0 or v_rows <> v_distinct_keys;

      v_covered := 0;
      v_matched := 0;
      for i in 1 .. v_dist.cells loop
        if v_map ? v_dist.geo_codes[i] then
          v_covered := v_covered + 1;
          if (v_map ->> v_dist.geo_codes[i])::numeric = v_dist.cell_values[i] then
            v_matched := v_matched + 1;
          end if;
        end if;
      end loop;

      -- The structured side must have a value for most of what the slide lists, or it is a
      -- different population rather than a different count of the same one.
      continue when v_covered * 4 < v_dist.cells * 3;

      v_fit := round(v_matched::numeric / v_dist.cells, 4);

      -- A perfect fit is corroboration, and corroboration is not what this queue is for — but it
      -- is a fact about THE SLIDE, not about this candidate. `v_fit >= 1.0` requires v_matched to
      -- equal every cell the slide lists, which the coverage guard above makes strictly stronger
      -- than "agreed wherever it had a value": the candidate carries a value for every one of the
      -- slide's geographies and agrees on all of them. That distribution is accounted for, so no
      -- weaker-fitting column may be filed against it, and there is nothing left to learn from
      -- probing the rest.
      if v_fit >= 1.0 then
        v_corroborated := true;
        exit;
      end if;

      continue when v_fit < p_min_fit;

      if v_best_fit is null or v_fit > v_best_fit then
        v_best_fit := v_fit;
        v_best_table := v_cand.table_name;
        v_best_column := v_cand.measure_col;
        v_best_join := v_cand.join_col;
        v_best_as_of := v_cand.data_as_of;
        v_best_covered := v_covered;
        v_best_matched := v_matched;
        v_ties := '{}'::text[];
      elsif v_fit = v_best_fit then
        -- Recorded rather than resolved. Several tables can legitimately carry the same measure,
        -- and a reviewer who is not told that is reviewing an arbitrary choice.
        v_ties := v_ties || (v_cand.table_name || '.' || v_cand.measure_col);
      end if;
    end loop;

    -- Read here rather than at the top of the candidate loop: this is the moment the slide would
    -- be filed, and it is the only place where "was this slide corroborated by anything?" is a
    -- settled question. Suppresses the cell rows and the level_total together — see the header for
    -- why the total does not survive its own slide's corroboration.
    continue when v_corroborated or v_best_fit is null;

    v_label := format('%s per %s: %s vs %s.%s',
                      coalesce(v_dist.heading, 'slide ' || v_dist.page_from),
                      v_dist.geo_level,
                      'cue-card slide ' || v_dist.page_from,
                      v_best_table, v_best_column);

    -- Re-read the winning candidate so each disagreeing cell is filed with its own value.
    execute format(
      'select jsonb_object_agg(k, v) from ('
      '  select t.%I::text as k, t.%I::numeric as v from %I t'
      '  where t.%I = any($1) and t.%I is not null limit $2'
      ') s',
      v_best_join, v_best_column, v_best_table, v_best_join, v_best_column
    ) into v_map using v_dist.geo_codes, p_max_rows;

    for i in 1 .. v_dist.cells loop
      continue when not (v_map ? v_dist.geo_codes[i]);
      v_data_value := (v_map ->> v_dist.geo_codes[i])::numeric;
      continue when v_data_value = v_dist.cell_values[i];

      insert into kb_contradiction as k (
        method, measure_label, doc_id, chunk_id, page_from, doc_value, doc_as_of, doc_as_of_text,
        evidence_quote, data_table, data_column, data_stat, data_value, data_as_of,
        geo_code, geo_level, abs_difference, rel_difference, evidence, last_swept_at
      )
      select
        'geo_distribution', v_label, v_dist.doc_id, v_dist.chunk_id, v_dist.page_from,
        v_dist.cell_values[i], v_dist.doc_as_of,
        (select substring(c.content from '(?i)as of[^\n]{0,60}') from doc_chunk c where c.chunk_id = v_dist.chunk_id),
        g.geo_name || E'\n' || v_dist.cell_values[i]::text,
        v_best_table, v_best_column, 'cell', v_data_value, v_best_as_of,
        v_dist.geo_codes[i], v_dist.geo_level,
        abs(v_dist.cell_values[i] - v_data_value),
        round(abs(v_dist.cell_values[i] - v_data_value) / greatest(abs(v_dist.cell_values[i]), abs(v_data_value)), 6),
        jsonb_build_object(
          'cells', v_dist.cells, 'covered', v_best_covered, 'agreed', v_best_matched,
          'fit', v_best_fit, 'tied_candidates', to_jsonb(v_ties)
        ),
        v_swept_at
      from dim_geo g where g.geo_code = v_dist.geo_codes[i]
      on conflict on constraint kb_contradiction_identity do update set
        measure_label = excluded.measure_label,
        evidence = excluded.evidence,
        last_swept_at = excluded.last_swept_at,
        -- A judged row stays judged while the two numbers it was judged on are unchanged. A
        -- changed value is a different disagreement, so it returns to the queue with the note
        -- that was written about the old one cleared rather than left standing behind it.
        status = case when k.doc_value = excluded.doc_value and k.data_value = excluded.data_value
                      then k.status else 'auto' end,
        review_note = case when k.doc_value = excluded.doc_value and k.data_value = excluded.data_value
                           then k.review_note else null end,
        reviewed_by = case when k.doc_value = excluded.doc_value and k.data_value = excluded.data_value
                           then k.reviewed_by else null end,
        reviewed_at = case when k.doc_value = excluded.doc_value and k.data_value = excluded.data_value
                           then k.reviewed_at else null end,
        doc_value = excluded.doc_value,
        data_value = excluded.data_value,
        abs_difference = excluded.abs_difference,
        rel_difference = excluded.rel_difference;

      found_by := 'geo_distribution';
      finding := v_label;
      slide := v_dist.page_from;
      select g.geo_name into scope from dim_geo g where g.geo_code = v_dist.geo_codes[i];
      document_value := v_dist.cell_values[i];
      dataset_ref := v_best_table || '.' || v_best_column;
      dataset_value := v_data_value;
      relative_difference := round(abs(v_dist.cell_values[i] - v_data_value) / greatest(abs(v_dist.cell_values[i]), abs(v_data_value)), 6);
      stat := 'cell';
      return next;
    end loop;

    -- The slide's own total against the table's. Computed from the two distributions rather than
    -- read off a "TOTAL" line, so it needs no English word and holds for a slide that states no
    -- total at all: the slide's cells sum to one number, the table's rows at that level sum to
    -- another, and a difference between them is a claim about scope, not about one geography.
    v_doc_total := v_dist.doc_total;
    begin
      execute format(
        'select sum(v)::numeric, count(*), count(distinct k) from ('
        '  select t.%I::text as k, t.%I::numeric as v from %I t'
        '  join dim_geo g on g.geo_code = t.%I where g.geo_level::text = $1 limit $2'
        ') s',
        v_best_join, v_best_column, v_best_table, v_best_join
      ) into v_data_total, v_total_rows, v_total_keys using v_dist.geo_level, p_max_rows;
    exception when others then
      v_data_total := null;
    end;

    if v_data_total is not null and v_total_rows = v_total_keys
       and v_total_rows > 0 and v_data_total <> v_doc_total then
      insert into kb_contradiction as k (
        method, measure_label, doc_id, chunk_id, page_from, doc_value, doc_as_of, doc_as_of_text,
        evidence_quote, data_table, data_column, data_stat, data_value, data_as_of,
        geo_code, geo_level, abs_difference, rel_difference, evidence, last_swept_at
      ) values (
        'geo_distribution',
        v_label || ' (total over all ' || v_dist.geo_level || 's)',
        v_dist.doc_id, v_dist.chunk_id, v_dist.page_from, v_doc_total, v_dist.doc_as_of,
        (select substring(c.content from '(?i)as of[^\n]{0,60}') from doc_chunk c where c.chunk_id = v_dist.chunk_id),
        format('The slide''s %s %s cells sum to %s.', v_dist.cells, v_dist.geo_level, v_doc_total),
        v_best_table, v_best_column, 'level_total', v_data_total, v_best_as_of,
        null, null,
        abs(v_doc_total - v_data_total),
        round(abs(v_doc_total - v_data_total) / greatest(abs(v_doc_total), abs(v_data_total)), 6),
        jsonb_build_object(
          'cells', v_dist.cells, 'covered', v_best_covered, 'agreed', v_best_matched,
          'fit', v_best_fit, 'data_rows', v_total_rows, 'tied_candidates', to_jsonb(v_ties)
        ),
        v_swept_at
      )
      on conflict on constraint kb_contradiction_identity do update set
        measure_label = excluded.measure_label,
        evidence = excluded.evidence,
        last_swept_at = excluded.last_swept_at,
        status = case when k.doc_value = excluded.doc_value and k.data_value = excluded.data_value
                      then k.status else 'auto' end,
        review_note = case when k.doc_value = excluded.doc_value and k.data_value = excluded.data_value
                           then k.review_note else null end,
        reviewed_by = case when k.doc_value = excluded.doc_value and k.data_value = excluded.data_value
                           then k.reviewed_by else null end,
        reviewed_at = case when k.doc_value = excluded.doc_value and k.data_value = excluded.data_value
                           then k.reviewed_at else null end,
        doc_value = excluded.doc_value,
        data_value = excluded.data_value,
        abs_difference = excluded.abs_difference,
        rel_difference = excluded.rel_difference;

      found_by := 'geo_distribution';
      finding := v_label;
      slide := v_dist.page_from;
      scope := '(total)';
      document_value := v_doc_total;
      dataset_ref := v_best_table || '.' || v_best_column;
      dataset_value := v_data_total;
      relative_difference := round(abs(v_doc_total - v_data_total) / greatest(abs(v_doc_total), abs(v_data_total)), 6);
      stat := 'level_total';
      return next;
    end if;
  end loop;

  -- =========================================================================================
  -- Pass 2 — standalone figures, paired on shared vocabulary and magnitude.
  -- =========================================================================================
  --
  -- No dynamic SQL and no data table: the structured side is entirely the registry's own profile
  -- statistics, which 4.1 measured. One statement, so the bound is the corpus rather than a loop.
  for v_cell in
    with doc_numbers as (
      select l.chunk_id, l.doc_id, l.page_from, l.doc_as_of, l.ord, l.line,
             m[1] as raw,
             replace(m[1], ',', '')::numeric as value
      from kb_doc_line l
      cross join lateral regexp_matches(l.line, '([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,})', 'g') as m
    ),
    candidates as (
      select n.*,
             -- The words the figure sits among: its own line and the two most recent lines that
             -- carry any letters. On a slide that is the question and the heading above it.
             (select string_agg(x.line, ' ' order by x.ord)
              from (
                select l2.ord, l2.line from kb_doc_line l2
                where l2.chunk_id = n.chunk_id and l2.ord <= n.ord and l2.line ~ '[A-Za-z]'
                order by l2.ord desc limit 3
              ) x) as window_text
      from doc_numbers n
      where n.value >= p_min_value
        -- A bare four-digit number in this range is a year. One carrying a thousands separator is
        -- a quantity that happens to be small.
        and not (n.raw !~ ',' and n.value between 1900 and 2100)
    ),
    doc_claims as (
      select c.*, kb_terms(c.window_text) as terms
      from candidates c
    ),
    data_scalars as (
      -- BOTH RESTRICTIONS HERE WERE WRITTEN AFTER RUNNING THE FIRST VERSION, WHICH GOT THEM WRONG.
      --
      -- 1. A count of things is a count of distinct KEYS, not a count of rows. The first version
      --    also offered `dataset_registry.row_estimate`, which counts the rows of a table whose
      --    grain may be a grid (geography x indicator x year) — a number that is an artifact of
      --    the grid and that nobody publishes. `dataset_column.distinct_count` on a `key` column
      --    counts the things the key identifies. This is 4.1's role vocabulary doing load-bearing
      --    work, and it is why 4.1 retyped `bhw_id` from `measure` to `key`.
      --
      --    The consequence is stated rather than hidden: this pass can only contradict a table
      --    that has been *profiled*, because `distinct_count` is null until a profiling pass
      --    writes it. Today that is `fact_bhw_raw` and nothing else. The pass's reach grows with
      --    4.1's rather than on its own.
      --
      -- 2. The vocabulary is the entry's NAME, not its prose. The first version also drew terms
      --    from `summary`, `grain` and `meaning` — text written for a reader and therefore full of
      --    connective words. It paired "RA 11223" (a statute number) against a table's row count
      --    on four separate slides, on the strength of a shared "with", "its" or "for". A title is
      --    a name; a summary is a sentence, and a sentence shares words with everything.
      select r.table_name, dc.column_name as data_column, 'distinct_count'::text as data_stat,
             dc.distinct_count::numeric as value, dd.as_of_date as data_as_of,
             r.title || ' ' || dc.column_name as label_text,
             r.title || ' — distinct ' || dc.column_name as label
      from dataset_registry r
      join dataset_column dc on dc.registry_id = r.registry_id
      left join dim_dataset dd on dd.slug = r.dataset_slug
      where r.status = 'approved' and dc.status = 'approved'
        and dc.role = 'key' and dc.distinct_count is not null and dc.distinct_count > 0
    ),
    scored as (
      select d.chunk_id, d.doc_id, d.page_from, d.doc_as_of, d.line, d.value as doc_value,
             s.table_name, s.data_column, s.data_stat, s.value as data_value, s.data_as_of, s.label,
             array(select unnest(d.terms) intersect select unnest(kb_terms(s.label_text))
                   except select unnest(v_generic)) as shared,
             round(abs(d.value - s.value) / greatest(d.value, s.value), 6) as rel
      from doc_claims d
      join data_scalars s
        on d.value <> s.value
       and abs(d.value - s.value) <= p_rel_tolerance * greatest(d.value, s.value)
    )
    select distinct on (sc.chunk_id, sc.doc_value) sc.*
    from scored sc
    where array_length(sc.shared, 1) >= 1
    order by sc.chunk_id, sc.doc_value, sc.rel, sc.table_name, sc.data_column
  loop
    insert into kb_contradiction as k (
      method, measure_label, doc_id, chunk_id, page_from, doc_value, doc_as_of, doc_as_of_text,
      evidence_quote, data_table, data_column, data_stat, data_value, data_as_of,
      geo_code, geo_level, abs_difference, rel_difference, evidence, last_swept_at
    ) values (
      'scalar_magnitude',
      format('slide %s states %s; %s holds %s', v_cell.page_from, v_cell.doc_value,
             coalesce(v_cell.table_name || '.' || v_cell.data_column, v_cell.table_name),
             v_cell.data_value),
      v_cell.doc_id, v_cell.chunk_id, v_cell.page_from, v_cell.doc_value, v_cell.doc_as_of,
      (select substring(c.content from '(?i)as of[^\n]{0,60}') from doc_chunk c where c.chunk_id = v_cell.chunk_id),
      btrim(v_cell.line),
      v_cell.table_name, v_cell.data_column, v_cell.data_stat, v_cell.data_value, v_cell.data_as_of,
      null, null,
      abs(v_cell.doc_value - v_cell.data_value), v_cell.rel,
      jsonb_build_object('shared_terms', to_jsonb(v_cell.shared), 'registry_label', v_cell.label),
      v_swept_at
    )
    on conflict on constraint kb_contradiction_identity do update set
      measure_label = excluded.measure_label,
      evidence = excluded.evidence,
      last_swept_at = excluded.last_swept_at,
      status = case when k.doc_value = excluded.doc_value and k.data_value = excluded.data_value
                    then k.status else 'auto' end,
      review_note = case when k.doc_value = excluded.doc_value and k.data_value = excluded.data_value
                         then k.review_note else null end,
      reviewed_by = case when k.doc_value = excluded.doc_value and k.data_value = excluded.data_value
                         then k.reviewed_by else null end,
      reviewed_at = case when k.doc_value = excluded.doc_value and k.data_value = excluded.data_value
                         then k.reviewed_at else null end,
      doc_value = excluded.doc_value,
      data_value = excluded.data_value,
      abs_difference = excluded.abs_difference,
      rel_difference = excluded.rel_difference;

    found_by := 'scalar_magnitude';
    finding := format('%s vs %s', v_cell.doc_value, v_cell.label);
    slide := v_cell.page_from;
    scope := null;
    document_value := v_cell.doc_value;
    dataset_ref := coalesce(v_cell.table_name || '.' || v_cell.data_column, v_cell.table_name);
    dataset_value := v_cell.data_value;
    relative_difference := v_cell.rel;
    stat := v_cell.data_stat;
    return next;
  end loop;
end;
$$;

comment on function sweep_contradictions(numeric, numeric, integer, numeric, integer, text) is
  'Increment 4.2: computes disagreements between approved document chunks and approved registered '
  'datasets and files each as a kb_contradiction row at status = auto. Two passes — geographic '
  'distributions resolved exactly against dim_geo, and standalone figures paired on shared '
  'non-generic vocabulary plus magnitude. A candidate agreeing on every cell corroborates the '
  'slide and suppresses it entirely, rather than only itself. Reads only registry-approved tables, '
  'through %I, with a row cap and its own statement timeout. Calls no provider.';

revoke all on function sweep_contradictions(numeric, numeric, integer, numeric, integer, text) from public, anon, authenticated;
