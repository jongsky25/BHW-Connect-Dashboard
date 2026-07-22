-- Ask-the-Data capture log (docs/ASK_CACHE_PLAN.md §3, Phase A1): append-only record of every
-- chat turn — what was asked, what was answered, by which provider, served live or from the
-- answer bank. Analysis/curation source only; answers are never served from this table.
create table ai_ask_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  session_id uuid not null,
  question_raw text not null,
  question_norm text not null,
  geo_code text,
  geo_level text,
  turn_index int not null,
  answer_md text,
  outcome text not null,
  provider text,
  served_from text not null default 'live',
  data_version text,
  tool_trace jsonb,
  latency_ms int
);

create index ai_ask_log_question_norm_idx on ai_ask_log (question_norm);
create index ai_ask_log_created_at_idx on ai_ask_log (created_at);

alter table ai_ask_log enable row level security;
-- service-role only: no anon/authenticated policies.
