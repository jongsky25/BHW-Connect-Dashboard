-- Internal AI assistant, Increment 3.4 (docs/AI_ASSISTANT_PLAN.md §8): supersession.
--
-- §4 gave `kb_edge` `valid_from` / `valid_to` in Increment 1.5 for one stated reason — "policy
-- documents supersede each other, and an assistant that cannot say 'as of' will confidently quote
-- a repealed circular" — and nothing has used the columns since. This is where they start working.
--
-- THREE RELATIONS, ALL ISSUANCE TO ISSUANCE. `supersedes` (A replaces B), `amends` (A changes part
-- of B, which still stands) and `implements` (A is made under B). Unlike the 3.1 vocabulary these
-- are symmetric in KIND, so the endpoint signature that catches a reversed `defined-by` catches
-- nothing here: "A supersedes B" and "B supersedes A" are both well typed and only one is true.
-- The extractor compensates by requiring the evidence span to name BOTH issuance numbers, and the
-- 3.2 queue is where a person reads it. Recorded because it is the one place in this vocabulary
-- where the type system stops helping.
--
-- WHAT `as_of` DOES, AND WHY IT IS ON THE EDGE RATHER THAN THE NODE. An issuance has no single
-- validity: it is current for one programme and irrelevant to another. What has a date is the
-- *supersession event* — the moment one list replaced the previous one — so that is where the
-- date lives, and `as_of` filters edges rather than nodes. Walking `in` along `supersedes` from
-- the 2020 list with `as_of = '2022-06-01'` stops at the 2022 list, because the supersessions
-- dated 2023, 2024 and 2025 had not happened yet. That is the whole "as of" capability §4 asked
-- for, and it falls out of filtering edges by their own window.
--
-- An edge with no dates is in force at every `as_of`. That is deliberate: most edges in this graph
-- are structural (a table is derived from a fact table for as long as both exist), and a missing
-- date must never mean "expired". It also means an undated supersession chain — the LGU Health
-- Scorecard one, where the deck gives no effective dates — still orders correctly; the extractor
-- is told to leave a date out rather than guess one.
--
-- `validity_path` joins the path arrays for the same reason 3.3 added `direction_path`: a hop that
-- is only true for a period is not the same claim as one that is always true, and 1.6's contract
-- is that a reader can check every step of a chain without leaving it.
alter table kb_edge drop constraint kb_edge_relation_check;
alter table kb_edge add constraint kb_edge_relation_check check (
  relation in ('derived-from', 'built-by', 'reconciled-in', 'joins-on', 'has-column',
               'defined-by', 'issued-by', 'part-of',
               'supersedes', 'amends', 'implements')
);

-- Only these three may carry validity. §4 gave the columns for supersession; a dated `part-of`
-- would be a date nobody could act on, and a nullable column with no rule is a column that
-- eventually holds three different meanings.
alter table kb_edge add constraint kb_edge_validity_relations check (
  (valid_from is null and valid_to is null)
  or relation in ('supersedes', 'amends', 'implements')
);

drop function if exists traverse_kb(text, text, text[], int, int);

create function traverse_kb(
  start_key text,
  direction text default 'out',
  relations text[] default null,
  max_depth int default 3,
  row_cap int default 200,
  as_of date default null
)
returns table (
  key text,
  kind text,
  label text,
  depth int,
  path text[],
  relation_path text[],
  source_path text[],
  direction_path text[],
  validity_path text[]
)
language plpgsql
stable
security invoker
set statement_timeout = '5000ms'
set search_path = public, pg_temp
as $$
declare
  hard_max_depth constant int := 6;
  both_max_depth constant int := 4;
  hard_row_cap constant int := 500;
  depth_limit int := coalesce(max_depth, 3);
  cap int := least(greatest(coalesce(row_cap, 200), 1), hard_row_cap);
  ceiling int;
begin
  if direction not in ('out', 'in', 'both') then
    raise exception 'traverse_kb direction must be out, in or both, got %', direction
      using errcode = '22023';
  end if;
  ceiling := case when direction = 'both' then both_max_depth else hard_max_depth end;
  if depth_limit > ceiling then
    raise exception 'traverse_kb max_depth % exceeds the limit of % for direction %',
      depth_limit, ceiling, direction using errcode = '22023';
  end if;
  depth_limit := greatest(depth_limit, 1);

  return query
  with recursive walk as (
    select n.node_id, n.key, n.kind, n.label, 0 as depth,
           array[n.key] as path, array[]::text[] as relation_path,
           array[]::text[] as source_path, array[]::text[] as direction_path,
           array[]::text[] as validity_path
    from kb_node n
    where n.key = start_key and n.status = 'approved'
    union all
    select m.node_id, m.key, m.kind, m.label, w.depth + 1,
           w.path || m.key, w.relation_path || e.relation, w.source_path || e.source_ref,
           w.direction_path || case when e.src_node_id = w.node_id then 'out' else 'in' end,
           w.validity_path || case
             when e.valid_from is null and e.valid_to is null then 'always'
             else coalesce(e.valid_from::text, 'open') || '..' || coalesce(e.valid_to::text, 'open')
           end
    from walk w
    join kb_edge e
      on (direction in ('out', 'both') and e.src_node_id = w.node_id)
      or (direction in ('in', 'both') and e.dst_node_id = w.node_id)
    join kb_node m
      on m.node_id = case when e.src_node_id = w.node_id then e.dst_node_id else e.src_node_id end
    where e.status = 'approved'
      and m.status = 'approved'
      and w.depth < depth_limit
      and (relations is null or e.relation = any (relations))
      -- An undated edge is in force at every as_of. A missing date must never read as "expired".
      and (as_of is null
           or ((e.valid_from is null or e.valid_from <= as_of)
               and (e.valid_to is null or e.valid_to > as_of)))
      and not (m.key = any (w.path))
  )
  select w.key, w.kind, w.label, w.depth, w.path, w.relation_path, w.source_path,
         w.direction_path, w.validity_path
  from walk w
  where w.depth > 0
  order by w.depth, w.key
  limit cap;
end;
$$;

revoke execute on function traverse_kb(text, text, text[], int, int, date) from public;
grant execute on function traverse_kb(text, text, text[], int, int, date) to service_role;
