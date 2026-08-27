-- Internal AI assistant, Increment 3.1 (docs/AI_ASSISTANT_PLAN.md §8): document extraction.
--
-- Phase 1 created kb_node/kb_edge and populated them from structure this repository asserts.
-- This is the first increment that writes rows a *model* proposed, and everything here exists to
-- keep those rows distinguishable from asserted ones and refusable when they are not grounded.
--
-- WHAT CHANGES, AND WHY EACH PIECE IS HERE
--
-- 1. Two node kinds. `program` and `organization` join the existing list. The deck's subjects are
--    programmes (UUC for PHC, PuroKalusugan, the LGU Health Scorecard) and the bodies that issue
--    policy about them (DOH, COA, DILG, NCIP). Both would fit the catch-all `entity`, and that is
--    the argument against it: §9.9 asks that things be distinguishable by column rather than by
--    convention, and a review queue that cannot tell a programme from an agency without reading
--    the label is a queue that gets skimmed.
--
-- 2. Three relations. `defined-by` (a programme is established or governed by an issuance),
--    `issued-by` (an issuance comes from a body) and `part-of` (a programme sits inside a
--    programme set). The vocabulary is deliberately small: a check constraint is what makes this
--    extraction TYPED rather than free-form, and a relation the deck states on ten slides is
--    checkable in a way that a relation invented for one slide is not. 3.4 adds its own three.
--
-- 3. `evidence_quote`, and a trigger that refuses a row whose quote is not in its chunk.
--    This is the load-bearing part. The Verify for 3.1 asks that "every edge resolves to a chunk
--    whose text actually supports it", and `source_chunk_id` alone cannot deliver that: it says
--    which chunk was READ, not that the chunk SAYS this. A verbatim span does, and a hallucinated
--    triple almost always arrives with a hallucinated quotation, so the check has real teeth.
--
--    It is enforced here rather than in the loader for the reason 1.6 put the traversal in
--    Postgres and 2.2 put the search there: a guardrail in the database holds however the row is
--    written, including by the next extractor nobody has written yet. `position()` rather than
--    `like` so the quote needs no escaping, and the exception names the chunk and the quote so a
--    rejected batch is diagnosable without re-running the model.
--
--    The trigger also enforces the inverse: a row that is NOT chunk-sourced must not carry an
--    evidence quote. A lineage edge asserted by a migration has a file behind it, not a passage,
--    and letting it carry a quotation would make the column mean two things.
alter table kb_node drop constraint kb_node_kind_check;
alter table kb_node add constraint kb_node_kind_check check (
  kind in ('dataset', 'table', 'column', 'migration', 'ingestion_script', 'document',
           'geography', 'issuance', 'entity', 'program', 'organization')
);

alter table kb_edge drop constraint kb_edge_relation_check;
alter table kb_edge add constraint kb_edge_relation_check check (
  relation in ('derived-from', 'built-by', 'reconciled-in', 'joins-on', 'has-column',
               'defined-by', 'issued-by', 'part-of')
);

alter table kb_node add column evidence_quote text;
alter table kb_edge add column evidence_quote text;

comment on column kb_node.evidence_quote is
  'The verbatim span of doc_chunk.content that supports this row. Required for source_kind = ''chunk'' and forbidden otherwise; enforced by kb_evidence_is_grounded().';
comment on column kb_edge.evidence_quote is
  'The verbatim span of doc_chunk.content that supports this row. Required for source_kind = ''chunk'' and forbidden otherwise; enforced by kb_evidence_is_grounded().';

create or replace function kb_evidence_is_grounded()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  chunk_text text;
begin
  if new.source_kind is distinct from 'chunk' then
    if new.evidence_quote is not null then
      raise exception '%: evidence_quote is for chunk-sourced rows; this row is sourced from %',
        tg_table_name, new.source_kind using errcode = '23514';
    end if;
    return new;
  end if;

  if new.evidence_quote is null or btrim(new.evidence_quote) = '' then
    raise exception '%: a chunk-sourced row must quote the text that supports it', tg_table_name
      using errcode = '23514';
  end if;

  select content into chunk_text from doc_chunk where chunk_id = new.source_chunk_id;
  if chunk_text is null then
    raise exception '%: source chunk % has no content to be supported by', tg_table_name,
      new.source_chunk_id using errcode = '23503';
  end if;

  if position(new.evidence_quote in chunk_text) = 0 then
    raise exception '%: evidence quote is not present verbatim in chunk % (%)',
      tg_table_name, new.source_chunk_id, left(new.evidence_quote, 80) using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger kb_node_evidence_grounded
  before insert or update on kb_node
  for each row execute function kb_evidence_is_grounded();

create trigger kb_edge_evidence_grounded
  before insert or update on kb_edge
  for each row execute function kb_evidence_is_grounded();

-- The review queue (3.2) reads "everything not yet judged", which is a scan over (status, origin)
-- on tables whose existing indexes are all partial on status = 'approved' — i.e. indexes that
-- deliberately exclude exactly the rows the queue wants.
create index kb_node_review_idx on kb_node (status, origin) where status = 'auto';
create index kb_edge_review_idx on kb_edge (status, origin) where status = 'auto';
