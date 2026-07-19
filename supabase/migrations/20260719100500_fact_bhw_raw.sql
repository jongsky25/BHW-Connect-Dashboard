create table fact_bhw_raw (
  bhw_id bigint generated always as identity primary key,
  geo_code text not null references dim_geo (geo_code),
  sex text,
  civil_status text,
  age smallint,
  bloodtype text,
  educational_attainment text,
  ip_status text,
  household smallint,
  registered_year smallint,
  accredited boolean,
  accreditation_year smallint,
  tesda_nc2 boolean,
  tesda_nc2_year smallint,
  tesda_certified boolean,
  tesda_certified_year smallint,
  ref_manual_trained boolean,
  ref_manual_year smallint,
  active_years smallint[],
  active_years_count smallint,
  first_active_year smallint,
  last_active_year smallint,
  inactive_years smallint[],
  inactive_years_count smallint,
  training jsonb,
  ingestion_batch_id bigint references ingestion_batches (batch_id)
);

create index fact_bhw_raw_geo_code_idx on fact_bhw_raw (geo_code);

alter table fact_bhw_raw enable row level security;
-- service-role only: no anon/authenticated policies. Never exposed through PostgREST to browsers.
