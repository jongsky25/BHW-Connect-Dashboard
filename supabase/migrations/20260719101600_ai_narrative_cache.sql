create table ai_narrative_cache (
  cache_key text primary key,
  content_md text,
  provider text,
  model text,
  generated_at timestamptz not null default now(),
  data_version text
);

alter table ai_narrative_cache enable row level security;
-- service-role only: no anon/authenticated policies.
