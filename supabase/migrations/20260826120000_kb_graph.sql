-- Internal AI assistant, Increment 1.5 (docs/AI_ASSISTANT_PLAN.md §8): the knowledge graph.
--
-- Created here and populated in the same increment from structure this repository already
-- asserts — migrations, ingestion scripts, the dataset registry, the docs/ write-ups — with no
-- extraction and no model in the loop. Phase 3 then adds *extracted* rows to a schema that is
-- already live and exercised: creating a graph schema and pointing an extractor at it in one
-- increment makes a schema bug and an extraction bug indistinguishable.
--
-- Two columns carry the load the plan's ground rules put on this table:
--
--   origin — 'asserted' (derived from a committed file, checkable by opening it) vs 'extracted'
--            (proposed by a model). §9.9: the two must be distinguishable by column, never by
--            convention, or an extracted guess silently reads as an asserted fact. The default is
--            'extracted', so a row that does not claim to be asserted is not treated as one.
--
--   (source_kind, source_ref) — the provenance pointer §1 requires on every edge, widened past
--            "chunk": a lineage edge is asserted by a migration or an ingestion script, not by a
--            document chunk, so provenance is a discriminated pair with the chunk case one of its
--            values. source_ref is NOT NULL: an edge with no pointer cannot exist.
--
-- Geographies are deliberately NOT materialized as nodes. dim_geo already is a containment tree
-- over 43,746 rows with its own index; copying it here would create a second copy to keep in sync
-- for no gain. The traversal in 1.6 reads dim_geo directly as its own edge source.
--
-- RLS in the same statement block as each CREATE TABLE, service-role only, per 1.1.
create table kb_node (
  node_id bigint generated always as identity primary key,
  -- Stable, human-readable identity: 'table:agg_bhw_counts', 'migration:2026….sql',
  -- 'doc:<a docs/ write-up>'. Unique, so a re-run of the seed updates rather than duplicates.
  -- (Deliberately not a real doc path: the lineage generator reads paths out of migration text,
  -- so an illustrative example here would assert an edge that nothing actually built.)
  key text not null unique,
  kind text not null check (
    kind in ('dataset', 'table', 'column', 'migration', 'ingestion_script', 'document',
             'geography', 'issuance', 'entity')
  ),
  label text not null,
  summary text,
  origin text not null default 'extracted' check (origin in ('asserted', 'extracted')),
  source_kind text not null check (
    source_kind in ('migration', 'ingestion_script', 'registry', 'document', 'chunk')
  ),
  source_ref text not null,
  source_chunk_id bigint,
  status text not null default 'auto' check (status in ('auto', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A chunk-sourced row must name its chunk; anything else must not claim to have one.
  constraint kb_node_chunk_provenance check (
    (source_kind = 'chunk') = (source_chunk_id is not null)
  )
);

create index kb_node_kind_idx on kb_node (kind, status);

alter table kb_node enable row level security;
-- service-role only: no anon/authenticated policies.

create table kb_edge (
  edge_id bigint generated always as identity primary key,
  src_node_id bigint not null references kb_node (node_id) on delete cascade,
  dst_node_id bigint not null references kb_node (node_id) on delete cascade,
  relation text not null check (
    relation in ('derived-from', 'built-by', 'reconciled-in', 'joins-on', 'has-column')
  ),
  -- Validity on both endpoints, unused by lineage but present from the start: policy documents
  -- supersede each other, and an assistant that cannot say "as of" will quote a repealed circular.
  valid_from date,
  valid_to date,
  origin text not null default 'extracted' check (origin in ('asserted', 'extracted')),
  source_kind text not null check (
    source_kind in ('migration', 'ingestion_script', 'registry', 'document', 'chunk')
  ),
  source_ref text not null,
  source_chunk_id bigint,
  note text,
  status text not null default 'auto' check (status in ('auto', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (src_node_id, relation, dst_node_id),
  constraint kb_edge_no_self_loop check (src_node_id <> dst_node_id),
  constraint kb_edge_validity_order check (valid_to is null or valid_from is null or valid_to >= valid_from),
  constraint kb_edge_chunk_provenance check (
    (source_kind = 'chunk') = (source_chunk_id is not null)
  )
);

create index kb_edge_src_idx on kb_edge (src_node_id, relation) where status = 'approved';
create index kb_edge_dst_idx on kb_edge (dst_node_id, relation) where status = 'approved';

alter table kb_edge enable row level security;
-- service-role only: no anon/authenticated policies.
