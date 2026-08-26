-- Internal AI assistant, Increment 1.6 (docs/AI_ASSISTANT_PLAN.md §8): the traversal primitive,
-- and the first recursive CTE in this project.
--
-- Two edge sources from the start, because a primitive proven against one edge shape is not
-- proven: `dim_geo.parent_code` (a containment tree over 43,746 geographies, in production since
-- July and never once walked) and the `kb_edge` lineage seeded in 1.5. `agg_geo_summary.
-- parent_chain` and `getGeoAncestors` are fixed three-level flattenings; `map_psgc_to_dim_geo()`
-- is a single hop. Neither can answer a question at arbitrary depth, which is the whole gap.
--
-- Every guardrail from §9.8 is enforced here, in the database, rather than trusted to the caller:
--
--   * maximum depth — clamped, and a request beyond the hard cap is REFUSED with an error rather
--     than silently served at a lower depth. A traversal whose depth is not what the caller asked
--     for produces an answer nobody can reproduce.
--   * visited-set cycle guard — the path array carries every node already visited, and a step
--     onto one of them is not taken. A cycle terminates instead of running until the timeout.
--   * row cap — clamped, applied to the result.
--   * statement timeout — set on the function itself, so it applies however the function is
--     called and cannot be forgotten by a caller.
--
-- Both functions return PATHS WITH PROVENANCE, not bare endpoints: the sequence of nodes walked,
-- and for lineage the relation and the source file behind each step. An endpoint a reader cannot
-- trace back is not usable in a briefing, whatever its depth.
--
-- EXECUTE is revoked from public and granted only to service_role: these functions read tables
-- that are service-role only, and PostgREST would otherwise expose them to anon.

create or replace function traverse_geo(
  start_code text,
  direction text default 'down',
  max_depth int default 3,
  row_cap int default 200
)
returns table (
  geo_code text,
  geo_level geo_level_enum,
  geo_name text,
  depth int,
  path text[]
)
language plpgsql
stable
security invoker
set statement_timeout = '5000ms'
-- Pinned search_path, same reason match_ask_answer pins one: an unpinned path is both a lint
-- finding and a real hijack surface for a function that resolves table names at call time.
set search_path = public, pg_temp
as $$
declare
  hard_max_depth constant int := 5;
  hard_row_cap constant int := 500;
  depth_limit int := coalesce(max_depth, 3);
  cap int := least(greatest(coalesce(row_cap, 200), 1), hard_row_cap);
begin
  if direction not in ('down', 'up') then
    raise exception 'traverse_geo direction must be down or up, got %', direction
      using errcode = '22023';
  end if;
  -- Refused, not clamped: see the header. The caller is told the cap so it can ask again.
  if depth_limit > hard_max_depth then
    raise exception 'traverse_geo max_depth % exceeds the limit of %', depth_limit, hard_max_depth
      using errcode = '22023';
  end if;
  depth_limit := greatest(depth_limit, 1);

  return query
  with recursive walk as (
    select g.geo_code, g.parent_code, g.geo_level, g.geo_name, 0 as depth, array[g.geo_code] as path
    from dim_geo g
    where g.geo_code = start_code
    union all
    select c.geo_code, c.parent_code, c.geo_level, c.geo_name, w.depth + 1, w.path || c.geo_code
    from walk w
    join dim_geo c
      on (direction = 'down' and c.parent_code = w.geo_code)
      or (direction = 'up' and c.geo_code = w.parent_code)
    where w.depth < depth_limit
      and not (c.geo_code = any (w.path))
  )
  select w.geo_code, w.geo_level, w.geo_name, w.depth, w.path
  from walk w
  where w.depth > 0
  order by w.depth, w.geo_code
  limit cap;
end;
$$;

create or replace function traverse_kb(
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
  source_path text[]
)
language plpgsql
stable
security invoker
set statement_timeout = '5000ms'
set search_path = public, pg_temp
as $$
declare
  hard_max_depth constant int := 6;
  hard_row_cap constant int := 500;
  depth_limit int := coalesce(max_depth, 3);
  cap int := least(greatest(coalesce(row_cap, 200), 1), hard_row_cap);
begin
  if direction not in ('out', 'in') then
    raise exception 'traverse_kb direction must be out or in, got %', direction
      using errcode = '22023';
  end if;
  if depth_limit > hard_max_depth then
    raise exception 'traverse_kb max_depth % exceeds the limit of %', depth_limit, hard_max_depth
      using errcode = '22023';
  end if;
  depth_limit := greatest(depth_limit, 1);

  return query
  with recursive walk as (
    select n.node_id, n.key, n.kind, n.label, 0 as depth,
           array[n.key] as path, array[]::text[] as relation_path, array[]::text[] as source_path
    from kb_node n
    where n.key = start_key and n.status = 'approved'
    union all
    select m.node_id, m.key, m.kind, m.label, w.depth + 1,
           w.path || m.key, w.relation_path || e.relation, w.source_path || e.source_ref
    from walk w
    join kb_edge e
      on (direction = 'out' and e.src_node_id = w.node_id)
      or (direction = 'in' and e.dst_node_id = w.node_id)
    join kb_node m
      on m.node_id = case when direction = 'out' then e.dst_node_id else e.src_node_id end
    where e.status = 'approved'
      and m.status = 'approved'
      and w.depth < depth_limit
      and (relations is null or e.relation = any (relations))
      and not (m.key = any (w.path))
  )
  select w.key, w.kind, w.label, w.depth, w.path, w.relation_path, w.source_path
  from walk w
  where w.depth > 0
  order by w.depth, w.key
  limit cap;
end;
$$;

revoke execute on function traverse_geo(text, text, int, int) from public;
revoke execute on function traverse_kb(text, text, text[], int, int) from public;
grant execute on function traverse_geo(text, text, int, int) to service_role;
grant execute on function traverse_kb(text, text, text[], int, int) to service_role;
