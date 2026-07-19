create table feedback (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  page_path text not null,
  category feedback_category_enum not null,
  message text not null check (char_length(message) <= 2000),
  email text,
  session_id uuid not null
);

alter table feedback enable row level security;

-- Public can submit feedback but never read it back (protects submitters' contact info).
create policy "feedback public insert" on feedback
  for insert
  to anon, authenticated
  with check (true);
