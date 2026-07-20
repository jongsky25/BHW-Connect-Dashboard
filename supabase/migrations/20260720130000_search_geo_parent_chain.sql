-- Return the parent chain from "find my barangay" search (home-search review P0.1).
--
-- Thousands of barangays share a name ("Poblacion", "San Isidro", "San Jose"),
-- so a results list of bare place names is unusable — a user can't tell which
-- "Poblacion" is theirs, and can silently pick the wrong town's figures. The
-- parent locality names are already stored per geo in agg_geo_summary.parent_chain
-- (built in ingestion/build_aggregates.sql §8); this migration surfaces them from
-- search_geo so the UI can render "Poblacion — Carcar City, Cebu · Barangay".
--
-- Adding a column changes the function's return signature, so the function is
-- dropped and recreated. Ranking logic is unchanged from the original
-- (20260719140000_search_geo_function.sql): full-text matches (+100 boost)
-- always outrank pg_trgm word-similarity fuzzy matches.

drop function if exists search_geo(text, int);

create function search_geo(search_query text, result_limit int default 8)
returns table (
  geo_code text,
  geo_level geo_level_enum,
  geo_name text,
  n_total integer,
  parent_chain jsonb,
  match_rank real
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with fts as (
    select
      s.geo_code,
      s.geo_level,
      s.geo_name,
      s.n_total,
      s.parent_chain,
      100 + ts_rank(s.search_text, websearch_to_tsquery('simple', search_query)) as rank
    from agg_geo_summary s
    where s.search_text @@ websearch_to_tsquery('simple', search_query)
  ),
  trgm as (
    select
      g.geo_code,
      g.geo_level,
      g.geo_name,
      s.n_total,
      s.parent_chain,
      word_similarity(lower(search_query), lower(g.geo_name)) as rank
    from dim_geo g
    join agg_geo_summary s on s.geo_code = g.geo_code
    where word_similarity(lower(search_query), lower(g.geo_name)) > 0.3
  ),
  combined as (
    select * from fts
    union all
    select * from trgm
  )
  select geo_code, geo_level, geo_name, n_total, parent_chain, max(rank) as match_rank
  from combined
  group by geo_code, geo_level, geo_name, n_total, parent_chain
  order by match_rank desc, n_total desc nulls last
  limit result_limit;
$$;

grant execute on function search_geo(text, int) to anon, authenticated;
