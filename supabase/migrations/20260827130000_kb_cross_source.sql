-- Internal AI assistant, Increment 3.3 (docs/AI_ASSISTANT_PLAN.md §8): cross-source traversal.
--
-- §8 says the recursion, the bounds and the path-provenance contract are unchanged from 1.6 and
-- that "what changes is the edge population it runs over". That is true of three of the four
-- things and this migration is the exception, for a reason worth stating rather than glossing.
--
-- THE EDGE POPULATION ALONE IS NOT ENOUGH, BECAUSE EDGES HAVE A DIRECTION. The crossing edges are
-- `dataset:uuc-phc-2025 defined-by issuance:DC 2025-0549` (asserted by a committed migration) and
-- `program:UUC for PHC defined-by issuance:DC 2025-0549` (extracted from slide 138). They meet at
-- the issuance, nose to nose. A walk that only goes `out` reaches the circular from either side
-- and stops; a walk that only goes `in` never leaves. "Cross into a document-extracted edge and
-- back" is not expressible with one direction, so `both` is added.
--
-- AND THAT MAKES THE PATH AMBIGUOUS, WHICH THE CONTRACT DOES NOT ALLOW. With one direction, a
-- relation name in `relation_path` is unambiguous — everyone knows which way it was walked. With
-- `both`, "defined-by → issuance:AO 2020-0023" could be either a table declaring its basis or a
-- circular being cited by one. 1.6's whole argument is that "an endpoint a reader cannot trace
-- back is not usable in a briefing", so the path gains `direction_path`: one entry per hop, 'out'
-- where the edge was followed src→dst and 'in' where it was followed backwards. The contract is
-- not relaxed for the new capability; it is made precise enough to carry it.
--
-- BOUNDS: `both` gets a LOWER depth cap than the directed modes (4 against 6), not the same one.
-- An undirected walk fans out faster, and §11's open question on depth says to "set a low cap and
-- raise it against real questions rather than guessing upward". The row cap and the statement
-- timeout are unchanged, and a request past the cap is still REFUSED rather than served shallower.
--
-- The return type changes, so this drops and recreates rather than `create or replace`, and
-- re-applies the 1.6 grants — the function reads service-role-only tables and PostgREST would
-- otherwise expose it to anon.
drop function if exists traverse_kb(text, text, text[], int, int);

create function traverse_kb(
  start_key text,
  direction text default 'out',
  relations text[] default null,
  max_depth int default 3,
  row_cap int default 200
)
returns table (
  key text,
  kind text,
  label text,
  depth int,
  path text[],
  relation_path text[],
  source_path text[],
  direction_path text[]
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
           array[]::text[] as source_path, array[]::text[] as direction_path
    from kb_node n
    where n.key = start_key and n.status = 'approved'
    union all
    select m.node_id, m.key, m.kind, m.label, w.depth + 1,
           w.path || m.key, w.relation_path || e.relation, w.source_path || e.source_ref,
           w.direction_path || case when e.src_node_id = w.node_id then 'out' else 'in' end
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
      -- The visited set is what makes `both` terminate at all: without it every edge would be
      -- walked forwards and immediately backwards, forever.
      and not (m.key = any (w.path))
  )
  select w.key, w.kind, w.label, w.depth, w.path, w.relation_path, w.source_path, w.direction_path
  from walk w
  where w.depth > 0
  order by w.depth, w.key
  limit cap;
end;
$$;

revoke execute on function traverse_kb(text, text, text[], int, int) from public;
grant execute on function traverse_kb(text, text, text[], int, int) to service_role;
