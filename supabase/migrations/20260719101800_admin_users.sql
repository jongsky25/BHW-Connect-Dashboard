create table admin_users (
  user_id uuid primary key references auth.users (id),
  role admin_role_enum not null
);

alter table admin_users enable row level security;
-- service-role only: no anon/authenticated policies. Auth checks happen server-side against this table.
