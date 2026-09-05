-- Lineage delta for district_correction's registry entry (docs/LEGISLATIVE_DISTRICTS_PLAN.md
-- §5 D2.6).
--
-- The canonical graph is supabase/migrations/20260826120100_seed_kb_lineage.sql, which
-- `python ingestion/build_kb_lineage.py` regenerates whole from the committed files. This file
-- carries only the rows that regeneration added, to the live project — the same pattern as the
-- U8, U9, U10, U11, U12b and D1.6 lineage deltas. Both inserts are upserts keyed the way the
-- generated seed keys them, so applying either file leaves the graph in the same state.
--
-- Additive: 4 nodes and 8 edges. `table:district_correction` has been a node since D1.6 (it is
-- created by 20260902030000_legislative_districts.sql), but it was a table nobody had registered:
-- built by a migration, reconciled in two documents, and attached to no dataset. Registering it
-- gives it the three edges every other district relation already had — `derived-from`
-- dataset:ph-legislative-districts, `reconciled-in` docs/LEGISLATIVE_DISTRICTS.md, and
-- `has-column` / `joins-on` for its three join keys — which is what lets a traversal reach a
-- correction from the district it concerns rather than only from the migration that built it.
--
-- ONE NODE HERE IS NOT ABOUT D2.6, AND IS NOT A MISTAKE.
-- migration:20260903050200_seed_kb_lineage_districts_delta.sql is a node the regeneration added on
-- its own, not something this increment asked for. The generator keeps any migration whose raw
-- text names the dataset dimension table, and D1.6's lineage delta names it only inside one of the
-- filenames it lists as provenance — so the delta earned a node describing a file that writes
-- nothing but graph rows, and the node carries no edges. Tightening that condition to match the
-- insert statement instead, which is what the generator's own docstring says the read is for, was
-- tried here and reverted: it also dropped ten migration nodes predating this increment, and
-- rewriting the graph on the way past is not D2.6's to do. Recorded so the next person to
-- regenerate meets it named rather than has to rediscover it.
--
-- (This file is deliberately written without that table's name spelled out, so it does not earn a
-- node of its own by the same accident and leave the committed seed stale the moment it lands.)

with refs (ref, source_ref, source_kind) as (values
  ('r1', 'supabase/migrations/20260826090100_seed_dataset_registry.sql', 'registry'),
  ('r96', 'supabase/migrations/20260903050200_seed_kb_lineage_districts_delta.sql', 'migration')
),
node_input (key, ref) as (values
  ('column:district_correction.district_code', 'r1'),
  ('column:district_correction.geo_code', 'r1'),
  ('column:district_correction.to_district_code', 'r1'),
  ('migration:20260903050200_seed_kb_lineage_districts_delta.sql', 'r96')
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
  ('r1', 'supabase/migrations/20260826090100_seed_dataset_registry.sql', 'registry')
),
edge_input (src_key, relation, dst_key, ref, note) as (values
  ('column:district_correction.district_code', 'joins-on', 'column:dim_legislative_district.district_code', 'r1', null),
  ('column:district_correction.geo_code', 'joins-on', 'column:dim_geo.geo_code', 'r1', null),
  ('column:district_correction.to_district_code', 'joins-on', 'column:dim_legislative_district.district_code', 'r1', null),
  ('table:district_correction', 'derived-from', 'dataset:ph-legislative-districts', 'r1', 'registered source dataset'),
  ('table:district_correction', 'has-column', 'column:district_correction.district_code', 'r1', 'join key'),
  ('table:district_correction', 'has-column', 'column:district_correction.geo_code', 'r1', 'join key'),
  ('table:district_correction', 'has-column', 'column:district_correction.to_district_code', 'r1', 'join key'),
  ('table:district_correction', 'reconciled-in', 'doc:docs/LEGISLATIVE_DISTRICTS.md', 'r1', null)
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
