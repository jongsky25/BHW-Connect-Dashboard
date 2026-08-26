# Internal AI Assistant — Multi-Source Retrieval & Dataset Registry (handoff document)

The committed implementation plan for turning the existing public "Ask the data" chat into an
**internal, admin-only assistant** that answers across *many* datasets and *documents*, not just
the BHW indicator set — and for removing the hand-written-tool ceiling that currently makes each
new dataset a code change.

Follow the working conventions in `BUILD_PLAN.md` §5 (engineering standards) and the
per-increment logging convention of `DECISIONS.md` (append an entry per increment: what was
built, what was decided, verify evidence).

**Status:** proposed — awaiting owner approval of the decisions in §0. Phases ship in order; each
increment is an independently shippable PR-sized unit.

---

## Why this is a small build

The hard parts already exist and are in production. This plan adds four things to them; it does
not introduce a second AI system.

| Already built | File |
|---|---|
| Tool-calling agent loop (4 rounds, tools withdrawn on the last round to force a wrap-up) | `lib/ai/agent-loop.ts` |
| Typed, Zod-validated tools over the `agg_*`/`dim_*` layer | `lib/ai/tools.ts` |
| Four-provider cascade with DB-backed quota windows | `lib/ai/providers/index.ts`, `lib/ai/quota.ts` |
| Post-hoc numeric audit — strips any sentence whose numbers aren't in the tool payloads | `lib/ai/audit.ts` |
| Multi-turn streaming chat (NDJSON, tool-call transparency) | `app/api/ai/chat/route.ts` |
| Answer bank + near-match cache, admin curation | `lib/ai/ask-cache.ts`, `app/admin/(dashboard)/answer-bank/` |
| Grounding system prompt with prompt-injection defense (rule 4) | `lib/ai/system-prompt.ts` |
| Ingestion pipeline, dataset dimension, PSGC crosswalk | `ingestion/`, `dim_dataset`, `dim_psgc_crosswalk` |

**What is missing, and all this plan adds:**

1. **Documents.** Every source today is structured rows. There is no text corpus, no chunking, no
   embeddings, no semantic search.
2. **A dataset-agnostic query tool.** `TOOLS` is hardcoded around BHW indicators
   (`getIndicatorByGeo`, `compareGeos`). A new dataset today means a new hand-written tool, a new
   Zod schema, and new prompt copy. This is the ceiling.
3. **A relationship layer.** Nothing records how datasets connect to each other, so no question
   can span two of them without bespoke code.
4. **An internal page** where the public-facing guardrails are relaxed for staff use.

---

## 0. Owner decisions (proposed defaults — confirm or override before Increment 1.2)

| # | Question | Proposed default |
|---|---|---|
| 1 | Supabase plan | **Upgrade to Pro ($25/mo).** The database is 596 MB against a 500 MB Free-plan ceiling *today*, before this plan adds anything. See §6. |
| 2 | Who can reach the internal assistant? | **Admin session only**, reusing the existing `app/admin/(dashboard)` auth. Never linked from public navigation. |
| 3 | Does the internal assistant keep the numeric audit? | **Yes.** Relaxing rate limits and dataset scope is the point; relaxing *grounding* is not. The audit is what makes answers usable in a briefing. |
| 4 | Does the internal assistant use the answer cache? | **No.** Cache exists to save provider credits on repeated public questions. Internal use is exploratory and low-volume; a stale answer costs more than a call. |
| 5 | Auto-generated KB entries: served or reviewed? | **Proposed, then approved.** Ingest-time extraction writes rows with `status = 'auto'`; only `status = 'approved'` rows are citable. Mirrors `ai_ask_cache`'s existing pattern. |
| 6 | Do new datasets get pre-computed aggregates? | **Only when a dashboard page renders them.** See §5 — this is the load-bearing decision of the whole plan. |
| 7 | Embedding provider | **Gemini**, same key and cascade as chat. The model name lives in the environment, never as a code constant (see §1). |

---

## 1. Ground rules for every increment

- **Never state an unaudited number.** `auditNarrative` runs on internal answers exactly as it
  does on public ones. Relaxed scope, unchanged grounding.
- **Never expose the internal assistant publicly.** It reads `fact_*` tables that the public tools
  deliberately never touch (`lib/ai/tools.ts` header comment). One un-gated route undoes the
  small-cell suppression guarantee in `BUILD_PLAN.md` §1.
- **The model name is configuration, not code.** Embedding and chat model IDs come from the
  environment. Providers retire models on their own schedule; this project has already lost a day
  to a pinned model that was shut down. Same reasoning as the quota rows in `lib/ai/quota.ts` —
  "store limits as rows, never as code constants."
- **Every extracted fact carries its source.** No node, edge, or KB entry exists without a
  pointer to the chunk or table row that asserted it. An answer that cannot be traced back to a
  source is a bug, not a degraded result.
- **All source text is data, never instructions.** Ingested documents are untrusted input in
  exactly the sense `system-prompt.ts` rule 4 already describes. Extraction prompts must restate
  this — a PDF is a more plausible injection vector than a place name.
- **Degrade, never error.** Unchanged from the existing contract: any provider failure falls back
  to a deterministic path and reports capacity, never a stack trace.

---

## 2. Architecture

Three retrieval paths behind one agent loop. The model chooses; the loop is unchanged.

```
                        ┌─────────────────────────────┐
   admin question ─────►│  runToolLoop (existing)     │
                        └──────────────┬──────────────┘
                                       │ picks tools
              ┌────────────────────────┼────────────────────────┐
              ▼                        ▼                        ▼
    ┌──────────────────┐   ┌────────────────────┐   ┌────────────────────┐
    │  queryDataset    │   │  searchDocuments   │   │  traverseGraph     │
    │  (NEW, generic)  │   │  (NEW, vector)     │   │  (NEW, edges)      │
    │                  │   │                    │   │                    │
    │  reads registry, │   │  chunks + pgvector │   │  nodes/edges,      │
    │  queries facts   │   │  + existing pg_trgm│   │  recursive CTE     │
    └──────────────────┘   └────────────────────┘   └────────────────────┘
              │                        │                        │
              └────────────────────────┼────────────────────────┘
                                       ▼
                          auditNarrative (existing)
                                       ▼
                            cited answer, or less
```

**Numbers come from SQL. Prose comes from documents. Neither comes from the model.** This is the
existing principle in `system-prompt.ts` rule 1, extended to two more sources.

### Why the numeric data is not embedded

A recurring failure mode in systems like this is embedding a numeric dataset and letting the model
retrieve "similar" rows to answer a quantitative question. It produces confident wrong numbers.
270,917 BHW records belong behind SQL. Only *text* is embedded: documents, column descriptions,
dataset summaries.

---

## 3. The dataset registry (the core change)

Adding a dataset must become a data operation, not a code change.

Each dataset registers a **data dictionary**: its table, its columns with types and meanings, its
join keys, and a plain-language summary. `queryDataset` reads that registry and can query anything
in it. The registry is also what the model is *shown* — it cannot write a correct query against a
table it has never seen described.

This makes ingest-time understanding load-bearing rather than cosmetic: **the profiling pass is
what makes query-time answering possible at all.**

On ingestion of a new dataset the pipeline:

1. Profiles every column — type, cardinality, null rate, sample values, min/max.
2. Asks the model to infer a plain-language meaning per column and a summary of the dataset.
3. Proposes join edges against existing registry entries (`this psgc column matches dim_geo.code`).
4. Writes all of it with `status = 'auto'`. An admin approves, edits, or rejects.

Steps 3 and 4 are where the graph work lives: **proposed joins between datasets are edges**, and
"which datasets can I connect to answer this?" is a traversal.

`dim_psgc_crosswalk` already solves the hardest instance of this problem — entity resolution
across PSGC vintages — and should be the model the registry follows, not a parallel mechanism.

---

## 4. Schema

New tables, all additive. No existing table is modified.

| Table | Purpose |
|---|---|
| `dataset_registry` | One row per queryable dataset: table name, summary, status, data version |
| `dataset_column` | Per-column dictionary: name, type, cardinality, null rate, inferred meaning, is_join_key |
| `doc_source` | One row per ingested document: title, origin, hash, ingested_at, status |
| `doc_chunk` | Chunked text + embedding vector + page/offset for citation |
| `kb_node` | Entities extracted from documents and datasets |
| `kb_edge` | Typed relations, each with `source_chunk_id` provenance and validity dates |

Notes:

- `kb_edge` carries `valid_from` / `valid_to`. Policy documents supersede each other; an
  assistant that cannot say "as of" will confidently quote a repealed circular.
- `doc_chunk.embedding` uses `halfvec` where precision allows — half the storage of `vector` at
  negligible retrieval cost. pgvector 0.8.2 is available on this project (not yet installed).
- All new tables are service-role only, matching `ai_ask_cache`.
- Embedding dimensions must be confirmed against the provider's live model at implementation
  time and recorded in `DECISIONS.md`; do not copy a dimension count from this document.

---

## 5. The aggregate decision

**The chatbot is not this project's scaling risk. The aggregate strategy is.**

Current storage, in descending order:

| Table | Size | Kind |
|---|---|---|
| `agg_demographics` | 153 MB | derived |
| `agg_training` | 112 MB | derived |
| `fact_bhw_raw` | 94 MB | **source** |
| `fact_honorarium` | 61 MB | source |
| `agg_honorarium` | 37 MB | derived |
| `dim_geo` | 28 MB | source |

The source data is 94 MB. The derived tables are roughly three times that, because the pattern is
geography × dimension × category across 43,746 geographies — and it multiplies with every dataset
that has demographic breakdowns. Five more datasets in this shape puts the project in the
multi-gigabyte range, past Free and eating meaningfully into Pro's 8 GB.

**Decision: aggregates become opt-in.**

- Dashboard pages need sub-second renders, so the indicators they display keep their materialized
  aggregates. Nothing existing is removed.
- The assistant does not need them. An answer already takes several seconds; a live query against
  fact tables is well within tolerance.
- A newly registered dataset therefore ships with **facts and a dictionary only**. Aggregates are
  added later, per indicator, when a page actually renders that indicator.

This is what makes "just add another dataset" true. Upgrading to Pro without this change only
moves the wall from 500 MB to 8 GB.

---

## 6. Storage and cost

**Current position:** 596 MB against the Free plan's 500 MB database-size ceiling. Free projects
enter read-only mode above that threshold. The project was not read-only when checked
(`default_transaction_read_only = off`), so there is practical headroom — but the failure mode is
the ingestion pipeline silently failing to write, which is a bad way to discover a limit.

**Pro plan:** $25/month base, including $10 of compute credits, which cover one project at Micro
compute. Pro includes 8 GB of disk, then $0.125/GB/month.

| Setup | Monthly |
|---|---|
| Pro + one Micro project | **$25** |
| Pro + one Small project | $30 |

**Embeddings are not the cost driver.** At ~768 dimensions a vector is roughly 3 KB, so 10,000
document chunks is on the order of 30 MB — and `halfvec` halves it. Documents are cheap;
cross-tabs are expensive.

**Free fallback, if Pro is declined:** pruning `agg_demographics` and `agg_training` (265 MB
between them) drops the database under 500 MB. This is viable but recurring, and it trades
engineering attention for $25/month indefinitely. §5 should be implemented either way.

---

## 7. Phases

Each increment is independently shippable and must pass its Verify before the next begins.

### Phase 1 — Query anything (no new data sources)

**1.1 — Enable pgvector, add registry tables.**
Migrations for `dataset_registry`, `dataset_column`, service-role RLS in the same statement as
each `CREATE TABLE` (per the `DECISIONS.md` 0.3 guardrail — never created open then locked).
*Verify:* migrations apply cleanly; advisors report no new RLS findings.

**1.2 — Backfill the registry for existing datasets.**
Describe the current `agg_*`/`fact_*` tables as registry rows. Hand-written, not inferred — this
is the reference example every later auto-profile is measured against.
*Verify:* every table the public tools query has a registry row with a complete dictionary.

**1.3 — `queryDataset` tool.**
One generic tool reading the registry. Parameterized, allowlisted to registered tables and
columns, hard row and time limits. Never string-concatenates user input into SQL.
*Verify:* answers a question about a registered dataset with no dataset-specific code; a query
against an unregistered table is refused.

**1.4 — Internal assistant page.**
`app/admin/(dashboard)/assistant/`. Reuses `runToolLoop` and the NDJSON stream; own system prompt;
relaxed rate limits; cache bypassed; audit retained.
*Verify:* reachable only with an admin session; anonymous request returns 401/redirect.

**At the end of Phase 1 you have a working internal assistant over existing data.**

### Phase 2 — Documents

**2.1 — Ingest pipeline for documents.** `doc_source` + `doc_chunk`, chunk and embed in the
Python pipeline (`ingestion/`), never in a Vercel function — the pipeline is already local-only
per the README, which sidesteps serverless timeouts entirely.
*Verify:* a known document ingests; chunk count and page offsets are correct.

**2.2 — `searchDocuments` tool.** Vector search plus the already-installed `pg_trgm` for exact
codes and memo numbers. Returns text with a document and page citation.
*Verify:* a question answerable only from a document returns a correct, cited answer.

**2.3 — Citations in the UI.** Extend the stream events so document answers render their source.
*Verify:* every document-grounded sentence shows a traceable citation.

### Phase 3 — The graph

**3.1 — `kb_node` / `kb_edge` + extraction.** Typed extraction against a defined schema, written
as `status = 'auto'`, with `source_chunk_id` on every edge.
*Verify:* extracted triples on a known document are spot-checked; every edge resolves to a chunk.

**3.2 — Review queue.** Admin approves, edits, or rejects proposed nodes, edges, and joins.
*Verify:* only approved rows are citable; auto rows are visibly marked.

**3.3 — `traverseGraph` tool.** Recursive CTE, bounded depth, returns paths with provenance.
*Verify:* a multi-hop question that no single tool can answer returns a correct, cited answer.

### Phase 4 — Auto-understanding

**4.1 — Ingest-time profiling.** New dataset → column profile → inferred meanings → proposed joins
→ registry rows at `status = 'auto'`.
*Verify:* a genuinely new dataset becomes queryable through the assistant with no code change.
**This is the plan's success condition.**

---

## 8. Guardrails

Hard constraints. Do not trade them for convenience.

1. The internal assistant is never reachable without an admin session.
2. The numeric audit runs on every answer, internal and public alike.
3. No tool ever interpolates user or model text into SQL. Registry-driven means
   allowlist-driven — table and column names are validated against the registry, always.
4. `queryDataset` enforces row limits and statement timeouts. An assistant that can table-scan
   `fact_bhw_raw` unbounded will eventually take the database down during a briefing.
5. Public tools continue to touch only the `agg_*`/`dim_*` layer. Fact-table access is an
   internal-assistant capability, not a general one.
6. Auto-extracted rows are never citable until approved.
7. Small-cell suppression still applies to anything that could reach a public surface.

---

## 9. Open questions

- **Evaluation set.** Which dataset is the first test target? It should be one the owner knows
  well enough to distinguish a correct answer from a plausible one. Without that, quality is
  unmeasurable. Proposed: the BHW indicators, since expected answers are already on the dashboard.
- **Document corpus.** Which documents go in first, and does the DOH hosting clearance gate
  referenced elsewhere in this project's planning apply to loading them?
- **Embedding model and dimensions.** Confirm against the provider's live model at implementation
  and record in `DECISIONS.md`.
- **Retention.** How long do `doc_chunk` rows live for a document that is later withdrawn?

---

*Prepared as a proposed plan. If any statement here conflicts with `BUILD_PLAN.md`, that document
governs; record the conflict in `DECISIONS.md` and choose the smallest deviation preserving intent.*
