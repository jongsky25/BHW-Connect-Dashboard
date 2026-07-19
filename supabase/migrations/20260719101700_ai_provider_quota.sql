create table ai_provider_quota (
  id bigint generated always as identity primary key,
  provider text not null,
  window_type quota_window_enum not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  limit_value integer not null,
  is_paused boolean not null default false,
  paused_until timestamptz,
  unique (provider, window_type, window_start)
);

alter table ai_provider_quota enable row level security;
-- service-role only: no anon/authenticated policies.
