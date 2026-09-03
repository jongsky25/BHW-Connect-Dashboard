-- Lineage delta for the legislative district mapping (docs/LEGISLATIVE_DISTRICTS_PLAN.md §4 D1.6).
--
-- The canonical graph is supabase/migrations/20260826120100_seed_kb_lineage.sql, which
-- `python ingestion/build_kb_lineage.py` regenerates whole from the committed files. This file
-- carries only the rows that regeneration added, to the live project — the same pattern as the
-- U8, U9, U10, U11 and U12b lineage deltas. Both inserts are upserts keyed the way the generated
-- seed keys them, so applying either file leaves the graph in the same state.
--
-- Additive: 23 nodes and 37 edges. The three tables come out `built-by` their migration AND their
-- ingestion script, `derived-from` dataset:ph-legislative-districts, and `reconciled-in`
-- docs/LEGISLATIVE_DISTRICTS.md, with `has-column` / `joins-on` for the six join keys.
--
-- Two things this delta carries that a narrower one would have missed, both found by counting
-- rather than by assuming:
--
--   * build_legislative_districts.py writes its three tables through insert_statement(table, ...)
--     with the table name a loop variable, so no `insert into <name>` literal exists for the
--     generator to find. The writes are declared with `-- lineage:` directives in the script, and
--     the generator now keeps a script node that a directive gave edges to instead of dropping it
--     as unearned — it used to pop the node and orphan those edges silently.
--   * doc:docs/LEGISLATIVE_DISTRICTS_PLAN.md is included as a node. It was already an endpoint of
--     four edges here and did not exist in the live graph; edges join to nodes by key and skip
--     silently when one is missing, so shipping the edges without the node would have loaded 33
--     of 37 and said nothing.

with node_input (key, ref) as (values
  ('column:dim_geo.geo_code', 'r1'),
  ('column:dim_legislative_district.district_code', 'r1'),
  ('column:dim_legislative_district.parent_geo_code', 'r1'),
  ('column:dim_legislative_district.region_code', 'r1'),
  ('column:district_representative.district_code', 'r1'),
  ('column:geo_district_map.district_code', 'r1'),
  ('column:geo_district_map.geo_code', 'r1'),
  ('dataset:ph-legislative-districts', 'r1'),
  ('doc:docs/DECISIONS.md', 'r11'),
  ('doc:docs/LEGISLATIVE_DISTRICTS.md', 'r1'),
  ('doc:docs/LEGISLATIVE_DISTRICTS_PLAN.md', 'r14'),
  ('migration:20260902030000_legislative_districts.sql', 'r90'),
  ('migration:20260902050000_district_corroboration.sql', 'r91'),
  ('migration:20260902070000_district_independent_city.sql', 'r92'),
  ('migration:20260902090000_district_whole_citymun.sql', 'r93'),
  ('migration:20260902110000_district_article_identity.sql', 'r94'),
  ('migration:20260903050000_seed_dim_dataset_legislative_districts.sql', 'r95'),
  ('script:ingestion/build_legislative_districts.py', 'r16'),
  ('script:ingestion/verify_rls.py', 'r27'),
  ('table:dim_legislative_district', 'r90'),
  ('table:district_correction', 'r90'),
  ('table:district_representative', 'r90'),
  ('table:geo_district_map', 'r90')
),
refs (ref, source_ref, source_kind) as (values
  ('r1', 'supabase/migrations/20260826090100_seed_dataset_registry.sql', 'registry'),
  ('r11', 'supabase/migrations/20260719100400_ingestion_batches.sql', 'migration'),
  ('r14', 'supabase/migrations/20260826120100_seed_kb_lineage.sql', 'migration'),
  ('r16', 'ingestion/build_legislative_districts.py', 'ingestion_script'),
  ('r27', 'ingestion/verify_rls.py', 'ingestion_script'),
  ('r90', 'supabase/migrations/20260902030000_legislative_districts.sql', 'migration'),
  ('r91', 'supabase/migrations/20260902050000_district_corroboration.sql', 'migration'),
  ('r92', 'supabase/migrations/20260902070000_district_independent_city.sql', 'migration'),
  ('r93', 'supabase/migrations/20260902090000_district_whole_citymun.sql', 'migration'),
  ('r94', 'supabase/migrations/20260902110000_district_article_identity.sql', 'migration'),
  ('r95', 'supabase/migrations/20260903050000_seed_dim_dataset_legislative_districts.sql', 'migration')
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
  ('r11', 'supabase/migrations/20260719100400_ingestion_batches.sql', 'migration'),
  ('r14', 'supabase/migrations/20260826120100_seed_kb_lineage.sql', 'migration'),
  ('r16', 'ingestion/build_legislative_districts.py', 'ingestion_script'),
  ('r27', 'ingestion/verify_rls.py', 'ingestion_script'),
  ('r90', 'supabase/migrations/20260902030000_legislative_districts.sql', 'migration'),
  ('r91', 'supabase/migrations/20260902050000_district_corroboration.sql', 'migration'),
  ('r92', 'supabase/migrations/20260902070000_district_independent_city.sql', 'migration'),
  ('r93', 'supabase/migrations/20260902090000_district_whole_citymun.sql', 'migration'),
  ('r94', 'supabase/migrations/20260902110000_district_article_identity.sql', 'migration'),
  ('r95', 'supabase/migrations/20260903050000_seed_dim_dataset_legislative_districts.sql', 'migration')
),
edge_input (src_key, relation, dst_key, ref, note) as (values
  ('column:dim_legislative_district.parent_geo_code', 'joins-on', 'column:dim_geo.geo_code', 'r1', null),
  ('column:dim_legislative_district.region_code', 'joins-on', 'column:dim_geo.geo_code', 'r1', null),
  ('column:district_representative.district_code', 'joins-on', 'column:dim_legislative_district.district_code', 'r1', null),
  ('column:geo_district_map.district_code', 'joins-on', 'column:dim_legislative_district.district_code', 'r1', null),
  ('column:geo_district_map.geo_code', 'joins-on', 'column:dim_geo.geo_code', 'r1', null),
  ('table:dim_legislative_district', 'built-by', 'migration:20260902030000_legislative_districts.sql', 'r90', 'create table'),
  ('table:dim_legislative_district', 'built-by', 'script:ingestion/build_legislative_districts.py', 'r16', 'declared'),
  ('table:dim_legislative_district', 'derived-from', 'dataset:ph-legislative-districts', 'r1', 'registered source dataset'),
  ('table:dim_legislative_district', 'has-column', 'column:dim_legislative_district.district_code', 'r1', 'join key'),
  ('table:dim_legislative_district', 'has-column', 'column:dim_legislative_district.parent_geo_code', 'r1', 'join key'),
  ('table:dim_legislative_district', 'has-column', 'column:dim_legislative_district.region_code', 'r1', 'join key'),
  ('table:dim_legislative_district', 'reconciled-in', 'doc:docs/DECISIONS.md', 'r90', null),
  ('table:dim_legislative_district', 'reconciled-in', 'doc:docs/LEGISLATIVE_DISTRICTS.md', 'r1', null),
  ('table:dim_legislative_district', 'reconciled-in', 'doc:docs/LEGISLATIVE_DISTRICTS_PLAN.md', 'r90', null),
  ('table:district_correction', 'built-by', 'migration:20260902030000_legislative_districts.sql', 'r90', 'create table'),
  ('table:district_correction', 'built-by', 'script:ingestion/verify_rls.py', 'r27', 'writes'),
  ('table:district_correction', 'reconciled-in', 'doc:docs/DECISIONS.md', 'r90', null),
  ('table:district_correction', 'reconciled-in', 'doc:docs/LEGISLATIVE_DISTRICTS_PLAN.md', 'r90', null),
  ('table:district_representative', 'built-by', 'migration:20260902030000_legislative_districts.sql', 'r90', 'create table'),
  ('table:district_representative', 'built-by', 'script:ingestion/build_legislative_districts.py', 'r16', 'declared'),
  ('table:district_representative', 'derived-from', 'dataset:ph-legislative-districts', 'r1', 'registered source dataset'),
  ('table:district_representative', 'has-column', 'column:district_representative.district_code', 'r1', 'join key'),
  ('table:district_representative', 'reconciled-in', 'doc:docs/DECISIONS.md', 'r90', null),
  ('table:district_representative', 'reconciled-in', 'doc:docs/LEGISLATIVE_DISTRICTS.md', 'r1', null),
  ('table:district_representative', 'reconciled-in', 'doc:docs/LEGISLATIVE_DISTRICTS_PLAN.md', 'r90', null),
  ('table:geo_district_map', 'built-by', 'migration:20260902030000_legislative_districts.sql', 'r90', 'create table'),
  ('table:geo_district_map', 'built-by', 'migration:20260902050000_district_corroboration.sql', 'r91', 'alter table'),
  ('table:geo_district_map', 'built-by', 'migration:20260902070000_district_independent_city.sql', 'r92', 'alter table'),
  ('table:geo_district_map', 'built-by', 'migration:20260902090000_district_whole_citymun.sql', 'r93', 'alter table'),
  ('table:geo_district_map', 'built-by', 'migration:20260902110000_district_article_identity.sql', 'r94', 'alter table'),
  ('table:geo_district_map', 'built-by', 'script:ingestion/build_legislative_districts.py', 'r16', 'declared'),
  ('table:geo_district_map', 'derived-from', 'dataset:ph-legislative-districts', 'r1', 'registered source dataset'),
  ('table:geo_district_map', 'has-column', 'column:geo_district_map.district_code', 'r1', 'join key'),
  ('table:geo_district_map', 'has-column', 'column:geo_district_map.geo_code', 'r1', 'join key'),
  ('table:geo_district_map', 'reconciled-in', 'doc:docs/DECISIONS.md', 'r90', null),
  ('table:geo_district_map', 'reconciled-in', 'doc:docs/LEGISLATIVE_DISTRICTS.md', 'r1', null),
  ('table:geo_district_map', 'reconciled-in', 'doc:docs/LEGISLATIVE_DISTRICTS_PLAN.md', 'r90', null)
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
