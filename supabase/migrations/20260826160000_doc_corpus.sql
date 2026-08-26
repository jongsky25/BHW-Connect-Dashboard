-- Internal AI assistant, Increment 2.1 (docs/AI_ASSISTANT_PLAN.md §8): the document corpus.
--
-- Phase 1 gave the assistant SQL over registered tables and a traversal over asserted edges.
-- This adds the third retrieval path from §2: prose. Numbers still come from SQL; documents
-- supply the claims that have no figure to audit, which is exactly why §7 makes the citation —
-- not the audit — the correctness check for a prose claim.
--
-- Four tables:
--   doc_source           — one row per ingested document
--   doc_chunk            — one row per slide (§12.3), with the offsets that make a citation checkable
--   doc_embedding_model  — one row per embedding model, carrying ITS dimension
--   doc_chunk_embedding  — one row per (chunk, model)
--
-- Three decisions are load-bearing enough to state here rather than only in DECISIONS.md.
--
-- 1. THE EMBEDDING DIMENSION IS A ROW, NOT A TYPE MODIFIER.
--    `doc_chunk_embedding.embedding` is an unconstrained `vector`; the dimension lives in
--    `doc_embedding_model.dim`, written by the ingest pipeline from what the provider's live model
--    actually returned. A composite FK on (model, dim) forces every row of a model to share one
--    dimension, and a check constraint asserts vector_dims(embedding) = dim, so a provider that
--    quietly changes output width fails the insert instead of poisoning the index.
--
--    This is §1's "the model name is configuration, not code" applied to the thing that usually
--    escapes it. A `vector(768)` column hard-codes a provider's current output width into the
--    schema, and §11 asks for the dimension to be confirmed against the live model at
--    implementation time — which cannot be done in a migration written beforehand. Same reasoning
--    as the quota rows in lib/ai/quota.ts: store limits as rows, never as code constants.
--
--    Cost: pgvector cannot build an HNSW/IVFFlat index on an unconstrained column. That is
--    deliberate and, at this corpus size, free — an exact scan over one document's chunks is
--    sub-millisecond, and an approximate index would trade recall for nothing. The ANN index is a
--    later migration, written once a measured dimension exists to pin the column to.
--
-- 2. OFFSETS ARE ASSERTED BY CONSTRUCTION, NOT BY TRUST.
--    Increment 2.3 requires the stored page/offset be asserted rather than assumed, because a
--    citation pointing at the wrong page reads as verified and is therefore worse than none (§7).
--    char_start/char_end are offsets into the document's canonical extracted text, and
--    `doc_chunk_offsets_match` requires char_end - char_start = length(content). A re-extraction
--    that disagrees cannot be loaded silently; it fails.
--
-- 3. INTERNAL BY DEFAULT (§12.5).
--    The first corpus is internal budget material whose own slide 26 records the BHW Connect site
--    under system hold. `exposure` defaults to 'internal' and RLS is enabled in the same statement
--    block as each CREATE TABLE with no anon/authenticated policy (the DECISIONS.md 0.3
--    guardrail), so these tables are service-role only and reachable solely through the
--    admin-gated assistant. Clearance to load this corpus was never clearance to expose it.

create table doc_source (
  doc_id bigint generated always as identity primary key,
  -- Stable, human-readable identity, and the kb_node key a `document:` node uses.
  key text not null unique,
  title text not null,
  -- Repo-relative path of the file this was extracted from. The corpus is reproducible: the file
  -- is committed, the pipeline is committed, so the chunks below are not seeded from a migration.
  source_path text not null,
  -- sha256 of the source bytes. Re-ingesting a changed file is a new extraction, not an update.
  source_sha256 text not null,
  media_type text not null default 'application/pdf',
  page_count integer not null check (page_count > 0),
  char_count integer not null check (char_count >= 0),
  issuer text,
  -- The date the document speaks as of, where it states one. §12.4 rule 2: a number carried by a
  -- chunk renders attributed AND dated, never as a bare fact — this is where the date comes from.
  as_of date,
  -- What produced the text, exactly. Extraction is not neutral: §12.3 documents a slide-number
  -- element that some extractors interleave into the text. An answer traced to a chunk is only
  -- checkable if the extractor that produced it is on the record.
  extractor text not null,
  exposure text not null default 'internal' check (exposure in ('public', 'internal')),
  status text not null default 'auto' check (status in ('auto', 'approved', 'rejected')),
  notes_md text,
  ingested_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table doc_source enable row level security;
-- service-role only: no anon/authenticated policies.

create table doc_chunk (
  chunk_id bigint generated always as identity primary key,
  doc_id bigint not null references doc_source (doc_id) on delete cascade,
  -- 0-based ordinal within the document, in reading order.
  chunk_index integer not null check (chunk_index >= 0),
  -- 1-based page range. One slide, one chunk (§12.3), so these are equal today; the range exists
  -- because §12.3 also says merged consecutive slides must cite the range rather than flatten it.
  page_from integer not null check (page_from >= 1),
  page_to integer not null check (page_to >= 1),
  -- Offsets into the document's canonical extracted text. These are what make a quoted span
  -- resolvable back to a position in the source rather than merely plausible.
  char_start integer not null check (char_start >= 0),
  char_end integer not null,
  content text not null,
  content_sha256 text not null,
  -- First meaningful line of the slide, kept for citation display ("slide 37 — SUMMARY").
  heading text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (doc_id, chunk_index),
  constraint doc_chunk_page_order check (page_to >= page_from),
  -- The teeth behind decision 2 above: the offsets and the text cannot disagree.
  constraint doc_chunk_offsets_match check (char_end - char_start = length(content))
);

create index doc_chunk_doc_idx on doc_chunk (doc_id, chunk_index);
create index doc_chunk_page_idx on doc_chunk (doc_id, page_from);
-- pg_trgm over the text, for the half of retrieval that vectors are bad at: exact codes, memo
-- numbers, circular references ("DC No. 2025-0549", "JMC 2023-001"). Already installed; the
-- extension is in `extensions`, so the operator class is schema-qualified.
create index doc_chunk_content_trgm_idx on doc_chunk using gin (content extensions.gin_trgm_ops);

alter table doc_chunk enable row level security;
-- service-role only: no anon/authenticated policies.

create table doc_embedding_model (
  -- The provider's model id, exactly as the environment names it. Never a code constant (§1).
  model text not null primary key,
  provider text not null,
  -- Written from the length of a vector the live model actually returned, never copied from
  -- documentation or from the plan. See decision 1 in this file's header.
  dim integer not null check (dim between 1 and 16000),
  -- 'cosine' | 'l2' | 'ip' — which operator a search against this model must use.
  distance text not null default 'cosine' check (distance in ('cosine', 'l2', 'ip')),
  notes_md text,
  created_at timestamptz not null default now(),
  -- Composite target for doc_chunk_embedding's FK: forces one dimension per model, so a search
  -- filtered to a model can never meet a row of a different width mid-scan.
  unique (model, dim)
);

alter table doc_embedding_model enable row level security;
-- service-role only: no anon/authenticated policies.

create table doc_chunk_embedding (
  chunk_id bigint not null references doc_chunk (chunk_id) on delete cascade,
  model text not null,
  dim integer not null,
  embedding extensions.vector not null,
  embedded_at timestamptz not null default now(),
  -- A chunk may hold one embedding per model: re-embedding onto a new model is an insert
  -- alongside, not a destructive rewrite, so a model swap can be verified before the old rows go.
  primary key (chunk_id, model),
  foreign key (model, dim) references doc_embedding_model (model, dim) on update cascade,
  constraint doc_chunk_embedding_dim_matches check (extensions.vector_dims(embedding) = dim)
);

create index doc_chunk_embedding_model_idx on doc_chunk_embedding (model);

alter table doc_chunk_embedding enable row level security;
-- service-role only: no anon/authenticated policies.

-- Increment 1.5 debt, paid here. kb_node.source_chunk_id and kb_edge.source_chunk_id have carried
-- a check constraint tying them to source_kind = 'chunk' since 20260826120000_kb_graph.sql, but
-- no foreign key — doc_chunk did not exist yet, so there was nothing to point at. §1 requires
-- every extracted fact to carry a pointer to the chunk that asserted it; until now that pointer
-- could name a chunk that never existed. Phase 3 is the increment that starts writing these, so
-- the FK lands before the first row depends on it, not after.
--
-- ON DELETE RESTRICT, not CASCADE: deleting a chunk that a graph row cites should fail loudly.
-- Cascading would silently delete the assertion along with its evidence, which is the same class
-- of error as an uncited edge. §11's retention question (what happens to chunks for a withdrawn
-- document) is now forced to be answered deliberately rather than by a default.
alter table kb_node
  add constraint kb_node_source_chunk_fk
  foreign key (source_chunk_id) references doc_chunk (chunk_id) on delete restrict;

alter table kb_edge
  add constraint kb_edge_source_chunk_fk
  foreign key (source_chunk_id) references doc_chunk (chunk_id) on delete restrict;
