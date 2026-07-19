-- Phase 2 admin feedback triage (BUILD_PLAN.md §8 2.5) needs a status to triage against; the
-- original schema (§4.1) didn't include one. Additive, service-role-only column — no RLS change
-- needed, since feedback stays public-insert-only and every admin read already goes through the
-- service-role client (RLS is bypassed entirely for that role).
create type feedback_status_enum as enum ('open', 'resolved', 'dismissed');

alter table feedback
  add column status feedback_status_enum not null default 'open';
