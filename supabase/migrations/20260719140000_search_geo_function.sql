-- "Find my barangay" search (increment 1.3): combines full-text search over
-- agg_geo_summary.search_text (exact/partial term matches, e.g. "CALABARZON")
-- with pg_trgm word_similarity over dim_geo.geo_name (typo tolerance, e.g. a
-- misspelled municipality — "Dumagete" still finds "CITY OF DUMAGUETE").
-- word_similarity (not plain similarity) is deliberate: it scores the best
-- matching word-boundary substring of the target, so a short query like
-- "caloocan" still scores ~1.0 against a longer name like "CITY OF CALOOCAN"
-- (plain similarity compares whole-string trigram sets and scores that low).
--
-- Full-text matches are boosted (+100) to always outrank fuzzy matches, since
-- ts_rank and word_similarity aren't on comparable scales.

create index dim_geo_geo_name_lower_trgm_idx on dim_geo using gin (lower(geo_name) extensions.gin_trgm_ops);

create or replace function search_geo(search_query text, result_limit int default 8)
returns table (
  geo_code text,
  geo_level geo_level_enum,
  geo_name text,
  n_total integer,
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
  select geo_code, geo_level, geo_name, n_total, max(rank) as match_rank
  from combined
  group by geo_code, geo_level, geo_name, n_total
  order by match_rank desc, n_total desc nulls last
  limit result_limit;
$$;

grant execute on function search_geo(text, int) to anon, authenticated;
