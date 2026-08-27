-- Which dataset an Ask-the-Data answer is about (docs/UUC_PHC_2025_PLAN.md §9 U8; §8 defect 3).
--
-- Until now there was exactly one chat surface, so "the dataset" was implicit: `data_version` was
-- always the BHW census's `last_updated_at` and `geo_code` was the only other scope. U8 adds a
-- second surface over a second dataset, and without a dataset dimension the two collide in three
-- places, all of them silent:
--
--   1. `askCacheKey(data_version, geo, question_norm)` — an identically-worded question asked on
--      /uuc-phc would be served the /bhw answer. It would pass the numeric audit, because it *is*
--      grounded — in the other dataset.
--   2. `match_ask_answer` does not read the cache key at all: it matches on the `data_version` and
--      `geo_code` *columns*, so fixing the key alone leaves the near-match path crossing datasets.
--      Two datasets sharing a `last_updated_at` is not a scenario to rely on being rare.
--   3. `refreshApprovedAskAnswers` re-runs approved rows through the tool loop on a version bump.
--      With no dataset on the row it would regenerate a UUC question against the BHW prompt and
--      the BHW tools, and store the result under the UUC question.
--
-- `dataset_slug` is a `dim_dataset.slug` value, deliberately with no foreign key: this records
-- which dataset an answer was about and must outlive that dataset being renamed or retired, the
-- same reasoning as `feedback.dataset_slug` (20260827090000).

-- Backfill before the constraint: every row predating this migration came from the one chat
-- surface that existed, which is the BHW census. Asserted, not inferred.
alter table ai_ask_cache add column if not exists dataset_slug text;
update ai_ask_cache set dataset_slug = 'bhw-2025' where dataset_slug is null;
alter table ai_ask_cache alter column dataset_slug set not null;

-- No default. A default would let a third surface that forgets to name its dataset inherit
-- 'bhw-2025' silently; NOT NULL with no default makes that write fail instead, and the write is
-- already best-effort (lib/ai/ask-cache.ts catches), so the failure direction is a cache miss.
create index if not exists ai_ask_cache_dataset_slug_idx on ai_ask_cache (dataset_slug);

-- The capture log is analysis-only and never served from, so a null here is a record of a surface
-- that did not declare a dataset rather than a serving hazard — nullable, but backfilled for the
-- same reason as above, so the answer-bank curation corpus (ASK_CACHE_PLAN.md §3) stays separable
-- by dataset from the first UUC turn onward.
alter table ai_ask_log add column if not exists dataset_slug text;
update ai_ask_log set dataset_slug = 'bhw-2025' where dataset_slug is null;

-- match_ask_answer gains the dataset filter. Recreated rather than replaced: `create or replace`
-- cannot change a function's argument list, and adding a defaulted parameter would leave two
-- overloads resolvable from the same call.
drop function if exists match_ask_answer(text, text, text, real);

create function match_ask_answer(
  q text,
  scope text,
  version text,
  dataset text,
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
    and c.dataset_slug = dataset
    and c.data_version = version
    and coalesce(c.geo_code, 'national') = scope
    and extensions.similarity(c.question_norm, q) >= min_sim
  order by score desc
  limit 1;
$$;

-- Called only through the service-role client (ai_ask_cache is service-role-only); no grant to
-- anon/authenticated, unchanged from 20260722110000.
