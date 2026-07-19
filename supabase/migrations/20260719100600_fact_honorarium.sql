create table fact_honorarium (
  id bigint generated always as identity primary key,
  bhw_id bigint not null references fact_bhw_raw (bhw_id),
  payer_level payer_level_enum not null,
  receives boolean not null,
  amount numeric,
  frequency honorarium_frequency_enum,
  normalized_monthly_amount numeric,
  source_note text
);

create index fact_honorarium_bhw_id_idx on fact_honorarium (bhw_id);

alter table fact_honorarium enable row level security;
-- service-role only: no anon/authenticated policies.
