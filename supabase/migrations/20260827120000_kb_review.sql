-- Internal AI assistant, Increment 3.2 (docs/AI_ASSISTANT_PLAN.md §8): the review queue.
--
-- Owner decision 5 says extracted rows are written at `status = 'auto'` and only `approved` rows
-- are citable. 3.1 wrote 169 such rows; this is where a person judges them. Two things are added.
--
-- 1. WHO LOOKED, AND WHEN. §7 argues against a review queue *for answers* because unbounded
--    review "gets done for a fortnight and then rubber-stamped — which is worse than no review,
--    because a checkmark then implies someone looked." Ingestion review is the opposite trade
--    (one-time per source, compounding), but the rubber-stamp failure is the same one, and an
--    approval with no reviewer and no timestamp is indistinguishable from one. So `reviewed_by`
--    and `reviewed_at` are recorded, and `review_note` carries why — most useful on a rejection,
--    where the reason is the whole content of the decision.
--
-- 2. AN APPROVED EDGE ALWAYS HAS APPROVED ENDPOINTS. `traverse_kb` requires `status = 'approved'`
--    on the edge AND on both nodes, so an edge approved while an endpoint is still `auto` is
--    approved and invisible — the worst state, because the queue says it was handled and the
--    traversal disagrees. The trigger refuses it from both directions: an edge cannot become
--    approved while an endpoint is not, and a node cannot leave `approved` while an approved edge
--    still points at it. The review layer therefore rejects an edge before its node, which is the
--    order a reviewer would take anyway.
--
--    Enforced in the database, per 3.1's reasoning: a guardrail here holds however a row is
--    written, and this one has to survive a later admin surface nobody has designed yet.
alter table kb_node add column reviewed_at timestamptz;
alter table kb_node add column reviewed_by text;
alter table kb_node add column review_note text;
alter table kb_edge add column reviewed_at timestamptz;
alter table kb_edge add column reviewed_by text;
alter table kb_edge add column review_note text;

create or replace function kb_edge_endpoints_are_approved()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  unapproved text;
begin
  if new.status is distinct from 'approved' then
    return new;
  end if;
  select string_agg(n.key || ' (' || n.status || ')', ', ')
    into unapproved
    from kb_node n
   where n.node_id in (new.src_node_id, new.dst_node_id)
     and n.status <> 'approved';
  if unapproved is not null then
    raise exception 'kb_edge: cannot approve an edge whose endpoints are not approved: %', unapproved
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function kb_node_keeps_its_approved_edges()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  dependent int;
begin
  if new.status = 'approved' or old.status <> 'approved' then
    return new;
  end if;
  select count(*) into dependent
    from kb_edge e
   where e.status = 'approved'
     and (e.src_node_id = new.node_id or e.dst_node_id = new.node_id);
  if dependent > 0 then
    raise exception
      'kb_node: % still has % approved edge(s); reject or unapprove those first', new.key, dependent
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger kb_edge_endpoints_approved
  before insert or update on kb_edge
  for each row execute function kb_edge_endpoints_are_approved();

create trigger kb_node_approved_edges
  before update on kb_node
  for each row execute function kb_node_keeps_its_approved_edges();
