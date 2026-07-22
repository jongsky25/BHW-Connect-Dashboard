# Ask-the-Data Answer Bank — Phased Implementation (handoff document)

The committed implementation plan for capturing "Ask the data" chat answers into a stored answer
bank, then serving that bank as the **first-layer response** for repeat questions — so a question
the AI has already answered (and the numeric audit has already verified) costs zero provider
credits the second time it is asked. Follow the working conventions in `BUILD_PLAN.md` §5
(engineering standards) and the per-increment logging convention of `DECISIONS.md` (append an
entry per increment: what was built, what was decided, verify evidence).

**Status:** proposed — awaiting owner approval of the decisions in §0. Phases ship in order;
each increment is an independently shippable PR-sized unit.

## Why this works here

Three properties of the existing system make chat answers unusually cacheable:

1. **Answers are deterministic in spirit.** The system prompt grounds every answer exclusively in
   the site's own aggregate tables, and `lib/ai/audit.ts` strips any sentence whose numbers don't
   appear in the tool payloads. Two runs of the same question against the same dataset version
   should produce the same *facts*, differing only in phrasing — so serving a stored audited
   answer loses nothing.
2. **Staleness is already solved.** `ai_narrative_cache` keys on the active dataset's
   `last_updated_at` (`data_version`) so a fresh ingestion invalidates everything automatically
   (`lib/ai/narrative.ts`). The answer bank reuses the identical scheme — a cached answer can
   never outlive the numbers it quotes.
3. **The question space is small.** This is a domain dashboard with starter questions, a fixed
   indicator set, and ~7 tools. Real traffic will concentrate heavily on a modest set of
   questions ("which region has the highest accreditation rate?"), which is exactly the shape
   where an exact/near-match cache has a high hit rate.

## 0. Owner decisions (proposed defaults — confirm or override before Phase A2)

| # | Question | Proposed default |
|---|---|---|
| 1 | Do cache hits count against the per-session chat rate limit (20 / 10 min)? | **No.** A cache hit costs no credits; the rate limit exists to protect provider quota. Hits are still logged (`usage_events`) so abuse is visible. |
| 2 | Is a cached answer labeled in the UI? | **Yes, subtly.** The final `message` stream event carries `cached: true`; the chat UI shows a small "answered from verified responses" note. Honesty about AI output is an existing site principle (`/methodology#ai`). |
| 3 | Are unreviewed ("auto") bank entries served, or only admin-approved ones? | **Auto entries are served** — they already passed the numeric audit, which is the real safety gate. Admin curation (Phase A3) is for promoting, editing, and *blocking*, not a prerequisite for serving. |
| 4 | Near-match serving (Phase A4) on by default? | **Off until measured.** Ship exact-match first, read the hit-rate numbers from `usage_events`, then decide whether trigram near-matching is worth its false-positive risk. |

## 1. Ground rules for every increment

- **Free tier only.** One new table + one column-level migration; no new infrastructure. Trigram
  matching (Phase A4) uses the already-installed `pg_trgm` extension — no pgvector, no embedding
  API spend, unless a later owner decision adds it.
- **Never serve unaudited text.** Only answers that came out of `auditNarrative` non-empty are
  ever stored; the bank therefore only ever replays audited text.
- **Never serve across dataset versions.** `data_version` is part of the cache key, same as
  `ai_narrative_cache`. No TTL games — a version bump is the invalidation.
- **Degrade gracefully.** Every bank read/write is wrapped like `lib/ai/rate-limit.ts`: a
  Supabase failure or unconfigured service key falls through to the live tool loop (a miss),
  never a 500. The cache must not be able to break chat.
- **Only single-turn questions are cacheable.** A follow-up ("what about Region VII?") only means
  something with the conversation history; the bank keys strictly on
  `messages.length === 1` requests. Multi-turn requests always go live (and are still captured
  in the log for analysis, marked as follow-ups).
- **Geo context is part of the question.** The route injects "the user is currently viewing
  geo_code X" into the system prompt, so "how many BHWs are validated?" means different answers
  on different place pages. The cache key includes `geo_code` (or `national` when no context).
- **Privacy.** Questions are free text from anonymous sessions. The log stores `session_id`
  (already the pattern in `usage_events`) and question text, service-role RLS only, no IP beyond
  the existing `ip_hash` convention. No PII is solicited; the methodology page's AI section gets
  a sentence noting questions may be stored to improve responses.

## 2. Architecture at a glance

```
POST /api/ai/chat
  ├─ validate + rate limit (unchanged)
  ├─ [A2] single-turn? → normalize(question) → ai_ask_cache lookup
  │        hit (same data_version) → stream cached answer, log hit, DONE (0 credits)
  │        miss/error → fall through
  ├─ runToolLoop → auditNarrative (unchanged)
  ├─ [A1] capture: insert Q→A row into ai_ask_log (best-effort, non-blocking)
  ├─ [A2] write-back: upsert audited answer into ai_ask_cache (status 'auto')
  └─ stream live answer (unchanged)

[A3] /admin answer-bank page: review log + bank, promote/edit/block entries,
     see hit counts → the "documented" curated FAQ layer.
```

Two tables, deliberately separate concerns:

- **`ai_ask_log`** — append-only capture of every chat turn (the raw record: what was asked, what
  was answered, by which provider, served live or from cache). This is the dataset you study to
  decide what belongs in the bank and to measure savings. Nothing is ever served from it.
- **`ai_ask_cache`** — the serving bank: one row per (normalized question, geo scope, data
  version), upserted on live generations, read on every single-turn ask. Mirrors
  `ai_narrative_cache`'s role and lifecycle.

## 3. Phase A1 — Capture (ship first, zero user-facing change)

**A1.1 — Migration `ai_ask_log`**

```sql
create table ai_ask_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  session_id uuid not null,
  question_raw text not null,
  question_norm text not null,          -- see normalization spec, §5
  geo_code text,                        -- page context, null = national/none
  geo_level text,
  turn_index int not null,              -- 0 = first question, >0 = follow-up
  answer_md text,                       -- audited final text; null if capacity/error/empty
  outcome text not null,                -- 'answered' | 'audited_empty' | 'capacity' | 'error'
  provider text,
  served_from text not null default 'live',  -- 'live' | 'cache'
  data_version text,
  tool_trace jsonb,                     -- [{name, args}] from onToolCall, for analysis
  latency_ms int
);
create index ai_ask_log_question_norm_idx on ai_ask_log (question_norm);
create index ai_ask_log_created_at_idx on ai_ask_log (created_at);
alter table ai_ask_log enable row level security;
-- service-role only: no anon/authenticated policies.
```

**A1.2 — `lib/ai/ask-log.ts`** — `recordAsk(entry): Promise<void>`, best-effort try/catch like
`recordChatMessage`. Called from the chat route after the stream's final event is determined
(fire-and-forget; must not delay `controller.close()`). Unit tests mirror `rate-limit.test.ts`
(mock service client, assert failure never throws).

**A1.3 — Route wiring** — `app/api/ai/chat/route.ts` collects `tool_trace` (it already receives
every `onToolCall` event), timestamps around `runToolLoop`, and calls `recordAsk` in each branch
(`capacity`, empty, audited answer, catch). `data_version` comes from `getActiveDataset()` —
already the narrative pattern.

*Verify:* ask questions locally, confirm rows land with correct outcome/turn_index; kill the
service key and confirm chat still answers.

## 4. Phase A2 — Answer bank as first-layer response

**A2.1 — Migration `ai_ask_cache`**

```sql
create table ai_ask_cache (
  cache_key text primary key,           -- data_version|geo_scope|question_norm
  question_norm text not null,
  question_display text not null,       -- a raw phrasing, for the admin UI
  geo_code text,                        -- null = national/no context
  answer_md text not null,
  provider text,
  data_version text not null,
  status text not null default 'auto',  -- 'auto' | 'approved' | 'blocked'
  hit_count int not null default 0,
  generated_at timestamptz not null default now(),
  last_hit_at timestamptz
);
create index ai_ask_cache_norm_idx on ai_ask_cache (question_norm);
alter table ai_ask_cache enable row level security;
-- service-role only.
```

**A2.2 — `lib/ai/ask-cache.ts`** — the module the route talks to:

- `lookupAskCache(questionNorm, geoCode, dataVersion)` → `{answerMd, provider} | null`. Returns
  null for `status = 'blocked'`, wrong data_version, or any error. On hit, increments
  `hit_count`/`last_hit_at` (fire-and-forget).
- `storeAskAnswer(...)` → upsert with `status: 'auto'`; never overwrites an `approved` or
  `blocked` row's status (upsert on conflict updates answer only when existing status is
  `auto` — an admin-edited answer must not be clobbered by a fresh generation).
- `normalizeQuestion(raw)` per §5, exported and unit-tested exhaustively — this function *is*
  the cache-correctness surface.

**A2.3 — Route integration** — before `runToolLoop`, when `messages.length === 1`: lookup; on
hit, send the `message` event with `cached: true` and provider `"cache"`-style metadata, log to
`ai_ask_log` with `served_from: 'cache'`, log a `ai_chat_cache_hit` usage event, and (per
decision #1) skip `recordChatMessage`'s rate-limit debit. On miss, proceed exactly as today and
write back after a successful audit. The stream event type gains an optional `cached` field —
additive, no client break.

**A2.4 — Chat UI** — `components/chat/chat-launcher.tsx` reads `cached` and renders the §0-#2
note under the answer. Starter questions now become effectively free after their first ask per
dataset version — worth calling out in `DECISIONS.md`.

**A2.5 — Metrics** — no new infra: hit rate = `ai_chat_cache_hit` / (`ai_chat_cache_hit` +
`ai_chat_message`) over `usage_events`. Add the query to the DECISIONS entry so the owner can
check savings.

*Verify:* same question twice → second answer instant, `tool_call` events absent, hit_count
incremented; bump data_version → cache misses; blocked row → live generation.

## 5. Normalization spec (exact-match key)

`normalizeQuestion`: Unicode NFKC → lowercase → trim → collapse internal whitespace → strip
terminal punctuation (`?`, `.`, `!`) → strip a leading politeness prefix from a fixed list
("please", "can you", "could you", "pls"). Nothing cleverer in A2 — every additional rewrite
rule is a chance for two genuinely different questions to collide. Collisions serve wrong
answers; misses just cost one live call. Bias every choice toward missing.

Cache key: `${data_version}|${geo_code ?? "national"}|${question_norm}` — same shape and
delimiter convention as `ai_narrative_cache`.

## 6. Phase A3 — Curation ("documented" answer bank)

The admin surface that turns the raw capture into a deliberate FAQ layer. Auth via the existing
`admin_users` pattern.

- **A3.1 — `/admin/answer-bank` page**: two views. *Log view*: recent/frequent questions from
  `ai_ask_log` grouped by `question_norm` with ask counts — shows what people actually ask.
  *Bank view*: `ai_ask_cache` rows sorted by hit_count with status controls.
- **A3.2 — Actions**: approve (pin an entry as curated), edit answer text (edited entries keep
  `approved` status and are never overwritten by write-back), block (question always goes live —
  the escape hatch for anything time-sensitive or subjective the cache shouldn't freeze).
- **A3.3 — Refresh-on-ingest (the big credit saver)**: extend the existing daily narrative
  precompute cron — for every `approved` entry whose `data_version` is stale, re-run the tool
  loop once with the canonical question and upsert under the new version. Frequent questions
  then *never* miss: each dataset refresh costs N precompute calls instead of N × visitors live
  calls. `auto` entries are not precomputed (they regenerate lazily on first ask) to keep the
  cron bounded.

## 7. Phase A4 (optional, measure first) — near-match layer

Only if A2's measured hit rate is meaningfully depressed by phrasing variants ("what's the
accreditation rate in region 7" vs "region vii accreditation rate"):

- Trigram candidate lookup via already-installed `pg_trgm`:
  `similarity(question_norm, $q) > 0.85` (threshold tuned against the real `ai_ask_log` corpus
  before enabling), restricted to `approved` entries only and same geo scope + data_version.
- Near-matches are held to a stricter bar than exact matches precisely because the audit
  verified the stored answer against the *stored* question, not the asked one.
- pgvector/embeddings are explicitly out of scope unless the owner approves new spend; trigram
  gets most of the phrasing-variant win for free.

## 8. Explicit non-goals

- **No caching of follow-up turns** (history-dependent; wrong-answer risk dwarfs savings).
- **No cross-geo answer reuse** ("Cebu" answer never serves a "Bohol" ask, even if worded
  identically — geo scope is in the key).
- **No LLM-based question canonicalization** in the serving path — that would spend the credits
  the cache exists to save.
- **No serving from `ai_ask_log`** — the log is evidence, the bank is the product.

## 9. Sequencing & effort

| Increment | Depends on | Size |
|---|---|---|
| A1 capture (migration + log module + route wiring) | — | 1 small PR |
| A2 bank + first-layer serve + UI label + metrics | A1 | 1 medium PR |
| A3 admin curation page + actions | A2 | 1 medium PR |
| A3.3 refresh-on-ingest cron extension | A3 | 1 small PR |
| A4 trigram near-match | A2 metrics review | 1 small PR (gated) |

A1 + A2 alone deliver the credit savings; A3/A4 improve coverage and control. Each PR appends
its `DECISIONS.md` entry per house convention.
