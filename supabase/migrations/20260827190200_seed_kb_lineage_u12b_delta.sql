-- Lineage delta for agg_bhw_by_uuc_status (docs/UUC_PHC_2025_PLAN.md §9 U12b).
--
-- The canonical graph is supabase/migrations/20260826120100_seed_kb_lineage.sql, which
-- `python ingestion/build_kb_lineage.py` regenerates whole from the committed files. This file
-- carries only the rows that regeneration added, to the live project — the same pattern as the
-- U8, U9, U10 and U11 lineage deltas. Both inserts are upserts keyed the same way the generated
-- seed keys them, so applying either file leaves the graph in the same state.
--
-- Additive: 5 nodes and 11 edges, taking the graph from 209/368 to 214/379. The generator prints
-- nothing to stderr on the new file, which is the check that matters: a table with no `built-by`
-- edge is a finding, and this one has its own.

with node_input (key, ref) as (values
  ('column:agg_bhw_by_uuc_status.dataset_id', 'r1'),
  ('column:agg_bhw_by_uuc_status.geo_code', 'r1'),
  ('migration:20260827190000_agg_bhw_by_uuc_status.sql', 'r79'),
  ('migration:20260827190100_seed_registry_agg_bhw_by_uuc_status.sql', 'r80'),
  ('table:agg_bhw_by_uuc_status', 'r79')
),
refs (ref, source_ref, source_kind) as (values
  ('r1', 'supabase/migrations/20260826090100_seed_dataset_registry.sql', 'registry'),
  ('r79', 'supabase/migrations/20260827190000_agg_bhw_by_uuc_status.sql', 'migration'),
  ('r80', 'supabase/migrations/20260827190100_seed_registry_agg_bhw_by_uuc_status.sql', 'migration')
)
insert into kb_node (key, kind, label, origin, source_kind, source_ref, status)
select n.key,
  case split_part(n.key, ':', 1)
    when 'table' then 'table' when 'column' then 'column' when 'dataset' then 'dataset'
    when 'migration' then 'migration' when 'script' then 'ingestion_script'
    when 'doc' then 'document' end,
  substr(n.key, strpos(n.key, ':') + 1),
  'asserted', r.source_kind, r.source_ref, 'approved'
from node_input n join refs r on r.ref = n.ref
on conflict (key) do update set
  kind = excluded.kind, label = excluded.label, origin = excluded.origin,
  source_kind = excluded.source_kind, source_ref = excluded.source_ref,
  status = excluded.status, updated_at = now();

with refs (ref, source_ref, source_kind) as (values
  ('r1', 'supabase/migrations/20260826090100_seed_dataset_registry.sql', 'registry'),
  ('r79', 'supabase/migrations/20260827190000_agg_bhw_by_uuc_status.sql', 'migration'),
  ('r80', 'supabase/migrations/20260827190100_seed_registry_agg_bhw_by_uuc_status.sql', 'migration')
),
edge_input (src_key, relation, dst_key, ref, note) as (values
  ('table:agg_bhw_by_uuc_status', 'built-by', 'migration:20260827190000_agg_bhw_by_uuc_status.sql', 'r79', 'create table'),
  ('table:agg_bhw_by_uuc_status', 'defined-by', 'issuance:AO 2020-0023', 'r79', 'table comment'),
  ('table:agg_bhw_by_uuc_status', 'derived-from', 'dataset:uuc-phc-2025', 'r1', 'registered source dataset'),
  ('table:agg_bhw_by_uuc_status', 'derived-from', 'table:agg_bhw_stepzero_counts', 'r79', 'declared'),
  ('table:agg_bhw_by_uuc_status', 'derived-from', 'table:fact_uuc_phc_barangay', 'r79', 'declared'),
  ('table:agg_bhw_by_uuc_status', 'has-column', 'column:agg_bhw_by_uuc_status.dataset_id', 'r1', 'join key'),
  ('table:agg_bhw_by_uuc_status', 'has-column', 'column:agg_bhw_by_uuc_status.geo_code', 'r1', 'join key'),
  ('column:agg_bhw_by_uuc_status.dataset_id', 'joins-on', 'column:dim_dataset.dataset_id', 'r1', null),
  ('column:agg_bhw_by_uuc_status.geo_code', 'joins-on', 'column:dim_geo.geo_code', 'r1', null),
  ('table:agg_bhw_by_uuc_status', 'reconciled-in', 'doc:docs/DECISIONS.md', 'r79', null),
  ('table:agg_bhw_by_uuc_status', 'reconciled-in', 'doc:docs/UUC_PHC_2025_PLAN.md', 'r79', null)
)
insert into kb_edge (src_node_id, relation, dst_node_id, origin, source_kind, source_ref, note, status)
select s.node_id, e.relation, d.node_id, 'asserted', r.source_kind, r.source_ref, e.note, 'approved'
from edge_input e
join refs r on r.ref = e.ref
join kb_node s on s.key = e.src_key
join kb_node d on d.key = e.dst_key
on conflict (src_node_id, relation, dst_node_id) do update set
  origin = excluded.origin, source_kind = excluded.source_kind,
  source_ref = excluded.source_ref, note = excluded.note,
  status = excluded.status, updated_at = now();
