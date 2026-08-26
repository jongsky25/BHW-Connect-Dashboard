-- Which dataset a piece of feedback is about (docs/UUC_PHC_2025_PLAN.md §9, U6).
--
-- `feedback` has carried only `page_path` since 20260719101400_feedback.sql. That was enough while
-- the site was one dataset; it is not now. A correction about the 2025 UUC for PHC list — "this
-- barangay should not be on it", which this dataset actively invites, since it has a known
-- ambiguous row and a published total four higher than the deck's — arrives in the same inbox as a
-- rendering bug on /explore, and the only thing separating them is a string match on a URL that
-- lives in the triager's head. The two are different pieces of work: one is routed to the source
-- office, the other is a ticket.
--
-- Nullable and additive, exactly like the spot-feedback columns before it: every existing row stays
-- valid with no backfill, and the plain /feedback form keeps working unchanged.
--
-- **Derived server-side from page_path, never sent by the client** (app/api/feedback/route.ts via
-- lib/feedback/dataset.ts). One derivation, one place, applied to spot feedback and the form alike;
-- a slug a caller could set is a slug a caller could set wrongly.
--
-- **Null is a real answer, not a gap.** Only sections that ARE one dataset's surface get a slug:
-- /uuc-phc, /profiling-status, /bhw and /place. /explore and /compare render BHW figures alongside
-- census population and SAE poverty, so naming one dataset there would be a claim the page does not
-- support; those rows stay null and are triaged by page_path as before. No foreign key to
-- dim_dataset for the same reason a page path is not a fact about the warehouse: this records what
-- the submitter was looking at, and it must survive a dataset being renamed or retired.
alter table feedback
  add column if not exists dataset_slug text;

-- Triage reads: "everything about the UUC list", newest first.
create index if not exists feedback_dataset_slug_idx
  on feedback (dataset_slug, created_at desc)
  where dataset_slug is not null;

comment on column feedback.dataset_slug is
  'dim_dataset.slug of the dataset the submitter was looking at, derived from page_path at write time (lib/feedback/dataset.ts). Null on multi-dataset or non-dataset pages, which is an answer rather than a gap. Not a foreign key: it records what was on screen and must outlive a dataset being retired.';
