-- Lineage delta for the NHFR registration (docs/NHFR_2026_PLAN.md, increment N5).
--
-- The canonical graph is supabase/migrations/20260826120100_seed_kb_lineage.sql, which
-- `python ingestion/build_kb_lineage.py` regenerates whole from the committed files. This file
-- carries only the rows that regeneration adds, to the live project — the same pattern as the
-- U8, U9, U10, U11, U12b, D1.6 and district_correction lineage deltas.
--
-- This delta is larger than those: plan N1/N2 shipped fact_nhfr_facility, agg_nhfr_counts and
-- agg_nhfr_by_type live with no lineage seed at all, so this is the first lineage for all three —
-- not only the columns the N5 registry migration newly describes. 8 nodes (a dataset, 2 ingestion
-- scripts, 4 migrations, one doc already reachable from elsewhere gets no new node here) plus 7
-- join-key columns and 3 tables, and 30 edges: built-by (table <- migration/script), derived-from
-- (table -> dataset:nhfr-2026-09), has-column and joins-on (from the N5 registry's is_join_key
-- columns), and reconciled-in (table -> the docs each migration's own header names).
--
-- ONE NODE THE GENERATOR ADDS IS NOT ABOUT THIS DELTA, AND IS NOT A MISTAKE, on
-- 20260905040100_seed_kb_lineage_district_correction_delta.sql's precedent: regeneration also
-- produces migration:20260905235556_seed_registry_nhfr.sql (the N5 registry migration earns a
-- node because its header text happens to name a docs/*.md path), carrying no edges. Left out
-- here for the same reason that file gave: it describes a migration that writes no table or
-- column this delta is about, and including it would go stale as soon as some other future
-- migration's header is the next to mention a path incidentally.
with refs (ref, source_ref, source_kind) as (values
  ('r1', 'supabase/migrations/20260826090100_seed_dataset_registry.sql', 'registry'),
  ('r5', 'supabase/migrations/20260905090100_seed_dim_dataset_nhfr.sql', 'migration'),
  ('r12', 'supabase/migrations/20260905090000_fact_nhfr_facility.sql', 'migration'),
  ('r24', 'ingestion/ingest_nhfr.py', 'ingestion_script'),
  ('r28', 'ingestion/patch_dim_geo_nhfr_gap.py', 'ingestion_script'),
  ('r103', 'supabase/migrations/20260905090200_agg_nhfr_counts.sql', 'migration'),
  ('r104', 'supabase/migrations/20260905090300_agg_nhfr_by_type.sql', 'migration')
),
node_input (key, ref) as (values
  ('dataset:nhfr-2026-09', 'r5'),
  ('doc:docs/NHFR_2026_PLAN.md', 'r1'),
  -- BUILD_PLAN.md is named in fact_nhfr_facility.sql's own header (its bed_capacity/licensing
  -- discipline follows BUILD_PLAN's pitfall P16 precedent), but no earlier increment's lineage
  -- delta had created this node yet — so the reconciled-in edges to it below would otherwise
  -- silently join to nothing and vanish, the same way a missing built-by edge would if the
  -- generator did not print it. Full regeneration produces this node too; it belongs here.
  ('doc:docs/BUILD_PLAN.md', 'r12'),
  ('script:ingestion/ingest_nhfr.py', 'r24'),
  ('script:ingestion/patch_dim_geo_nhfr_gap.py', 'r28'),
  ('migration:20260905090000_fact_nhfr_facility.sql', 'r12'),
  ('migration:20260905090100_seed_dim_dataset_nhfr.sql', 'r5'),
  ('migration:20260905090200_agg_nhfr_counts.sql', 'r103'),
  ('migration:20260905090300_agg_nhfr_by_type.sql', 'r104'),
  ('table:fact_nhfr_facility', 'r12'),
  ('table:agg_nhfr_counts', 'r103'),
  ('table:agg_nhfr_by_type', 'r104'),
  ('column:fact_nhfr_facility.dataset_id', 'r1'),
  ('column:fact_nhfr_facility.geo_code', 'r1'),
  ('column:fact_nhfr_facility.barangay_geo_code', 'r1'),
  ('column:agg_nhfr_counts.dataset_id', 'r1'),
  ('column:agg_nhfr_counts.geo_code', 'r1'),
  ('column:agg_nhfr_by_type.dataset_id', 'r1'),
  ('column:agg_nhfr_by_type.geo_code', 'r1')
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
  ('r12', 'supabase/migrations/20260905090000_fact_nhfr_facility.sql', 'migration'),
  ('r24', 'ingestion/ingest_nhfr.py', 'ingestion_script'),
  ('r28', 'ingestion/patch_dim_geo_nhfr_gap.py', 'ingestion_script'),
  ('r103', 'supabase/migrations/20260905090200_agg_nhfr_counts.sql', 'migration'),
  ('r104', 'supabase/migrations/20260905090300_agg_nhfr_by_type.sql', 'migration')
),
edge_input (src_key, relation, dst_key, ref, note) as (values
  ('table:fact_nhfr_facility', 'built-by', 'migration:20260905090000_fact_nhfr_facility.sql', 'r12', 'create table'),
  ('table:fact_nhfr_facility', 'built-by', 'script:ingestion/ingest_nhfr.py', 'r24', 'writes'),
  ('table:agg_nhfr_counts', 'built-by', 'migration:20260905090200_agg_nhfr_counts.sql', 'r103', 'create table'),
  ('table:agg_nhfr_by_type', 'built-by', 'migration:20260905090300_agg_nhfr_by_type.sql', 'r104', 'create table'),
  ('table:dim_geo', 'built-by', 'script:ingestion/patch_dim_geo_nhfr_gap.py', 'r28', 'writes'),
  ('table:ingestion_batches', 'built-by', 'script:ingestion/ingest_nhfr.py', 'r24', 'writes'),
  ('table:fact_nhfr_facility', 'derived-from', 'dataset:nhfr-2026-09', 'r1', 'registered source dataset'),
  ('table:agg_nhfr_counts', 'derived-from', 'dataset:nhfr-2026-09', 'r1', 'registered source dataset'),
  ('table:agg_nhfr_by_type', 'derived-from', 'dataset:nhfr-2026-09', 'r1', 'registered source dataset'),
  ('table:fact_nhfr_facility', 'has-column', 'column:fact_nhfr_facility.dataset_id', 'r1', 'join key'),
  ('table:fact_nhfr_facility', 'has-column', 'column:fact_nhfr_facility.geo_code', 'r1', 'join key'),
  ('table:fact_nhfr_facility', 'has-column', 'column:fact_nhfr_facility.barangay_geo_code', 'r1', 'join key'),
  ('table:agg_nhfr_counts', 'has-column', 'column:agg_nhfr_counts.dataset_id', 'r1', 'join key'),
  ('table:agg_nhfr_counts', 'has-column', 'column:agg_nhfr_counts.geo_code', 'r1', 'join key'),
  ('table:agg_nhfr_by_type', 'has-column', 'column:agg_nhfr_by_type.dataset_id', 'r1', 'join key'),
  ('table:agg_nhfr_by_type', 'has-column', 'column:agg_nhfr_by_type.geo_code', 'r1', 'join key'),
  ('column:fact_nhfr_facility.dataset_id', 'joins-on', 'column:dim_dataset.dataset_id', 'r1', null),
  ('column:fact_nhfr_facility.geo_code', 'joins-on', 'column:dim_geo.geo_code', 'r1', null),
  ('column:fact_nhfr_facility.barangay_geo_code', 'joins-on', 'column:dim_geo.geo_code', 'r1', null),
  ('column:agg_nhfr_counts.dataset_id', 'joins-on', 'column:dim_dataset.dataset_id', 'r1', null),
  ('column:agg_nhfr_counts.geo_code', 'joins-on', 'column:dim_geo.geo_code', 'r1', null),
  ('column:agg_nhfr_by_type.dataset_id', 'joins-on', 'column:dim_dataset.dataset_id', 'r1', null),
  ('column:agg_nhfr_by_type.geo_code', 'joins-on', 'column:dim_geo.geo_code', 'r1', null),
  ('table:fact_nhfr_facility', 'reconciled-in', 'doc:docs/NHFR_2026_PLAN.md', 'r12', null),
  ('table:fact_nhfr_facility', 'reconciled-in', 'doc:docs/BUILD_PLAN.md', 'r12', null),
  ('table:fact_nhfr_facility', 'reconciled-in', 'doc:docs/EXPLORE_ENHANCEMENT_PLAN.md', 'r12', null),
  ('table:agg_nhfr_counts', 'reconciled-in', 'doc:docs/NHFR_2026_PLAN.md', 'r103', null),
  ('table:agg_nhfr_counts', 'reconciled-in', 'doc:docs/AI_ASSISTANT_PLAN.md', 'r103', null),
  ('table:agg_nhfr_counts', 'reconciled-in', 'doc:docs/BUILD_PLAN.md', 'r103', null),
  ('table:agg_nhfr_by_type', 'reconciled-in', 'doc:docs/NHFR_2026_PLAN.md', 'r104', null)
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
