-- Ask-the-Data near-match lookup (docs/ASK_CACHE_PLAN.md §7, Phase A4): trigram similarity over
-- normalized questions, so a phrasing variant ("region 7 accreditation rate" vs "accreditation
-- rate in region vii") can reuse a stored answer instead of a fresh live call.
--
-- Deliberately far stricter than the exact-match path:
--   * `approved` entries ONLY — the numeric audit verified the stored answer against the *stored*
--     question, not the asked one, so a near-match is only safe on a human-curated answer.
--   * same geo scope AND same data_version — never reuse across places or dataset versions.
--   * caller passes a high min_sim threshold; only the single best match at/above it is returned.
--
-- pg_trgm lives in the `extensions` schema (see 20260719100000_extensions.sql); schema-qualify
-- `similarity` and pin search_path, exactly like search_geo (20260719140000).

create index if not exists ai_ask_cache_question_norm_trgm_idx
  on ai_ask_cache using gin (question_norm extensions.gin_trgm_ops);

create or replace function match_ask_answer(
  q text,
  scope text,
  version text,
  min_sim real default 0.85
)
returns table (
  cache_key text,
  question_norm text,
  answer_md text,
  provider text,
  score real
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    c.cache_key,
    c.question_norm,
    c.answer_md,
    c.provider,
    extensions.similarity(c.question_norm, q) as score
  from ai_ask_cache c
  where c.status = 'approved'
    and c.data_version = version
    and coalesce(c.geo_code, 'national') = scope
    and extensions.similarity(c.question_norm, q) >= min_sim
  order by score desc
  limit 1;
$$;

-- Called only through the service-role client (ai_ask_cache is service-role-only); no grant to
-- anon/authenticated, unlike search_geo which serves the public search box.
