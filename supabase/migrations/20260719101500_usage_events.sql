create table usage_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  session_id uuid not null,
  event_type text not null,
  page_path text,
  geo_code text references dim_geo (geo_code),
  meta jsonb,
  ip_hash text
);

create index usage_events_created_at_idx on usage_events (created_at);

alter table usage_events enable row level security;

create policy "usage_events public insert" on usage_events
  for insert
  to anon, authenticated
  with check (true);
