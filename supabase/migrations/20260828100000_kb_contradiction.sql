-- The contradiction sweep (docs/AI_ASSISTANT_PLAN.md §8, Increment 4.2).
--
-- §12.4 rule 3: "Where a document number and a SQL number disagree, the assistant surfaces both
-- with their as-of dates and does not silently prefer either." §8 4.2 says why that rule needs a
-- batch job rather than prompt copy: "a rule that only fires when someone happens to ask the right
-- question is not enforced. Sweeping for them makes it enforced."
--
-- THE SWEEP COMPUTES CONTRADICTIONS; IT DOES NOT NOTICE THEM. This is the whole design
-- constraint, and it is the same one 4.1 was built under. A pass that asks a model to read the
-- corpus and report what looks inconsistent has three problems: it needs a provider key, so it
-- would not run; it is unrepeatable, so a disagreement found on Tuesday may be absent on
-- Wednesday; and its output is a claim rather than a measurement, so a reviewer has nothing to
-- check but the model's word. Everything below is arithmetic over rows this database already
-- holds. Nothing here calls a provider.
--
-- TWO PASSES, BECAUSE THERE ARE TWO WAYS TO KNOW WHAT A NUMBER IS ABOUT. Pairing a document
-- figure with a SQL figure is the hard half of the problem — a number in a slide carries no column
-- name. Each pass answers it differently, and their evidence is of very different strength:
--
--   'geo_distribution' — a slide that lists geographies against numbers. The label beside each
--       number is matched against `dim_geo.geo_name`, so identification is *exact*: the slide says
--       "REGION VII (CENTRAL VISAYAS)" and that string is a row in the geography dimension. The
--       structured counterpart is then chosen by measured fit — of every approved (table, measure)
--       pair that holds one value per geography at that level, the one whose values agree with the
--       slide on the most cells. A pair that agrees everywhere is corroboration and is not filed;
--       a pair that agrees on most cells and differs on a few is the contradiction, and the cells
--       that differ are the rows.
--
--   'scalar_magnitude' — a standalone figure in prose ("277,767 (Registered and Accreditted
--       BHWs)"). There is no dimension row to match against, so identification is *inferred from
--       two weak signals used together*: the words near the number must share a non-generic term
--       with the registry entry, and the two values must be close enough to be two measurements of
--       one quantity rather than two different quantities. Neither signal alone would be worth
--       filing; the conjunction is narrow enough to be worth a person's minute.
--
-- The asymmetry is deliberate and is recorded on every row: `method` says which pass found it and
-- `evidence` carries the numbers that pass computed. A reviewer looking at a 'scalar_magnitude'
-- row should be more sceptical than at a 'geo_distribution' row, and the row tells them so.
--
-- WHAT THE STRUCTURED SIDE IS ALLOWED TO BE. Guardrail 3: registry-driven means allowlist-driven.
-- The only tables this sweep reads are those with an **approved** `dataset_registry` row, through
-- columns with an **approved** `dataset_column` row; every identifier goes into `format('%I')` and
-- every value goes through `USING`, so no text out of a document or a registry summary is ever
-- concatenated into SQL. Guardrail 4: each probe is restricted to the geographies the slide names
-- and carries a row cap, and the function sets its own statement timeout.
--
-- 'scalar_magnitude' goes further and reads no data table at all — its structured side is the
-- registry's own profile statistics (`row_estimate`, `dataset_column.distinct_count`), which 4.1
-- measured from `pg_stats`. So the pass that has to consider every number in the corpus is also
-- the one that touches no facts. That is why `fact_bhw_raw`'s 270,917 is available to be
-- contradicted without anyone scanning a 94 MB table.
--
-- NOTHING HERE IS CITABLE. Rows land at `status = 'auto'` like every other proposal in this
-- project (owner decision 5), and `lib/db/contradiction-review.ts` is the queue. A filed row is a
-- question — "are these two numbers the same measure?" — not an assertion that they are. Per
-- §12.4 rule 3 an approved row is not an error to fix either: it is a distinction the assistant
-- must surface, with both values and both as-of dates.
--
-- The table is service-role only, RLS enabled in the same statement block as the CREATE (the
-- DECISIONS.md 0.3 guardrail). It quotes internal budget material (§12.5) and names internal
-- tables, so it must never be publicly readable.

create table kb_contradiction (
  contradiction_id bigint generated always as identity primary key,

  -- Which computation found this. Every value is arithmetic; none is a model's opinion.
  method text not null check (method in ('geo_distribution', 'scalar_magnitude')),

  -- A sentence naming what is being compared, assembled from the two sides' own labels.
  measure_label text not null,

  -- ---- the document side -------------------------------------------------------------------
  doc_id bigint not null references doc_source (doc_id) on delete cascade,
  chunk_id bigint not null references doc_chunk (chunk_id) on delete cascade,
  page_from integer not null,
  doc_value numeric not null,
  -- §8 4.2 requires both values to carry their as-of dates. Two fields because the document has
  -- two: the date the deck as a whole speaks as of, and the phrase this slide states for this
  -- figure ("as of Dec 2025"), which is the one a briefing needs and is often the older of the
  -- two. The phrase is stored verbatim rather than parsed into a date: "2025 per DC No. 2025-0549"
  -- is not a date, and inventing one for it would be the kind of tidy-looking loss §12.3 warns
  -- about.
  doc_as_of date,
  doc_as_of_text text,
  -- The line the number was read from, exactly. §7's argument applies to a reviewer more than to a
  -- reader: the only way to judge whether two numbers are the same measure is to see the words.
  evidence_quote text not null,

  -- ---- the structured side -----------------------------------------------------------------
  data_table text not null,
  -- Null when the figure is a table-level statistic (`row_estimate`) rather than a column's.
  data_column text,
  data_stat text not null check (data_stat in ('cell', 'level_total', 'distinct_count')),
  data_value numeric not null,
  data_as_of date,

  -- ---- scope -------------------------------------------------------------------------------
  -- The geography both sides are talking about, when they are talking about one. Null means the
  -- comparison is over the whole scope (a stated total, or a national figure).
  geo_code text,
  geo_level text,

  abs_difference numeric not null,
  -- Relative to the larger of the two, so it is symmetric and never divides by the smaller value.
  rel_difference numeric not null,

  -- Everything the pass measured, so the reviewer judges the pairing rather than trusting it:
  -- cells compared, cells that agreed, the shared terms, the runners-up that fitted as well.
  evidence jsonb not null default '{}'::jsonb,

  status text not null default 'auto' check (status in ('auto', 'approved', 'rejected')),
  review_note text,
  reviewed_by text,
  reviewed_at timestamptz,

  first_seen_at timestamptz not null default now(),
  -- The last sweep that reproduced this row. A row whose timestamp is behind the latest sweep no
  -- longer reproduces — the data changed, or the document was re-ingested — and the queue says so
  -- rather than showing it as current.
  last_swept_at timestamptz not null default now(),

  -- Generated so the identity of a finding is a real unique constraint rather than a convention
  -- the writer has to remember. A finding is one (pass, slide, geography, table, column).
  scope_key text generated always as (coalesce(geo_code, '(whole)')) stored,
  data_column_key text generated always as (coalesce(data_column, '(table)')) stored,

  constraint kb_contradiction_values_differ check (doc_value <> data_value),
  constraint kb_contradiction_geo_pair check ((geo_code is null) = (geo_level is null)),
  constraint kb_contradiction_identity
    unique (method, chunk_id, scope_key, data_table, data_column_key)
);

create index kb_contradiction_status_idx on kb_contradiction (status, rel_difference desc);
create index kb_contradiction_chunk_idx on kb_contradiction (chunk_id);

alter table kb_contradiction enable row level security;
-- service-role only: no anon/authenticated policies.

comment on table kb_contradiction is
  'Increment 4.2: computed disagreements between a document figure and a registered dataset. '
  'Rows land at status = auto and are judged at /admin/kb-review. Per plan §12.4 rule 3 an '
  'approved row is a distinction to surface with both as-of dates, not an error to resolve.';

-- ---------------------------------------------------------------------------------------------
-- Terms, for the weaker of the two pairing signals.
-- ---------------------------------------------------------------------------------------------
--
-- Deliberately crude: lowercase, split on non-alphanumerics, drop tokens under three characters
-- and pure numbers, and strip one trailing 's' so "BHWs" and "BHW" are one term. It is not a
-- stemmer and is not trying to be. The point is that it is the *same* transformation on both
-- sides and a reviewer can reproduce it by eye.

create or replace function kb_terms(p_text text)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct t), '{}'::text[])
  from (
    select case when length(w) > 3 and right(w, 1) = 's' then left(w, length(w) - 1) else w end as t
    from regexp_split_to_table(lower(coalesce(p_text, '')), '[^a-z0-9]+') as g(w)
    where length(w) >= 3 and w !~ '^[0-9]+$'
  ) s;
$$;

comment on function kb_terms(text) is
  'Increment 4.2: the token set used to test whether a document figure and a registry entry are '
  'talking about the same subject. Same transformation on both sides, reproducible by eye.';

-- Terms too common across the registry to identify anything. Derived by document frequency rather
-- than written down: a word that appears in more than half the registry's entries ("geography",
-- "dataset", "one") tells you nothing about which entry you are looking at. Authoring a stoplist
-- would bake this project's vocabulary into a migration; counting it keeps the list correct as the
-- registry grows.
--
-- Measured over the widest registry text there is — title, summary and grain — although the
-- pairing itself only ever uses an entry's title. The asymmetry is deliberate: a word that is
-- common anywhere in the registry should not be the sole evidence for a pairing, even if it
-- happens to appear in one title.
create or replace function kb_generic_terms()
returns text[]
language sql
stable
as $$
  with entries as (
    select r.registry_id,
           kb_terms(r.title || ' ' || r.summary || ' ' || r.grain) as terms
    from dataset_registry r
    where r.status = 'approved'
  ),
  n as (select greatest(count(*), 1) as total from entries)
  select coalesce(array_agg(t), '{}'::text[])
  from (
    select unnest(terms) as t, count(*) as df from entries group by 1
  ) f, n
  where f.df * 2 > n.total;
$$;

comment on function kb_generic_terms() is
  'Increment 4.2: registry terms with a document frequency above half, which therefore identify '
  'nothing. Counted rather than authored so the list stays right as the registry grows.';

-- ---------------------------------------------------------------------------------------------
-- Document-side claim extraction.
-- ---------------------------------------------------------------------------------------------
--
-- Both views read only *approved* documents. An unapproved corpus is not evidence.

-- One row per line of every approved chunk, numbered.
create or replace view kb_doc_line with (security_invoker = true) as
  select c.chunk_id, c.doc_id, c.page_from, d.as_of as doc_as_of, t.ord, t.line
  from doc_chunk c
  join doc_source d on d.doc_id = c.doc_id and d.status = 'approved'
  cross join lateral unnest(string_to_array(c.content, E'\n')) with ordinality as t(line, ord);

-- A label line immediately followed (ignoring blanks) by a line that is nothing but a number.
-- This is the shape a slide table has after extraction: header cells and body cells arrive as
-- alternating lines. It is the only structure the geographic pass needs, and it needs no model.
--
-- "The next non-blank line" is `lead()` over the non-blank lines rather than a lateral subquery.
-- The lateral is the obvious way to write it and is quadratic — it re-derives the whole corpus
-- once per line — which cost 825 ms here and would grow with the square of the second document.
create or replace view kb_doc_label_number with (security_invoker = true) as
  with nonblank as (
    select l.chunk_id, l.doc_id, l.page_from, l.doc_as_of, l.ord, btrim(l.line) as line
    from kb_doc_line l
    where btrim(l.line) <> ''
  ),
  paired as (
    select n.*, lead(n.line) over (partition by n.chunk_id order by n.ord) as next_line
    from nonblank n
  )
  select p.chunk_id, p.doc_id, p.page_from, p.doc_as_of, p.ord,
         p.line as label_raw,
         upper(regexp_replace(p.line, '\s+', ' ', 'g')) as label,
         replace(p.next_line, ',', '')::numeric as value
  from paired p
  where p.line ~ '[A-Za-z]'
    and (p.next_line ~ '^[0-9]{1,3}(,[0-9]{3})*$' or p.next_line ~ '^[0-9]+$');

comment on view kb_doc_label_number is
  'Increment 4.2: label/number line pairs in approved document chunks — the extracted form of a '
  'slide table. Used by the geo_distribution pass, whose labels resolve against dim_geo.geo_name.';

-- ---------------------------------------------------------------------------------------------
-- The sweep.
-- ---------------------------------------------------------------------------------------------

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

      -- A perfect fit is corroboration, and corroboration is not what this queue is for.
      if v_fit >= 1.0 or v_fit < p_min_fit then
        continue;
      end if;

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

    continue when v_best_fit is null;

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
  'non-generic vocabulary plus magnitude. Reads only registry-approved tables, through %I, with a '
  'row cap and its own statement timeout. Calls no provider.';

revoke all on function sweep_contradictions(numeric, numeric, integer, numeric, integer, text) from public, anon, authenticated;
revoke all on function kb_terms(text) from public, anon, authenticated;
revoke all on function kb_generic_terms() from public, anon, authenticated;
revoke all on kb_doc_line from public, anon, authenticated;
revoke all on kb_doc_label_number from public, anon, authenticated;
