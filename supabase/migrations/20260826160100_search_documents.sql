-- Internal AI assistant, Increment 2.2 (docs/AI_ASSISTANT_PLAN.md §8): document retrieval.
--
-- "Vector search plus the already-installed pg_trgm for exact codes and memo numbers." Both
-- halves run here rather than in the route, for the reason 1.6 put the traversal in the database:
-- the guardrails — row cap, statement timeout, approved-only filter — then hold however the
-- function is called, not only when the one caller remembers them.
--
-- WHY TWO HALVES, AND WHY NEITHER IS ENOUGH ALONE
--
-- The corpus is a budget deck. Half the questions it answers are natural language ("what support
-- does DOH give BHWs") and half are identifier lookups ("what is DC No. 2025-0549"). Embeddings
-- are good at the first and quietly terrible at the second: a memo number is a near-random token
-- whose neighbours in embedding space are other numbers, so a vector-only search returns
-- plausible slides that do not contain the code. Trigram is the inverse — it finds the code
-- exactly and cannot tell that "honorarium" and "incentive" are related.
--
-- Ranks are fused with Reciprocal Rank Fusion (1/(k + rank), k = 60) rather than by blending
-- scores. A cosine distance and a trigram similarity are not on the same scale and never will be;
-- normalising them would invent a comparison. RRF only needs each half to order its own results,
-- which is the one thing both halves genuinely do.
--
-- DEGRADE, NEVER ERROR (§1). p_embedding is nullable, and when it is null this is a lexical-only
-- search that still returns rows. That is not a hypothetical path: at the time of writing no
-- embedding exists at all, because the dimension is measured from a live provider response
-- (2.1) and this project's build environment has no provider key. The tool reports which halves
-- actually ran, so a degraded retrieval is visible in the payload rather than silently thinner —
-- the same reasoning as queryDataset's warnings.
--
-- SECURITY. security invoker, pinned search_path, EXECUTE revoked from public and granted only to
-- service_role: this function reads doc_chunk, which is service-role only and holds internal
-- budget material (§12.5). PostgREST would otherwise expose it to anon.
create or replace function search_documents(
  p_query text,
  p_limit int default 8,
  p_embedding text default null,
  p_model text default null,
  p_doc_key text default null,
  p_min_lexical real default 0.2
)
returns table (
  chunk_id bigint,
  doc_key text,
  doc_title text,
  doc_as_of date,
  page_from int,
  page_to int,
  heading text,
  content text,
  char_start int,
  char_end int,
  lexical_score real,
  vector_distance real,
  matched_by text,
  score real
)
language plpgsql
stable
security invoker
set statement_timeout = '5000ms'
set search_path = public, extensions, pg_temp
as $$
declare
  hard_row_cap constant int := 25;
  -- RRF's damping constant. 60 is the value the original paper settled on and the one every
  -- implementation since has used; it is not tuned here because tuning it against a corpus of one
  -- document would be fitting noise. §10's regression list is what earns the right to change it.
  rrf_k constant int := 60;
  -- How deep each half ranks before fusion. Wider than the output so a result ranked 2nd by one
  -- half and 30th by the other can still surface; that recovery is the whole point of fusing.
  candidate_depth constant int := 40;
  effective_limit int;
begin
  if p_query is null or btrim(p_query) = '' then
    raise exception 'search_documents requires a non-empty query';
  end if;
  if p_limit is null or p_limit < 1 then
    effective_limit := 8;
  elsif p_limit > hard_row_cap then
    raise exception 'limit % exceeds the search limit of %', p_limit, hard_row_cap;
  else
    effective_limit := p_limit;
  end if;
  if p_embedding is not null and p_model is null then
    raise exception 'an embedding was supplied without naming the model that produced it';
  end if;

  return query
  with scoped as (
    -- Only approved sources are citable, mirroring the registry and kb_* tables. An empty chunk
    -- (a slide with no text layer) can never be a citation, so it is excluded from both halves
    -- rather than ranked at zero.
    select c.chunk_id, c.page_from, c.page_to, c.heading, c.content,
           c.char_start, c.char_end, s.key as doc_key, s.title as doc_title, s.as_of as doc_as_of
    from doc_chunk c
    join doc_source s on s.doc_id = c.doc_id
    where s.status = 'approved'
      and c.content <> ''
      and (p_doc_key is null or s.key = p_doc_key)
  ),
  lexical as (
    select sc.chunk_id,
           -- An exact substring beats any fuzzy score: that is the case this half exists for.
           -- word_similarity asks how well the query matches the best *extent* of the chunk,
           -- which is the right question for a short code inside a long slide (plain similarity()
           -- would divide by the whole slide's trigram count and score every long page near zero).
           greatest(
             case when sc.content ilike '%' || p_query || '%' then 1.0::real else 0.0::real end,
             word_similarity(p_query, sc.content)
           ) as lexical_score
    from scoped sc
    where sc.content ilike '%' || p_query || '%'
       or word_similarity(p_query, sc.content) >= p_min_lexical
  ),
  lexical_ranked as (
    select l.chunk_id, l.lexical_score,
           row_number() over (order by l.lexical_score desc, l.chunk_id) as rnk
    from lexical l
    order by l.lexical_score desc, l.chunk_id
    limit candidate_depth
  ),
  vector_ranked as (
    select e.chunk_id,
           (e.embedding <=> p_embedding::vector)::real as vector_distance,
           row_number() over (order by e.embedding <=> p_embedding::vector, e.chunk_id) as rnk
    from doc_chunk_embedding e
    join scoped sc on sc.chunk_id = e.chunk_id
    where p_embedding is not null
      and e.model = p_model
    order by e.embedding <=> p_embedding::vector, e.chunk_id
    limit candidate_depth
  ),
  fused as (
    select coalesce(lr.chunk_id, vr.chunk_id) as chunk_id,
           lr.lexical_score,
           vr.vector_distance,
           case
             when lr.chunk_id is not null and vr.chunk_id is not null then 'both'
             when lr.chunk_id is not null then 'lexical'
             else 'vector'
           end as matched_by,
           (coalesce(1.0 / (rrf_k + lr.rnk), 0.0)
            + coalesce(1.0 / (rrf_k + vr.rnk), 0.0))::real as score
    from lexical_ranked lr
    full outer join vector_ranked vr on vr.chunk_id = lr.chunk_id
  )
  select sc.chunk_id, sc.doc_key, sc.doc_title, sc.doc_as_of,
         sc.page_from, sc.page_to, sc.heading, sc.content, sc.char_start, sc.char_end,
         f.lexical_score, f.vector_distance, f.matched_by, f.score
  from fused f
  join scoped sc on sc.chunk_id = f.chunk_id
  order by f.score desc, sc.chunk_id
  limit effective_limit;
end;
$$;

revoke execute on function search_documents(text, int, text, text, text, real) from public;
grant execute on function search_documents(text, int, text, text, text, real) to service_role;
