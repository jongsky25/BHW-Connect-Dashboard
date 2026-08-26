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
| 8 | Are answers human-reviewed before use? | **No queue.** Review happens at ingestion, which is one-time per source and compounds; reviewing every answer is unbounded and degrades to rubber-stamping. See §7 for the reasoning and the three layers that cover answers instead. |

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

## 7. Verification model — review at write-time, not read-time

**Decision: there is no queue of answers awaiting human approval.** Recorded here because it is
the obvious thing to propose later, and the reasons it is wrong are not obvious.

Reviewing every answer is unbounded work that grows with usage, and it is the same judgment call
every time. In practice it gets done for a fortnight and then rubber-stamped — which is worse than
no review, because a checkmark then implies someone looked. This project has already settled the
identical question once, in `ASK_CACHE_PLAN.md` §0 #3: *"Auto entries are served — they already
passed the numeric audit, which is the real safety gate. Admin curation is for promoting,
editing, and blocking, not a prerequisite for serving."*

**Ingestion review is the opposite trade.** It is one-time per source and compounds: a document's
extraction is checked once, and every future answer drawing on it inherits that check. Bounded
work, permanent return. That is why the review queue in this plan sits at Increment 3.2, on
extraction — not on answers.

Three layers cover answers instead, none of them a queue:

1. **The numeric audit** (`lib/ai/audit.ts`, already built). Strips any sentence whose numbers
   are absent from the tool payloads. Automatic, every answer, no human time.
2. **Citations.** Verification becomes something done *when it matters* — before a figure goes
   into a briefing — rather than in advance for every answer, including the many never used.
3. **Failure capture.** One click marks an answer wrong and files the question into the §10
   regression list. Effort is spent only on answers that were actually wrong, and that effort
   permanently guards against a repeat.

### The gap this leaves, and why Phase 2 closes it

The numeric audit only covers **numbers**. A prose claim drawn from a document — "a highly
technical request has a 20-working-day deadline" — carries no figure to check against a tool
payload and passes through unaudited.

**For documents, the citation is the check.** That makes citation *accuracy* a correctness
requirement rather than a presentation nicety: a citation pointing at the wrong page is worse
than none at all, because it reads as verified. Increments 2.3 and 2.4 exist to close this, and
neither is optional polish.

## 8. Phases

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

**2.3 — Citations in the UI.** Extend the stream events so document answers render their source —
document title, page, and the quoted span — each one clickable through to the stored chunk.

Per §7 this is a correctness feature, not presentation: for prose claims the citation is the only
check, since `auditNarrative` covers numbers alone. A citation that points at the wrong page is
worse than no citation, so the stored page/offset must be asserted, not assumed.

*Verify:* every document-grounded sentence shows a traceable citation; on a document with known
page numbers, ten sampled citations resolve to text that actually supports the sentence.

**2.4 — Failure capture.** A "this is wrong" control on any answer, writing the question, the
answer given, the tools called, and the provider into a regression table. Optional free-text note
for the correct answer.

This is what makes §10 self-sustaining: the regression list grows from real failures rather than
from an authoring session, so it tracks whatever sources have actually been loaded.

*Verify:* marking an answer wrong stores a replayable case — question plus tool calls — that can
be re-run against a later build.

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

## 9. Guardrails

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

## 10. Regression questions (not an up-front evaluation set)

Sources arrive incrementally and are not known in advance, so a fixed evaluation corpus chosen at
the start would be stale by Phase 2 and is not what this plan asks for. What is needed instead is
a **growing list of questions with known-correct answers**, used to tell whether a change — chunk
size, retrieval count, prompt wording, traversal depth — made answers better or worse. Without
one, every tuning change after Phase 2 is unverifiable: three answers read by hand say nothing
about the other forty.

It costs nothing up front and requires no advance knowledge of the corpus:

1. **Seed from the dashboard.** Roughly ten questions whose answers are already rendered on
   public pages ("accreditation rate in Region VII"). The expected answers are not authored —
   they are on screen.
2. **Grow from failures.** Every wrong answer found in normal use becomes a permanent case:
   the question, the correct answer, and the source that supports it. The list therefore tracks
   whatever data has actually been loaded, rather than anticipating it.
3. **Harvest what already exists.** `ai_ask_cache` rows at `status = 'approved'` are
   human-verified question/answer pairs — an unused regression set already accumulating in
   production.

**Not a prerequisite.** Phase 1 ships without it. It becomes load-bearing at Phase 3, when three
retrieval paths are live and a change to one can silently degrade another.

## 11. Open questions

- ~~**Document corpus.** Which documents go in first?~~ **Answered — see §12.** The 2027 Budget
  Cue Cards are the first corpus. The DOH hosting clearance question is *not* answered and is
  restated in §12.5.
- **Embedding model and dimensions.** Confirm against the provider's live model at implementation
  and record in `DECISIONS.md`.
- **Retention.** How long do `doc_chunk` rows live for a document that is later withdrawn?

---

## 12. First document corpus — the 2027 Budget Cue Cards

`ingestion/data/[BLHSD] 2027 Budget Cue Cards.pdf` is the base document this assistant should
answer from. It settles §11's first open question and gives Phase 2 a concrete target.

Loaded alongside it was the UUC-for-PHC 2025 workbook. That one is **not** part of this plan — it
is an ordinary dataset increment with its own card, planned in `docs/UUC_PHC_2025_PLAN.md`. The
two files are related: cue cards p37 publishes the regional distribution the workbook enumerates.

### 12.1 What it is

213 slides, 720×405, from the Bureau of Local Health Systems Development. Covers the 2027 NEP
budget proposal, and per p47–48 the whole BLHSD program set: Local Health Systems Integration,
HCPN, LIPH/AOP, Special Health Fund, LeadGov4Health, PuroKalusugan, Indigenous Peoples' Health,
UUC for PHC, Support for Barangay Health Workers, and the LGU Health Scorecard.

**Text-native — no OCR needed.** Only 2 of 213 pages fall below 20 extracted characters.
146,448 characters total, averaging 687 per slide; 85 pages carry tables (95 tables).

### 12.2 Why this is a good first corpus

It is bounded, current, authoritative, and it **overlaps the existing structured data enough to
exercise cross-source questions on day one** — which is what Phase 2 needs to be tested at all:

- **p37** — UUC for PHC barangays by region, total 5,987, per DC No. 2025-0549. Cross-checks the
  new `uuc-phc-2025` dataset.
- **p27** — DOH honorarium allocation by income class: 3rd 35,645 / 4th 27,058 / 5th 7,541 BHWs
  = 70,244 at ₱3,000/mo = ₱2.53 B/yr. Cross-checks `agg_honorarium` and the E3.7 income-class work.
- **p160–168** — JMC 2023-001 BHW retention status by region, as of 18 Sept 2025. No structured
  counterpart; document-only, which is precisely what `searchDocuments` is for.
- **p25–37** — an FAQ section already written as question/answer pairs. Per §10.1 these seed the
  regression list without anyone authoring expected answers.

### 12.3 Chunking — one slide, one chunk

A slide is the natural chunk and gives an exact citation ("cue cards, slide 37"). At 687 chars
average, slides sit well under any embedding limit; merge consecutive slides within a section for
retrieval context, but cite the range rather than flattening it.

**Extraction hazard, evidenced.** The deck's own slide numbers sit in the text layer and bleed
into extracted text mid-token:

| Slide | Extracted | Should be |
|---|---|---|
| 37 | `MIMAROPA REG42ION 458` | `MIMAROPA REGION 458` (42 = the slide number) |
| 157 | `w190orkshops` | `workshops` |
| 163 | `report196ed` | `reported` |

Naive extraction carries these into the embedding *and* into any quoted span. Per §7 the citation
**is** the check for prose claims, so a corrupted quotation is a correctness failure, not a
cosmetic one. Strip the slide-number element by position before chunking, and assert page and
offset per Increment 2.3 rather than assuming them.

### 12.4 A gap this corpus exposes in the audit model

Slide 26 asserts: *"277,767 (Registered and Accredited BHWs) — Source: BHW Connect as of Dec
2025."* §2 of this plan records 270,917 BHW records behind SQL.

`auditNarrative` strips any sentence whose numbers are absent from the tool payloads. So a
**correct, correctly-cited quotation of the department's own published figure would be stripped**,
while the SQL number survives — and the assistant would silently drop the very number a briefing
asks for. §7 anticipated that the audit covers numbers only and prose goes uncovered; this is the
inverse case, and the plan has no rule for it.

**Proposed rule, for `DECISIONS.md`:**

1. A number carried by a document chunk is admissible when its citation resolves to that chunk.
2. It must render **attributed and dated** — "the 2027 Budget Cue Cards state 277,767 registered
   and accredited BHWs as of Dec 2025" — never as a bare fact.
3. Where a document number and a SQL number disagree, the assistant surfaces **both** with their
   as-of dates and does not silently prefer either.

Rule 3 matters more than it looks: these two numbers are not a contradiction to resolve, they are
different measures at different dates, and an assistant that picks one is hiding the distinction a
budget discussion actually turns on.

### 12.5 Sensitivity

Internal budget material, and slide 26 records that "the BHW Connect web site [is] under system
hold by KMITS due to security threat." The admin-only constraint (§0 #2, §9.1) is load-bearing for
this corpus specifically — it must not reach a public surface. The DOH hosting clearance question
from §11 is unresolved and applies to loading it at all; confirm before Increment 2.1 runs.

---

*Prepared as a proposed plan. If any statement here conflicts with `BUILD_PLAN.md`, that document
governs; record the conflict in `DECISIONS.md` and choose the smallest deviation preserving intent.*
