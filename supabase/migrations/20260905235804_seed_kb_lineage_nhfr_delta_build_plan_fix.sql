-- Follow-up to seed_kb_lineage_nhfr_delta: doc:docs/BUILD_PLAN.md had no node yet, so the two
-- reconciled-in edges pointing at it silently joined to nothing and were dropped. Folded into
-- 20260905235625_seed_kb_lineage_nhfr_delta.sql's committed source for the next regeneration;
-- this is the same content applied live.
with refs (ref, source_ref, source_kind) as (values
  ('r12', 'supabase/migrations/20260905090000_fact_nhfr_facility.sql', 'migration')
)
insert into kb_node (key, kind, label, origin, source_kind, source_ref, status)
select 'doc:docs/BUILD_PLAN.md', 'document', 'docs/BUILD_PLAN.md', 'asserted', r.source_kind, r.source_ref, 'approved'
from refs r where r.ref = 'r12'
on conflict (key) do update set
  kind = excluded.kind, label = excluded.label, origin = excluded.origin,
  source_kind = excluded.source_kind, source_ref = excluded.source_ref,
  status = excluded.status, updated_at = now();

with refs (ref, source_ref, source_kind) as (values
  ('r12', 'supabase/migrations/20260905090000_fact_nhfr_facility.sql', 'migration'),
  ('r103', 'supabase/migrations/20260905090200_agg_nhfr_counts.sql', 'migration')
),
edge_input (src_key, relation, dst_key, ref) as (values
  ('table:fact_nhfr_facility', 'reconciled-in', 'doc:docs/BUILD_PLAN.md', 'r12'),
  ('table:agg_nhfr_counts', 'reconciled-in', 'doc:docs/BUILD_PLAN.md', 'r103')
)
insert into kb_edge (src_node_id, relation, dst_node_id, origin, source_kind, source_ref, status)
select s.node_id, e.relation, d.node_id, 'asserted', r.source_kind, r.source_ref, 'approved'
from edge_input e
join refs r on r.ref = e.ref
join kb_node s on s.key = e.src_key
join kb_node d on d.key = e.dst_key
on conflict (src_node_id, relation, dst_node_id) do update set
  origin = excluded.origin, source_kind = excluded.source_kind,
  source_ref = excluded.source_ref, status = excluded.status, updated_at = now();
