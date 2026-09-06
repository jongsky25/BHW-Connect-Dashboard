-- Lineage delta for the FHSIS 2025 load (docs/FHSIS_2025_PLAN.md, increment F1).
--
-- The canonical graph is supabase/migrations/20260826120100_seed_kb_lineage.sql, which
-- `python ingestion/build_kb_lineage.py` regenerates whole from the committed files. This file
-- carries only the rows that regeneration adds, to the live project — the same pattern as the
-- U8, U9, U10, U11, U12b, D1.6, district_correction and NHFR lineage deltas.
--
-- **Why this is in F1 and not in F4, unlike NHFR's.** NHFR shipped its tables in N1/N2 with no
-- lineage at all and paid it back in N5; that gap is exactly the U5 debt the F1 plan names when
-- it says to regenerate the lineage in this increment rather than the registry one. So the four
-- relations get their `built-by` edges the moment they exist. What is *not* here is anything the
-- registry produces — `dataset_registry` / `dataset_column` rows, the `has-column` and `joins-on`
-- edges they generate, and the `table -> dataset:fhsis-2025` `derived-from` edges that come with
-- them. Those are F4's, and adding them now would mean describing columns no registry row yet
-- explains.
--
-- 9 nodes and 14 edges. `dataset:fhsis-2025` is created here even though no edge in this file
-- points at it: full regeneration produces the node from the dim_dataset seed migration, and
-- creating it now is what lets F4's registry delta attach its `derived-from` edges without having
-- to create the node itself.
--
-- After this, `python ingestion/build_kb_lineage.py` prints nothing to stderr: no table without a
-- `built-by` edge, and no edge naming an endpoint the generator does not define.
with refs (ref, source_ref, source_kind) as (values
  ('f1', 'supabase/migrations/20260906100000_ref_fhsis_indicator.sql', 'migration'),
  ('f2', 'supabase/migrations/20260906100100_fact_fhsis_indicator.sql', 'migration'),
  ('f3', 'supabase/migrations/20260906100200_fact_fhsis_workforce.sql', 'migration'),
  ('f4', 'supabase/migrations/20260906100300_seed_dim_dataset_fhsis.sql', 'migration'),
  ('f5', 'supabase/migrations/20260906100400_ref_fhsis_reconciliation.sql', 'migration'),
  ('f6', 'ingestion/ingest_fhsis.py', 'ingestion_script')
),
node_input (key, ref) as (values
  ('dataset:fhsis-2025', 'f4'),
  -- The two new documents. FHSIS_2025_CLEANING_REPORT.md is the `derived-from` endpoint every
  -- one of these tables declares, so without this node those edges would join to nothing and
  -- vanish silently — the same failure mode the NHFR delta had to create doc:docs/BUILD_PLAN.md
  -- to avoid.
  ('doc:docs/FHSIS_2025_CLEANING_REPORT.md', 'f1'),
  ('doc:docs/FHSIS_2025_PLAN.md', 'f1'),
  ('script:ingestion/ingest_fhsis.py', 'f2'),
  ('migration:20260906100000_ref_fhsis_indicator.sql', 'f1'),
  ('migration:20260906100100_fact_fhsis_indicator.sql', 'f2'),
  ('migration:20260906100200_fact_fhsis_workforce.sql', 'f3'),
  ('migration:20260906100300_seed_dim_dataset_fhsis.sql', 'f4'),
  ('migration:20260906100400_ref_fhsis_reconciliation.sql', 'f5'),
  ('table:fact_fhsis_indicator', 'f2'),
  ('table:fact_fhsis_workforce', 'f3'),
  ('table:ref_fhsis_indicator', 'f1'),
  -- A view, keyed `table:` like ref_uuc_phc_provincial: it is queried like any other relation,
  -- and a graph that only knew `create table` would report it as a relation nobody built.
  ('table:ref_fhsis_reconciliation', 'f5')
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
  ('f1', 'supabase/migrations/20260906100000_ref_fhsis_indicator.sql', 'migration'),
  ('f2', 'supabase/migrations/20260906100100_fact_fhsis_indicator.sql', 'migration'),
  ('f3', 'supabase/migrations/20260906100200_fact_fhsis_workforce.sql', 'migration'),
  ('f5', 'supabase/migrations/20260906100400_ref_fhsis_reconciliation.sql', 'migration'),
  ('f6', 'ingestion/ingest_fhsis.py', 'ingestion_script')
),
edge_input (src_key, relation, dst_key, ref, note) as (values
  -- built-by: the migration that creates each relation, and the script that fills the two fact
  -- tables. ref_fhsis_indicator has no script edge because its rows are seeded in its own
  -- migration, not loaded.
  ('table:ref_fhsis_indicator', 'built-by', 'migration:20260906100000_ref_fhsis_indicator.sql', 'f1', 'create table'),
  ('table:fact_fhsis_indicator', 'built-by', 'migration:20260906100100_fact_fhsis_indicator.sql', 'f2', 'create table'),
  ('table:fact_fhsis_indicator', 'built-by', 'script:ingestion/ingest_fhsis.py', 'f2', 'declared'),
  ('table:fact_fhsis_workforce', 'built-by', 'migration:20260906100200_fact_fhsis_workforce.sql', 'f3', 'create table'),
  ('table:fact_fhsis_workforce', 'built-by', 'script:ingestion/ingest_fhsis.py', 'f3', 'declared'),
  ('table:ref_fhsis_reconciliation', 'built-by', 'migration:20260906100400_ref_fhsis_reconciliation.sql', 'f5', 'create view'),
  -- The loader writes its QA report row here, as every loader does.
  ('table:ingestion_batches', 'built-by', 'script:ingestion/ingest_fhsis.py', 'f6', 'writes'),

  -- derived-from: the cleaning report is where the numbers in these tables were decided — which
  -- workbook and sheet each came from, which rows were dropped, and how ~70 rows per sheet had
  -- their PSGC repaired. No `from` or `join` says so, which is what the `-- lineage:` directives
  -- in each migration are for.
  ('table:ref_fhsis_indicator', 'derived-from', 'doc:docs/FHSIS_2025_CLEANING_REPORT.md', 'f1', 'declared'),
  ('table:fact_fhsis_indicator', 'derived-from', 'doc:docs/FHSIS_2025_CLEANING_REPORT.md', 'f2', 'declared'),
  ('table:fact_fhsis_workforce', 'derived-from', 'doc:docs/FHSIS_2025_CLEANING_REPORT.md', 'f3', 'declared'),
  ('table:ref_fhsis_reconciliation', 'derived-from', 'doc:docs/FHSIS_2025_CLEANING_REPORT.md', 'f5', 'declared'),
  -- The view's own query: these two are read from the file rather than declared.
  ('table:ref_fhsis_reconciliation', 'derived-from', 'table:fact_fhsis_indicator', 'f5', 'view query'),
  ('table:ref_fhsis_reconciliation', 'derived-from', 'table:dim_geo', 'f5', 'view query')
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

-- reconciled-in: the documents each migration's own header names. Regeneration derives these
-- from the docs/*.md paths in the file headers, so they are listed here to match.
with refs (ref, source_ref, source_kind) as (values
  ('f1', 'supabase/migrations/20260906100000_ref_fhsis_indicator.sql', 'migration'),
  ('f2', 'supabase/migrations/20260906100100_fact_fhsis_indicator.sql', 'migration'),
  ('f3', 'supabase/migrations/20260906100200_fact_fhsis_workforce.sql', 'migration'),
  ('f5', 'supabase/migrations/20260906100400_ref_fhsis_reconciliation.sql', 'migration')
),
edge_input (src_key, relation, dst_key, ref, note) as (values
  ('table:ref_fhsis_indicator', 'reconciled-in', 'doc:docs/BUILD_PLAN.md', 'f1', null),
  ('table:ref_fhsis_indicator', 'reconciled-in', 'doc:docs/FHSIS_2025_CLEANING_REPORT.md', 'f1', null),
  ('table:ref_fhsis_indicator', 'reconciled-in', 'doc:docs/FHSIS_2025_PLAN.md', 'f1', null),
  ('table:fact_fhsis_indicator', 'reconciled-in', 'doc:docs/EXPLORE_ENHANCEMENT_PLAN.md', 'f2', null),
  ('table:fact_fhsis_indicator', 'reconciled-in', 'doc:docs/FHSIS_2025_CLEANING_REPORT.md', 'f2', null),
  ('table:fact_fhsis_indicator', 'reconciled-in', 'doc:docs/FHSIS_2025_PLAN.md', 'f2', null),
  ('table:fact_fhsis_indicator', 'reconciled-in', 'doc:docs/UUC_PHC_2025_PLAN.md', 'f2', null),
  ('table:fact_fhsis_workforce', 'reconciled-in', 'doc:docs/DECISIONS.md', 'f3', null),
  ('table:fact_fhsis_workforce', 'reconciled-in', 'doc:docs/FHSIS_2025_CLEANING_REPORT.md', 'f3', null),
  ('table:fact_fhsis_workforce', 'reconciled-in', 'doc:docs/FHSIS_2025_PLAN.md', 'f3', null),
  ('table:ref_fhsis_reconciliation', 'reconciled-in', 'doc:docs/FHSIS_2025_CLEANING_REPORT.md', 'f5', null)
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
