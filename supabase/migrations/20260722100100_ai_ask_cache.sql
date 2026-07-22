-- Ask-the-Data answer bank (docs/ASK_CACHE_PLAN.md §4, Phase A2): one audited answer per
-- (data_version, geo scope, normalized question), checked before the AI provider cascade on
-- single-turn questions. Keyed on data_version like ai_narrative_cache, so a dataset refresh
-- invalidates every entry automatically.
create table ai_ask_cache (
  cache_key text primary key,
  question_norm text not null,
  question_display text not null,
  geo_code text,
  answer_md text not null,
  provider text,
  data_version text not null,
  status text not null default 'auto',
  hit_count int not null default 0,
  generated_at timestamptz not null default now(),
  last_hit_at timestamptz
);

create index ai_ask_cache_norm_idx on ai_ask_cache (question_norm);

alter table ai_ask_cache enable row level security;
-- service-role only: no anon/authenticated policies.
