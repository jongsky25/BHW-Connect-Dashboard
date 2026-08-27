-- Ingest-time profiling (docs/AI_ASSISTANT_PLAN.md §8, Increment 4.1).
--
-- §3: "Adding a dataset must become a data operation, not a code change." This is the increment
-- the plan calls its success condition: a genuinely new dataset becomes queryable through the
-- assistant with no code change. `profile_dataset()` is the whole of that pass.
--
-- THE PROFILE IS MEASURED, NOT INFERRED, AND THAT IS THE POINT. §8 4.1 lists four steps — profile,
-- infer meanings, propose joins, write at `auto`. Three of the four need no model at all, and the
-- project has been burned twice by not separating them (1.5 seeded lineage from repository
-- structure rather than extraction for exactly this reason; the embedding dimension was made a
-- measured row rather than a declared constant for the same one). So:
--
--   * the column profile is read from `pg_stats`, which the planner already maintains;
--   * the join proposals are **measured overlap** against columns the registry already calls join
--     keys — not a model's guess that two columns look alike;
--   * only `meaning` genuinely needs judgment, and even that is borrowed rather than invented
--     wherever the approved dictionary already describes a column of the same name (see below).
--
-- Nothing here calls a provider. A profiling pass that cannot run without an API key would not run
-- at ingest time, which is the one time it has to.
--
-- WHY `pg_stats` RATHER THAN COUNTING. Guardrail 4 forbids the assistant from table-scanning
-- `fact_bhw_raw`; a profiler that scans it twice per column on every ingest is the same outage
-- through a side door. `pg_stats` already holds null fraction, distinct estimate, most-common
-- values and histogram bounds for every analysed column, computed by a sampling ANALYZE the
-- database runs anyway. The function ANALYZEs the target first so the statistics describe the rows
-- that were just loaded, then reads the catalogue. Profiling a 94 MB table costs one ANALYZE and a
-- catalogue read rather than 26 sequential scans.
--
-- The consequence is that `distinct_count` and `null_rate` are **estimates**, and the schema
-- already says so — the registry's row column has been called `row_estimate` since 1.1. A
-- dictionary shown to a model needs "roughly 43,746 geographies", not an exact count purchased
-- with a full scan.
--
-- WHERE `meaning` COMES FROM, GIVEN NO MODEL. `dataset_column.meaning` is NOT NULL and the registry
-- is *what the model is shown* (§3), so an invented meaning is the dangerous failure mode here —
-- worse than a missing one, because it reads as documentation. Two sources, in order:
--
--   1. **The approved dictionary.** If an approved column of the same name and type is already
--      described somewhere in the registry, reuse that description, with its unit, role and join
--      target. `geo_code` is documented identically in eight registry rows; the ninth does not
--      need a model, it needs the eighth. This is the role §8 1.2 assigns the hand-written rows —
--      "the reference example every later auto-profile is measured against" — doing actual work.
--   2. **A placeholder that admits what it is** (`(needs review) …`), for a column nothing in the
--      registry has ever described. That is the residue a model or a person has to fill in, and
--      keeping it visibly empty is what stops the pass from manufacturing plausible documentation.
--
-- Every row is written at `status = 'auto'`, and `lib/db/dataset-registry.ts` filters both tables
-- to `approved`. So nothing this function writes is visible to any tool, public or internal, until
-- a person judges it — guardrail 6, applied to the registry rather than to extraction.
--
-- WHAT IT REFUSES. Registry-driven means allowlist-driven (guardrail 3), and the allowlist here is
-- the set of relations in `public` — the function resolves its argument against
-- `information_schema` and quotes every identifier with `%I`, so the table name is never
-- concatenated into SQL. On top of that it refuses outright:
--
--   * identity, telemetry and free-text tables (`admin_users`, `usage_events`, `feedback`, `ai_*`),
--     which are not datasets and whose contents must never reach a dictionary the model reads;
--   * its own bookkeeping tables (`dataset_*`, `kb_*`, `doc_*`);
--   * a table whose registry row is already `approved`, unless called with `p_force`. 1.2's
--     hand-written dictionaries are the reference example; silently overwriting one with a
--     placeholder would destroy the thing later passes are measured against.
--
-- `exposure` defaults to `internal` and this function will not set `public`. Guardrail 5 keeps the
-- public tools on the `agg_*`/`dim_*` layer, and a profiling pass is not the place to widen that.

-- ---------------------------------------------------------------------------------------------
-- Which relations may be profiled at all.
-- ---------------------------------------------------------------------------------------------

create or replace function profile_dataset_refusal(p_table text)
returns text
language sql
stable
as $$
  select case
    when p_table is null or p_table = '' then 'no table name was given'
    when p_table in ('admin_users', 'usage_events', 'feedback', 'ingestion_batches')
      then 'identity, telemetry and free-text tables are not datasets and are never profiled'
    when p_table like 'ai\_%' then 'assistant bookkeeping tables are never profiled'
    when p_table like 'dataset\_%' or p_table like 'kb\_%' or p_table like 'doc\_%'
      then 'the registry and graph tables are not themselves datasets'
    when not exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = p_table
        and table_type in ('BASE TABLE', 'VIEW')
    ) then format('%L is not a table or view in the public schema', p_table)
    else null
  end;
$$;

comment on function profile_dataset_refusal(text) is
  'The allowlist behind profile_dataset(): returns a refusal reason, or null when the relation may '
  'be profiled. Split out so the refusal set is readable and testable on its own rather than '
  'buried in the profiling body.';

-- ---------------------------------------------------------------------------------------------
-- Role inference, from the profile alone.
-- ---------------------------------------------------------------------------------------------
--
-- Deliberately crude and deliberately not a model. Four roles, decided by type and cardinality,
-- and every one of them is visible to the reviewer beside the statistics that produced it. A wrong
-- role on an `auto` row costs one click; a role a model argued itself into costs a reading of the
-- argument.

create or replace function profile_dataset_role(
  p_data_type text,
  p_column_name text,
  p_is_join_key boolean,
  p_distinct bigint,
  p_row_estimate bigint
) returns text
language sql
immutable
as $$
  select case
    when p_is_join_key then 'key'
    -- Bookkeeping, not analysis: these describe the load rather than the subject, and a model
    -- shown them as dimensions will eventually group a briefing by ingestion batch.
    when p_column_name in ('ingestion_batch_id', 'created_at', 'updated_at', 'profiled_at')
      then 'meta'
    -- A year or a date is something to filter and group by, which is what `dimension` means here.
    -- The role vocabulary is fixed by dataset_column's CHECK constraint (key/dimension/measure/
    -- meta) and this pass does not get to widen it.
    when p_column_name like '%\_year' or p_data_type in ('date', 'timestamp with time zone', 'timestamp without time zone')
      then 'dimension'
    when p_data_type in ('boolean') then 'dimension'
    when p_data_type in ('smallint', 'integer', 'bigint', 'numeric', 'double precision', 'real')
      then case
        -- An identifier, caught by measurement rather than by its name: a numeric column with
        -- about as many distinct values as the table has rows is a row identity, not a quantity.
        -- This matters more than the other rules. `role = 'measure'` is what tells the model a
        -- column may be summed and averaged, and the mean of `bhw_id` is a number that will be
        -- reported to someone. The first profiling run typed `bhw_id` a measure on cardinality
        -- alone, which is exactly the failure.
        when p_distinct is not null and p_row_estimate > 0
             and p_distinct::numeric / p_row_estimate >= 0.9 then 'key'
        -- A numeric column with few distinct values is a category recorded as a number (a year, a
        -- level, a flag), not a quantity to sum. The cutoff is low on purpose: misfiling a measure
        -- as a dimension is recoverable at review, and the reviewer sees the distinct count.
        when p_distinct is not null and p_distinct <= 12 then 'dimension'
        else 'measure'
      end
    else 'dimension'
  end;
$$;

comment on function profile_dataset_role(text, text, boolean, bigint, bigint) is
  'Assigns a dataset_column.role from the measured profile. Type and cardinality only — no model, '
  'and every input is shown to the reviewer alongside the result.';

-- ---------------------------------------------------------------------------------------------
-- The profiling pass.
-- ---------------------------------------------------------------------------------------------

create or replace function profile_dataset(
  p_table text,
  p_title text default null,
  p_summary text default null,
  p_grain text default null,
  p_dataset_slug text default null,
  p_force boolean default false
) returns table (
  column_name text,
  data_type text,
  role text,
  is_join_key boolean,
  joins_to text,
  meaning_source text,
  distinct_count bigint,
  null_rate numeric,
  overlap_rate numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refusal text;
  v_registry_id bigint;
  v_row_estimate bigint;
  v_col record;
  v_candidate record;
  v_is_join_key boolean;
  v_joins_to text;
  v_overlap numeric;
  v_best_overlap numeric;
  v_best_target text;
  v_meaning text;
  v_meaning_source text;
  v_unit text;
  v_role text;
  v_distinct bigint;
  v_null_rate numeric;
  v_samples text[];
  v_min text;
  v_max text;
  v_matched bigint;
  v_sampled bigint;
  v_prior jsonb;
begin
  v_refusal := profile_dataset_refusal(p_table);
  if v_refusal is not null then
    raise exception 'profile_dataset refused %: %', coalesce(p_table, '(null)'), v_refusal;
  end if;

  if not p_force and exists (
    select 1 from dataset_registry r where r.table_name = p_table and r.status = 'approved'
  ) then
    raise exception
      'profile_dataset refused %: it already has an approved registry row. Pass p_force => true to '
      're-profile it, which returns the dictionary to the review queue.', p_table;
  end if;

  -- Statistics describing the rows that were just loaded, not the rows from the last ingest.
  execute format('analyze %I', p_table);

  select coalesce(c.reltuples, 0)::bigint into v_row_estimate
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = p_table;

  insert into dataset_registry as r (
    table_name, title, summary, grain, dataset_slug, exposure, row_estimate,
    source_kind, status, notes_md, created_at, updated_at
  ) values (
    p_table,
    coalesce(p_title, p_table),
    coalesce(p_summary, format('(needs review) Profiled from %I on %s. No summary has been written yet.', p_table, now()::date)),
    coalesce(p_grain, '(needs review) one row per ?'),
    p_dataset_slug,
    'internal',
    v_row_estimate,
    'profiled',
    'auto',
    format('Profiled by profile_dataset() at %s. Statistics are ANALYZE estimates.', now()),
    now(), now()
  )
  on conflict (table_name) do update set
    row_estimate = excluded.row_estimate,
    status = 'auto',
    exposure = case when r.exposure = 'public' then 'public' else 'internal' end,
    notes_md = excluded.notes_md,
    updated_at = now()
  returning r.registry_id into v_registry_id;

  -- Re-profiling replaces the column dictionary rather than merging into it: a column dropped from
  -- the table upstream must not survive in the dictionary as a queryable name. The approved
  -- meanings are lifted into a map first so they carry forward — held in a variable rather than a
  -- temp table because this function is called once per statement and a temp table would outlive
  -- the call in a session that profiles two tables in one transaction.
  select coalesce(
    jsonb_object_agg(
      dc.column_name || '|' || dc.data_type,
      jsonb_build_object('meaning', dc.meaning, 'unit', dc.unit)
    ), '{}'::jsonb)
  into v_prior
  from dataset_column dc
  where dc.registry_id = v_registry_id and dc.status = 'approved';

  delete from dataset_column dc where dc.registry_id = v_registry_id;

  for v_col in
    select c.column_name as name, c.data_type as dtype, c.ordinal_position as ord
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = p_table
    order by c.ordinal_position
  loop
    -- ---- the measured profile, from the catalogue --------------------------------------------
    select
      case
        when s.n_distinct is null then null
        -- Negative n_distinct is a ratio of the row count, which is how the planner records a
        -- column whose cardinality grows with the table.
        when s.n_distinct < 0 then (-s.n_distinct * v_row_estimate)::bigint
        else s.n_distinct::bigint
      end,
      s.null_frac::numeric,
      case when s.most_common_vals is null then null
           else (select array_agg(v) from (
                   select unnest(s.most_common_vals::text::text[]) as v limit 8
                 ) t)
      end
    into v_distinct, v_null_rate, v_samples
    from pg_stats s
    where s.schemaname = 'public' and s.tablename = p_table and s.attname = v_col.name;

    select
      case when s.histogram_bounds is null then null
           else (s.histogram_bounds::text::text[])[1] end,
      case when s.histogram_bounds is null then null
           else (s.histogram_bounds::text::text[])[array_length(s.histogram_bounds::text::text[], 1)] end
    into v_min, v_max
    from pg_stats s
    where s.schemaname = 'public' and s.tablename = p_table and s.attname = v_col.name;

    -- ---- join proposal, by measured overlap ---------------------------------------------------
    --
    -- Candidates come from what the registry already calls a join key. A name match alone proposes
    -- nothing: it only selects which target is worth measuring. The overlap is then computed
    -- against a bounded sample of this column's distinct values, and the proposal survives only if
    -- most of them actually resolve. That number is returned to the reviewer as the evidence.
    v_is_join_key := false;
    v_joins_to := null;
    v_best_overlap := null;
    v_best_target := null;

    if v_col.dtype in ('text', 'character varying', 'bigint', 'integer', 'smallint') then
      for v_candidate in
        select distinct dc.joins_to as target
        from dataset_column dc
        where dc.status = 'approved' and dc.is_join_key and dc.joins_to is not null
          and (dc.column_name = v_col.name or split_part(dc.joins_to, '.', 2) = v_col.name)
      loop
        begin
          execute format(
            'select count(*), count(*) filter (where exists (select 1 from %I t where t.%I::text = s.v)) '
            'from (select distinct %I::text as v from %I where %I is not null limit 500) s',
            split_part(v_candidate.target, '.', 1),
            split_part(v_candidate.target, '.', 2),
            v_col.name, p_table, v_col.name
          ) into v_sampled, v_matched;
        exception when others then
          v_sampled := 0; v_matched := 0;
        end;

        if v_sampled > 0 then
          v_overlap := round(v_matched::numeric / v_sampled, 4);
          if v_best_overlap is null or v_overlap > v_best_overlap then
            v_best_overlap := v_overlap;
            v_best_target := v_candidate.target;
          end if;
        end if;
      end loop;

      -- 0.95 rather than 1.0: a real foreign key can carry a handful of codes retired between
      -- PSGC vintages — `dim_psgc_crosswalk` exists because that happens — and demanding a perfect
      -- match would reject the joins that most need documenting. Below the threshold the overlap
      -- is still returned, so a near miss is visible rather than silently dropped.
      if v_best_overlap is not null and v_best_overlap >= 0.95 then
        v_is_join_key := true;
        v_joins_to := v_best_target;
      end if;
    end if;

    -- ---- meaning: borrowed where the dictionary already has one -------------------------------
    v_meaning := null;
    v_unit := null;
    v_meaning_source := null;

    -- A meaning approved for this very table on an earlier profile always wins: it was written
    -- about these rows.
    v_meaning := v_prior -> (v_col.name || '|' || v_col.dtype) ->> 'meaning';
    v_unit    := v_prior -> (v_col.name || '|' || v_col.dtype) ->> 'unit';
    if v_meaning is not null then
      v_meaning_source := 'kept from this table''s approved dictionary';
    end if;

    -- Otherwise, the same column name and type described anywhere else in the approved registry.
    if v_meaning is null then
      select dc.meaning, dc.unit into v_meaning, v_unit
      from dataset_column dc
      join dataset_registry dr on dr.registry_id = dc.registry_id
      where dc.status = 'approved' and dr.status = 'approved'
        and dc.column_name = v_col.name and dc.data_type = v_col.dtype
      group by dc.meaning, dc.unit
      order by count(*) desc
      limit 1;
      if v_meaning is not null then
        v_meaning_source := 'borrowed from the approved dictionary';
      end if;
    end if;

    if v_meaning is null then
      v_meaning := format('(needs review) %s — no approved dictionary describes this column.', v_col.name);
      v_meaning_source := 'placeholder';
    end if;

    v_role := profile_dataset_role(v_col.dtype, v_col.name, v_is_join_key, v_distinct, v_row_estimate);

    insert into dataset_column (
      registry_id, column_name, ordinal, data_type, meaning, unit, role,
      is_join_key, joins_to, is_queryable,
      distinct_count, null_rate, min_value, max_value, sample_values, profiled_at, status
    ) values (
      v_registry_id, v_col.name, v_col.ord, v_col.dtype, v_meaning, v_unit, v_role,
      v_is_join_key, v_joins_to,
      -- Array and JSON columns are described but not offered for querying: `queryDataset` builds
      -- flat predicates, and a jsonb column in the dictionary invites a query it cannot express.
      v_col.dtype not in ('ARRAY', 'jsonb', 'json'),
      v_distinct, v_null_rate, v_min, v_max, v_samples, now(), 'auto'
    );

    column_name := v_col.name;
    data_type := v_col.dtype;
    role := v_role;
    is_join_key := v_is_join_key;
    joins_to := v_joins_to;
    meaning_source := v_meaning_source;
    distinct_count := v_distinct;
    null_rate := v_null_rate;
    overlap_rate := v_best_overlap;
    return next;
  end loop;
end;
$$;

comment on function profile_dataset(text, text, text, text, text, boolean) is
  'Increment 4.1: profiles one relation into dataset_registry/dataset_column at status = auto. '
  'Statistics come from pg_stats after an ANALYZE; join keys are proposed only when a measured '
  'sample of the column resolves against an already-registered join target; meanings are borrowed '
  'from the approved dictionary or left as a visible placeholder. Never writes exposure = public, '
  'and never overwrites an approved dictionary without p_force.';

revoke all on function profile_dataset(text, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function profile_dataset_refusal(text) from public, anon, authenticated;
revoke all on function profile_dataset_role(text, text, boolean, bigint, bigint) from public, anon, authenticated;
