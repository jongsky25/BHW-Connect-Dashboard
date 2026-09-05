-- D3.3 (docs/LEGISLATIVE_DISTRICTS_PLAN.md §6) -- "/api/geo/search: districts become searchable by
-- name and by member LGU, so 'Palo' surfaces 'Leyte's 1st'."
--
-- A district is not a geo_level (plan §1) and is never mixed into dim_geo or agg_geo_summary
-- (guardrail 7), so it can't just ride search_geo's existing fts/trgm union -- it gets its own
-- function instead, in the same pg_trgm word_similarity style search_geo already uses (typo
-- tolerance, short-query-scores-high-against-a-longer-name behavior). Two ways a query can hit a
-- district: the district's own name ("Leyte's 1st"), or one of its live member LGUs' names
-- ("Palo") -- geo_district_map already carries that membership. Rejected/superseded rows are
-- excluded the same way district_index (20260903060000) already does.
--
-- One row per district in the result: `distinct on (district_code) ... order by ... rank desc`
-- keeps only the best-scoring hit per district even when both its own name and more than one
-- member name score above the threshold, so "Leyte" doesn't return "Leyte's 1st" four times over.
create index dim_legislative_district_name_lower_trgm_idx
  on dim_legislative_district using gin (lower(district_name) extensions.gin_trgm_ops);

create or replace function search_district(search_query text, result_limit int default 8)
returns table (
  district_code text,
  district_name text,
  -- The member LGU name that matched, when the hit came from membership rather than the district's
  -- own name -- null means the district name itself was the best match. Lets the UI show "Palo,
  -- Leyte" under "Leyte's 1st" the same way search_geo's parent_chain disambiguates a geo hit.
  matched_member_name text,
  match_rank real
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with live as (
    select district_code, geo_code
    from geo_district_map
    where superseded_by is null and status <> 'rejected'
  ),
  by_name as (
    select
      d.district_code,
      d.district_name,
      null::text as matched_member_name,
      word_similarity(lower(search_query), lower(d.district_name)) as rank
    from dim_legislative_district d
    where d.status <> 'rejected'
      and word_similarity(lower(search_query), lower(d.district_name)) > 0.3
  ),
  by_member as (
    select
      d.district_code,
      d.district_name,
      g.geo_name as matched_member_name,
      word_similarity(lower(search_query), lower(g.geo_name)) as rank
    from live l
    join dim_legislative_district d on d.district_code = l.district_code
    join dim_geo g on g.geo_code = l.geo_code
    where d.status <> 'rejected'
      and word_similarity(lower(search_query), lower(g.geo_name)) > 0.3
  ),
  combined as (
    select * from by_name
    union all
    select * from by_member
  ),
  best_per_district as (
    select distinct on (district_code) district_code, district_name, matched_member_name, rank
    from combined
    order by district_code, rank desc
  )
  select district_code, district_name, matched_member_name, rank as match_rank
  from best_per_district
  order by match_rank desc
  limit result_limit;
$$;

grant execute on function search_district(text, int) to anon, authenticated;
