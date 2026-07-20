-- Spot (pin-based) feedback: a user can point at a specific element on any public page and
-- comment on it. These columns extend the existing `feedback` table additively — every one is
-- nullable, so rows from the plain `/feedback` form (which never set them) stay valid and the
-- old flow keeps working with no backfill.
alter table feedback
  add column page_url text,          -- full URL incl. query string (captures nuqs filter state)
  add column target_selector text,   -- CSS selector path to the pinned element
  add column context jsonb,          -- { tag, id, elementText, ariaLabel, role, rect, pin, viewport, scroll, userAgent }
  add column screenshot_path text;   -- object path in the feedback-screenshots bucket (null if capture failed/omitted)

-- Private bucket for pin screenshots. They can contain whatever the submitter had on screen, so —
-- like the `feedback` table itself (public-insert-only, never public-read) — nothing here is
-- world-readable. Uploads and admin reads both go through the service-role client, which bypasses
-- storage RLS entirely, so no storage policies are needed for the anon/authenticated roles.
insert into storage.buckets (id, name, public)
values ('feedback-screenshots', 'feedback-screenshots', false)
on conflict (id) do nothing;
