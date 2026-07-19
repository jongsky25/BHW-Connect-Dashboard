# BHW Connect — Build Plan & Reference

**Version:** 1.0 · **Date:** 2026-07-19 · **Status:** Approved reference for implementation

BHW Connect is a public, open-access dashboard for the Philippine Barangay Health Worker (BHW) dataset in this repository (`dataset.parquet`, 270,917 records). It serves both lay and technical audiences with WHO WPSAR-style figures, cascading geographic filters, purpose-built downloads, and (in Phase 2) strictly data-grounded AI narratives and chat. Everything runs on free tiers with graceful degradation.

---

## 0. How to use this document (instructions to the implementing agent)

This document is the single source of truth for the build. Follow it as written; where it is silent, prefer the Engineering Standards (§5) and the Pitfall Register (§9).

- Work **one increment at a time**, in order, within the current phase. Do not start an increment until the previous increment's **Verify** checklist passes.
- Each increment should be one coherent commit (or small commit series) with a message referencing its ID (e.g. `feat(1.4): explore page with cascading filters`).
- Every increment lists **Guardrails** — hard constraints. Do not trade them away for convenience.
- If reality contradicts this plan (an API changed, a limit is different, a dataset assumption fails), stop, record the discrepancy in `docs/DECISIONS.md`, choose the smallest deviation that preserves the plan's intent, and continue.
- Never expose raw row-level data publicly. Never let AI features become a dependency of core pages. Never state a number in UI copy or AI output that wasn't computed from the database.

---

## 1. Product vision & audiences

**Goal:** every type of person — a barangay captain, a curious resident, a journalist, a DOH analyst, an epidemiologist — can open BHW Connect and, within a minute, learn something true and useful about BHWs in a place they care about.

Design principles, in priority order:

1. **Trustworthy** — every figure carries explicit Person/Place/Time framing (what N, where, when), methodology is public, data gaps are shown rather than hidden, small cells are suppressed to protect individuals.
2. **Layered** — plain-language headline first; technical detail (N, denominators, caveats, definitions) one tap away, collapsed by default. One dashboard, two reading depths — never two separate sites.
3. **Light** — mobile-first, low-bandwidth (PH mobile-data context). Clean, uncluttered, WPSAR-minimal aesthetic. Multiple focused pages over one overloaded page.
4. **Alive** — spotlight insights, comparison mode, shareable permalinks, "find my barangay" search.
5. **Extensible** — this dataset is #1 of many; the dataset registry and geo dimension are shared infrastructure, not BHW-specific.

---

## 2. Locked decisions

| Area | Decision |
|---|---|
| Stack | Next.js (App Router, TypeScript strict) + Supabase Postgres + Vercel |
| Hosting budget | Free tiers only (Vercel Hobby, Supabase Free). Revisit only if real traffic warrants. |
| Supabase slot | Free tier allows 2 active projects; **pause `koica-journey-tracker`** (ref `zmoybshitjcgeijiysoi`) to free a slot, then create new project **`bhw-connect`** under org `rparoyuerqqrozxehztm` |
| Vercel | New project under team `jongsky25's projects` (`team_wavZZVJXBgbZ6xwRdtgYQCi6`), site at a free `*.vercel.app` subdomain (target: `bhw-connect.vercel.app`) |
| Name | **BHW Connect** |
| Privacy | Small-cell suppression at **N < 5** for individual-level breakdowns at barangay level, with roll-up to next safe geo level. Anonymized usage logging (salted+truncated IP hash, no PII), simple privacy notice (RA 10173-aware). |
| Data license | Published aggregates & downloads under **CC BY 4.0** |
| Source attribution | Cite generically as an official DOH Barangay Health Worker registration/accreditation dataset, **2025 snapshot**; refine wording before launch |
| Active status | All BHWs in the dataset are treated as **active for 2025** (snapshot semantics). Year-list arrays still parsed for service-history charts. |
| Language | English only v1; do not preclude future Filipino toggle |
| Maps | Phase 1: choropleth down to **city/municipality** level only. Barangay data via search + profile pages. Barangay polygons (PMTiles) deferred to Phase 2+. |
| AI | Phase 2. Strictly tool/function-grounded; multi-provider **free tiers only** (Gemini → Groq → OpenRouter free pool → Mistral), priority-fallback routing, quota check-before-call, auto-pause on cap, silent fallback to precomputed content. Core dashboard must fully work with zero AI. |
| Sequencing | Phase 0 foundation → Phase 1 core dashboard → Phase 2 AI + admin + growth |
| Admin | Phase 2 protected `/admin` (Supabase Auth + role). Phase 1 uses scripted ingestion only. |
| Branding | Independent public-interest identity; WHO WPSAR as figure-style reference. No agency branding. |

---

## 3. Data ground truth (verified by direct inspection of `dataset.parquet`)

270,917 rows × 130 columns. One row = one BHW.

**Geography** — 18 regions (includes NIR and BARMM), 118 provinces, 1,639 cities/municipalities, 39,276 barangays. `INCOME CLASS` values 1–6.

⚠️ **PSGC codes are stored as integers with leading zeros stripped.** Barangay codes appear as 9–10 digits — the underlying standard is the **10-digit PSGC (2023 series)**; Regions 1–9 lost their leading zero. Region codes run 1–19 (no 8-digit gap issues, but note both `MIMAROPA` and `NIR` are present, pinning the PSGC vintage to ≥2024 releases that include NIR). **At ingestion, zero-pad and store codes as fixed-width TEXT:** region 2, province 5, city/mun 7, barangay 10 digits. All joins (including boundary files) key on the padded text form.

**Key field findings:**

- **No unique BHW identifier** → generate surrogate `bhw_id` at ingestion.
- `REGISTERED BHW` = `YES` for all rows (useless as a filter); `ACCREDITED BHW` is the meaningful split: 193,897 YES / 77,020 NO.
- `SEX`: 266,335 Female / 4,582 Male — barangay-level sex breakdowns will hit suppression routinely.
- `ACTIVE/INACTIVE YEARS OF SERVICE` are comma-separated year-list strings (e.g. `"2019,2020,2021"`) → parse to `int[]` + derived scalars (`years_count`, `first_year`, `last_year`).
- Honorarium: 4 parallel column-sets (flag/frequency/amount × region/province/citymun/barangay). ~27 of 270K rows have flag/amount inconsistencies → reconcile as `receives = (flag = 'YES' OR amount > 0)` and log exceptions to a QA report. 89% of BHWs are paid at barangay level; ~1.9% at region level.
- ~50 training topic pairs `TRAINING: <topic>` (Yes/No/blank) + `TRAINING YEAR: <topic>`; the `Others please specify` topic has a third free-text column (`TRAINING DETAILS: ...`) — special-case it. **Do not publish the free-text detail column** (uncontrolled text, PII risk); keep it raw-side only.
- Demographics available: sex, civil status, age, blood type, educational attainment, IP (indigenous people) status, household count.
- Certifications: TESDA BHS NC II (+year, certified flag +year), BHW Reference Manual training (+year).

---

## 4. Architecture

### 4.1 Database schema (Supabase Postgres)

**Privacy model:** raw tables are service-role-only (RLS denies `anon`/`authenticated` entirely; never exposed through PostgREST to browsers). The public reads **only** curated `agg_*` tables. Suppression is enforced at **aggregate-build time**: the build job walks every aggregate cell, and any individual-level cell with `n < 5` at barangay level is nulled, flagged `is_suppressed = true`, and given a `rollup_geo_code/rollup_geo_level` pointer to the nearest safe ancestor. (Counts of totals — e.g. "this barangay has 3 BHWs" — are not suppressed; only person-characteristic breakdowns are.)

```
dim_geo            geo_code TEXT PK (padded PSGC), geo_level ENUM(region|province|citymun|barangay),
                   geo_name, parent_code FK, region_code, province_code, citymun_code (denormalized),
                   income_class SMALLINT NULL, psgc_vintage TEXT
dim_dataset        dataset_id PK, slug UNIQUE, name, source_name, source_url, license,
                   methodology_md, geo_join_level, as_of_date, version, last_updated_at, status
fact_bhw_raw       bhw_id BIGINT PK (surrogate), geo_code FK→dim_geo (barangay),
                   sex, civil_status, age SMALLINT, bloodtype, educational_attainment, ip_status,
                   household SMALLINT, registered_year, accredited BOOL, accreditation_year,
                   tesda_nc2 BOOL, tesda_nc2_year, tesda_certified BOOL, tesda_certified_year,
                   ref_manual_trained BOOL, ref_manual_year,
                   active_years INT[], active_years_count, first_active_year, last_active_year,
                   inactive_years INT[], inactive_years_count,
                   training JSONB  -- {"<topic-slug>": {"trained": bool, "year": int|null}}
                   ingestion_batch_id
fact_honorarium    id PK, bhw_id FK, payer_level ENUM(region|province|citymun|barangay),
                   receives BOOL, amount NUMERIC NULL, frequency ENUM(monthly|quarterly|semi_annual|annual|other) NULL,
                   normalized_monthly_amount NUMERIC NULL, source_note TEXT
-- Public aggregates (RLS: public SELECT, service-role write). All share the grain prefix
-- (dataset_id, geo_code, geo_level) with a UNIQUE index incl. breakdown dims for idempotent upsert.
agg_bhw_counts       + n_total, n_accredited, pct_accredited, avg_active_years, any_honorarium_pct
agg_demographics     + dimension ENUM(sex|age_band|civil_status|bloodtype|education|ip_status),
                       category, n, pct, is_suppressed BOOL, rollup_geo_code, rollup_geo_level
agg_training         + topic_slug, topic_label, n_trained, n_total, coverage_pct, median_training_year
agg_certification    + cert_type, n, pct
agg_honorarium       + payer_level, n_receiving, pct_receiving, avg_monthly_amount, modal_frequency
agg_geo_summary      one denormalized profile row per geo_code (name, level, parents, n_total,
                       pct_accredited, top_training_gap, any_honorarium_pct, search_text tsvector)
agg_data_completeness + field_name, n_missing, pct_missing
feedback           id PK, created_at, page_path, category ENUM(bug|data_question|suggestion|other),
                   message TEXT (length-capped), email TEXT NULL (optional, consented), session_id UUID
usage_events       id PK, created_at, session_id UUID (client-random), event_type, page_path,
                   geo_code NULL, meta JSONB (bounded), ip_hash TEXT (salted+truncated, no raw IP)
-- Phase 2:
ai_narrative_cache   cache_key TEXT PK (hash: data_version|geo|indicator|narrative_type),
                     content_md, provider, model, generated_at, data_version
ai_provider_quota    provider, window_type ENUM(minute|day|month), window_start, request_count,
                     limit_value, is_paused BOOL, paused_until  -- limits are CONFIG, not code
admin_users          user_id FK→auth.users, role ENUM(admin|editor)
ingestion_batches    batch_id PK, started_at, finished_at, source_file, row_counts JSONB, qa_report JSONB
changelog_entries    id PK, published_at, title, body_md
```

RLS summary: `feedback`/`usage_events` = public INSERT only (no public SELECT — protects submitters); `agg_*`, `dim_*` = public SELECT; `fact_*`, `ai_*`, `admin_*`, `ingestion_batches` = service-role only.

### 4.2 App structure (Next.js App Router)

Filter state lives **entirely in URL search params** (typed codec via `nuqs` + a shared Zod schema in `lib/filters`) — one source of truth, so every view is a shareable permalink and every export is reproducible from a URL.

```
app/
  page.tsx                        # Home: national KPIs, spotlight insight, "find my barangay" search
  explore/                        # Interactive dashboard; cascading filters national→…→barangay
  compare/                        # ?geos=CODE1,CODE2&indicator=… side-by-side
  place/[geoLevel]/[geoCode]/     # Canonical shareable geo profile (SSG top-N, ISR the rest)
  methodology/  glossary/  data-quality/  feedback/  privacy/  roadmap/
  admin/                          # Phase 2 (Supabase Auth + role gate)
  api/export/{csv,xlsx,png,pptx}/route.ts    # Stateless; accept the same filter params as pages
  api/geo/search/route.ts
  api/log/route.ts                # usage-event ingest (POST only)
  api/ai/{insight,chat}/route.ts  # Phase 2
lib/    filters/  db/  charts/  exports/  suppression/  glossary/  ai/(P2)
components/  filters/  charts/  maps/  narrative/  layout/  export/
ingestion/   (Python: parquet → Postgres → aggregates; run locally/scripted, not deployed)
public/geo/  (simplified static boundary GeoJSON, immutable-cached)
```

**Narrative component contract (used on every figure):** `<FigureCard>` renders — title; WPSAR-style caption line (*"N = 12,345 BHWs · Region IV-A · 2025 snapshot"*); the chart; a one-sentence **layman headline** ("About 7 in 10 BHWs here are accredited"); a collapsed **Technical details** section (exact N and denominator, definitions used, suppression note if any, link to methodology); and an export menu (PNG/PPTX/XLSX/CSV) that passes the current filter params to `api/export/*`. Phase 1 narratives are template-generated from the data (parameterized sentences, not AI); Phase 2 swaps the same slot to AI-generated text with cache.

### 4.3 Maps

- Source: community-maintained PSGC-aligned GeoJSON (primary candidate: `faeldon/philippines-json-maps`, 2023 PSGC series — must include NIR; verify against `dim_geo`).
- Preprocess with `mapshaper` (simplify to ~5–10% detail, quantize) → static files in `public/geo/` (immutable cache headers): one national file of region polygons, one of province polygons, and **per-region files of city/mun polygons** (lazy-loaded when a region is selected) to keep initial payloads small.
- Library: **MapLibre GL JS**, lazy-loaded (`next/dynamic`, no SSR). No basemap tiles — plain choropleth on a neutral background (WPSAR-minimal, zero tile-provider dependency). Non-map fallback (ranked bar list) always rendered alongside for accessibility/low-end devices.
- Join key: padded PSGC text codes. The reconciliation script (increment 1.6) reports every unmatched code both ways; unmatched geographies render hatched/grey "no boundary" rather than disappearing.

### 4.4 Exports (purpose-built, never screenshots)

| Format | How | Notes |
|---|---|---|
| CSV | Server query of `agg_*` + header comment block (title, filters, N, source, license CC BY 4.0, retrieval timestamp) | Cheapest path; also the API story for researchers pre-Phase-2 |
| XLSX | `exceljs`: styled title row, data sheet, separate "About this data" sheet (methodology, definitions, suppression note, license) | Aggregates only, never raw rows |
| PNG | Server-render chart to SVG (same chart-spec code as client) → rasterize via `@resvg/resvg-js`; compose title + caption + footer. `@vercel/og`/Satori acceptable alternative if it handles the chart shapes | **Node runtime route** (not Edge); prototype in increment 1.8 before generalizing |
| PPTX | `pptxgenjs`: native editable title/caption/source text boxes + the PNG chart embedded | One slide per figure |

All export routes: stateless, bounded to single-figure/bounded-series output, rate-limit by session if abuse appears.

### 4.5 AI layer (Phase 2) — grounding is structural, not prompt-based

- **Tool-only data access.** The model can obtain numbers exclusively by calling a fixed tool set implemented on the same `lib/db` layer the pages use (identical numbers, identical suppression): `listAvailableIndicators`, `getIndicatorByGeo`, `compareGeos`, `getTrainingCoverage`, `getHonorariumStats`, `getDataCompleteness`, `searchGeo`.
- **Post-hoc numeric audit.** After generation, extract every number from the draft text; any number not traceable to a tool-result payload (exact or rounded match) → strip the sentence or reject and regenerate. Log rejections.
- **Provider cascade (priority fallback):** Gemini free tier → Groq free → OpenRouter `:free` pool → Mistral La Plateforme free. Cohere trial & HF Inference free are **excluded** (ToS: non-production). Verify each provider's current limits and public-use ToS at implementation time; store limits as rows in `ai_provider_quota`, never as code constants.
- **Quota flow:** check-before-call per (provider, window); on unexpected 429 despite passing pre-check → set `is_paused/paused_until` immediately. When all providers are capped: narratives serve from `ai_narrative_cache`; chat shows an honest "live AI is at capacity right now — cached insights below" note. Never an error state; core pages unaffected (AI components behind Suspense with non-AI fallbacks).
- **Hybrid compute:** nightly Vercel cron precomputes narratives for national + 18 regions + 118 provinces + top-N visited places (from `usage_events`), keyed by `data_version` for clean invalidation; live generation only on cache miss and for chat, with opportunistic write-back.

---

## 5. Engineering standards & best practices

- **TypeScript strict**; Zod validation at every boundary (URL params, API inputs, DB rows via generated types + `supabase gen types`).
- **DB access:** server-side only (`lib/db`), using the Supabase **transaction pooler (port 6543)** connection for serverless; never ship service-role keys to the client; anon key + RLS for the few client-side reads (geo search may be server route anyway).
- **Testing:** unit tests (Vitest) are **mandatory for suppression logic, PSGC padding, honorarium reconciliation, filter codec** (the correctness-critical core); component tests for `FigureCard`; one Playwright smoke spec (home → explore → filter to barangay → export CSV) run in CI. Chromium is pre-installed in dev environments (`/opt/pw-browsers`).
- **CI (GitHub Actions):** lint + typecheck + unit tests on every PR; Playwright smoke on main. Keep CI under free-minute budgets.
- **Accessibility:** WCAG 2.1 AA target — semantic HTML, keyboard-navigable filters, color-blind-safe sequential palettes, text alternatives for maps (the ranked-list fallback), no meaning carried by color alone.
- **Performance budgets:** initial JS < 200 KB gzipped on content pages; maps and chart libs lazy-loaded; LCP < 2.5 s on simulated Fast-3G for `/` and `/place/*`; static boundary files immutable-cached.
- **SEO/sharing:** per-geo metadata + OpenGraph on `/place/*` pages; sitemap for region/province/citymun pages (skip 39K barangay URLs in v1 sitemap).
- **Privacy engineering:** no third-party analytics; own `usage_events` with salted+truncated IP hash (salt in env, rotated), 30-day raw retention then aggregate-and-purge; privacy page states exactly what is collected and why (RA 10173-aware).
- **Secrets:** all in Vercel/Supabase env config; `.env.example` committed, `.env*` gitignored; never commit keys, never echo them in CI logs.
- **Content conventions:** every figure uses `FigureCard`; every technical term used anywhere must exist in `lib/glossary` (build fails on unknown term references — keeps the glossary honest).
- **Decisions log:** deviations and judgment calls recorded in `docs/DECISIONS.md` as short dated entries.

---

## 6. Phase 0 — Foundation

> Outcome: provisioned infra, schema in place, all data ingested and aggregated with suppression, verified by QA report. No UI yet.

### 0.1 Repo scaffold & CI
- Scaffold Next.js (App Router, TS strict, Tailwind) at repo root; ESLint + Prettier; Vitest; folder skeleton from §4.2; `.env.example`; move `dataset.parquet` to `ingestion/data/` (git-lfs not needed; it's 5 MB); README rewrite (what/why/status + link to this plan); `docs/DECISIONS.md` created.
- GitHub Actions: `ci.yml` (lint, typecheck, test).
- **Verify:** `npm run lint && npm run typecheck && npm test` pass locally and in CI on the PR.
- **Guardrails:** no app features yet; keep dependencies minimal (no chart/map libs installed until their increments).

### 0.2 Provision Supabase + Vercel
- Pause Supabase project `koica-journey-tracker` (`zmoybshitjcgeijiysoi`). Create project `bhw-connect` in org `rparoyuerqqrozxehztm`, region `ap-southeast-1` (Singapore — closest to PH). Record project ref, URL, anon key in Vercel env + local `.env`.
- Create Vercel project `bhw-connect` under `team_wavZZVJXBgbZ6xwRdtgYQCi6`, linked to this repo, production branch `main`.
- **Verify:** Supabase project ACTIVE_HEALTHY; Vercel preview deploy of the scaffold succeeds; `koica-journey-tracker` shows INACTIVE/paused.
- **Guardrails:** free tiers only; do not delete anything — pause only.

### 0.3 Schema migrations
- Write SQL migrations (in `supabase/migrations/`) for every table in §4.1 including all RLS policies and enums; seed `dim_dataset` with the BHW dataset entry (slug `bhw-2025`, license CC BY 4.0, generic DOH attribution, `as_of_date = 2025`).
- **Verify:** apply to the new project; as `anon`, confirm SELECT on `agg_*`/`dim_*` works, SELECT on `fact_*` is denied, INSERT on `feedback`/`usage_events` works and SELECT is denied. Write these checks as a repeatable script (`ingestion/verify_rls.py` or SQL file).
- **Guardrails:** RLS enabled on **every** table from the first migration — never created open then locked later.

### 0.4 Ingestion pipeline
- Python (pandas + psycopg) in `ingestion/`: parquet → `dim_geo` (distinct codes, **zero-padded TEXT** per §3, parent links, income class) → `fact_bhw_raw` (surrogate IDs, year-list parsing, training JSONB with slugged topic keys, `Others` free-text kept raw-side only) → `fact_honorarium` (unpivot 4 column-sets; reconciliation rule; frequency normalization; `normalized_monthly_amount`).
- Produce a QA report (JSON + printed summary) into `ingestion_batches`: row counts in/out per table, honorarium exceptions list, unparseable year-lists, null profiles per column.
- **Verify:** row-count reconciliation (270,917 raw = fact rows; geo counts = 18/118/1,639/39,276); spot-check 5 random BHWs end-to-end against the parquet; QA report saved.
- **Guardrails:** idempotent (re-run = clean replace by batch, not duplicates); no raw row ever written to a public table.

### 0.5 Aggregate build + suppression
- SQL (or Python-orchestrated SQL) job building all `agg_*` tables at all four geo levels + national (`geo_code = 'PH'` sentinel row in `dim_geo`). Implement N<5 suppression + roll-up pointers for `agg_demographics` (age banded: <30, 30–39, 40–49, 50–59, 60+). Build `agg_geo_summary` incl. `search_text` tsvector, and `agg_data_completeness`.
- Unit-test the suppression routine against fixture data (cells at n=4,5,6; roll-up chain barangay→citymun→province).
- **Verify:** pick a real barangay with n_total < 5 → confirm every `agg_demographics` row for it is suppressed with correct roll-up; national totals match parquet-computed totals for 5 indicators (accredited %, sex split, one training topic, honorarium any-level %, avg service years).
- **Guardrails:** suppression tests are blocking — no UI work starts until they pass.

---

## 7. Phase 1 — Core public dashboard

> Outcome: launched public site — visual dashboard, filters, city/mun maps, downloads, feedback + usage logging. Fully functional with zero AI.

### 1.1 Design system & shell
- Design tokens (type scale, spacing, neutral background + one accent + colorblind-safe sequential ramp), `layout/` shell: header nav (Home, Explore, Compare, About-group), footer (license CC BY 4.0, source line, privacy link, "last updated" from `dim_dataset`). Mobile-first.
- **Verify:** Lighthouse a11y ≥ 95 on the shell; renders cleanly at 360 px wide.

### 1.2 Filter codec + data layer
- `lib/filters`: Zod schema + `nuqs` codec for `{geoLevel, geoCode, indicator?, compareGeos?, breakdowns?}`; cascading logic (child lists fetched from `dim_geo` by parent). `lib/db`: typed query functions over `agg_*` (these same functions later back the AI tools — keep them pure and parameterized).
- **Verify:** codec round-trip unit tests (URL → state → URL identity); invalid params fall back to national view, never crash.

### 1.3 Home page
- National KPI cards (total BHWs, % accredited, % receiving any honorarium, top training gap) via `FigureCard`-style captioning; spotlight module (template-driven "insight of the day" rotating from a curated query list); "find my barangay" search (`api/geo/search` over `agg_geo_summary.search_text`, debounced, links to `/place/...`).
- **Verify:** search finds an exact barangay, a misspelled municipality (prefix/trigram tolerance), and a region by common name ("CALABARZON"); all numbers match Phase-0 verification values.

### 1.4 Explore dashboard
- `/explore`: filter sidebar (cascading selects + active-filter chips + reset), figure grid: accreditation, demographics (with suppression-aware rendering — suppressed cells show "suppressed to protect privacy (n<5)" + roll-up link), training coverage (sortable topic table + top-gaps chart), honorarium (by payer level), service years. Every figure is a `FigureCard` (§4.2 contract) with working permalink.
- Chart library decision executes here: **Observable Plot** (SVG, WPSAR-like); wrap in a chart-spec abstraction (`lib/charts`) so server export reuses specs.
- **Verify:** full cascade national→Region I→Ilocos Norte→a muncity→a barangay updates every figure + URL at each step; browser back/forward restores states; suppressed barangay shows suppression UI, not blanks; JS budget respected (charts lazy-loaded).

### 1.5 Place profile pages
- `/place/[geoLevel]/[geoCode]`: profile header (name, breadcrumb of parents, income class, n_total), key figures, "compare with siblings" link, OpenGraph metadata. SSG for regions+provinces, ISR (e.g. revalidate 1 day) for citymun/barangay.
- **Verify:** deep-link a barangay URL cold → correct data + metadata; invalid code → friendly 404 with search.

### 1.6 Maps
- Boundary sourcing + reconciliation script (`ingestion/reconcile_boundaries.py`): download candidate GeoJSON (2023 PSGC vintage incl. NIR), join against `dim_geo` on padded codes, emit two-way unmatched report. Simplify via mapshaper → `public/geo/` per §4.3.
- MapLibre choropleth in `/explore` (region → province → citymun drill), always paired with the ranked-list fallback; hatched style for no-boundary geos.
- **Verify:** reconciliation report reviewed and committed to `docs/` (unmatched count explicitly accepted or fixed); map interaction on a mid-range mobile viewport stays smooth; total geo payload for initial region view < 1 MB.
- **Pitfall watch:** this is the flagged highest-risk increment — if code vintages mismatch badly, record options in `docs/DECISIONS.md` and prefer crosswalking codes over switching boundary sources blindly.

### 1.7 Compare mode
- `/compare?geos=A,B[,C,D]&indicator=…`: side-by-side columns of the same `FigureCard`s (2–4 geos, same level enforced), shareable URL, "add to comparison" entry points from place pages.
- **Verify:** compare two provinces and two regions; mismatched-level attempt is blocked with guidance; permalink reproduces exactly.

### 1.8 Exports
- Implement `api/export/{csv,xlsx,png,pptx}` per §4.4, driven by the same filter codec. Prototype PNG rasterization first (chart-spec → SVG → resvg) before wiring all figures. Wire the `FigureCard` export menu.
- **Verify:** for one barangay-level and one national figure: CSV opens with correct header block; XLSX has data + About sheet; PNG matches on-screen figure (title/caption/footer present); PPTX opens in PowerPoint/Slides with editable text; all four complete < 10 s on Vercel; suppressed cells are suppressed in exports too (**test this explicitly**).
- **Guardrails:** Node runtime routes; aggregates only; no headless browser.

### 1.9 Content & trust pages + telemetry
- `/methodology` (source attribution per §2, definitions, suppression rule, denominators, limitations, CC BY 4.0, changelog), `/glossary` (from `lib/glossary`, hover-tooltips wired across the app), `/data-quality` (missingness views from `agg_data_completeness` — presented as findings, not apologies), `/privacy`, `/feedback` (category + message + optional email → `feedback` table, rate-limited, honeypot), `/roadmap` (static v1: what's live, what's next, how to suggest datasets).
- Usage logging: tiny client util posting to `api/log` (page views with path+geo context, filter changes, exports, searches, feedback submits; session UUID in sessionStorage; salted+truncated IP hash server-side; respect DNT).
- **Verify:** RLS re-check (public can INSERT but not SELECT feedback/usage rows); events appear in table with no raw IP; every glossary term used in UI resolves.

### 1.10 Launch hardening
- Playwright smoke in CI; Lighthouse pass on `/`, `/explore`, one `/place` (perf budgets §5); 404/error pages; OpenGraph images for share cards; `robots.txt` + sitemap; final content proofread; production deploy + custom checks from §10 (Definition of Done).
- **Verify:** §10 checklist fully green; production URL live at `bhw-connect.vercel.app`.

---

## 8. Phase 2 — AI, admin & growth

> Outcome: grounded AI narratives + chat with free-tier cascade; admin panel; extensibility groundwork. Each increment ships independently; the site is never blocked on any of them.

### 2.1 Provider abstraction + quota tracker
- `lib/ai/providers/` implementing a common `AIProvider` interface (tool-calling capable) for Gemini, Groq, OpenRouter, Mistral; config-driven model choices. Quota tracker over `ai_provider_quota` (check-before-call; 429 → pause window). Re-verify each provider's current free-tier limits and public-use ToS **now**, store as config rows, and document findings in `docs/DECISIONS.md`.
- **Verify:** unit tests with mocked providers: cascade order, cap skip, 429 pause, all-capped signal. A manual scripted end-to-end call against each real provider succeeds.

### 2.2 Grounded tool layer + narrative generation
- Implement the §4.5 tool set over `lib/db`; system prompt (layman + technical register, WPSAR tone); post-hoc numeric audit; `api/ai/insight` route: cache lookup → live generate → write-back.
- **Verify:** adversarial tests — prompt-inject via geo names, ask for out-of-dataset stats, force a fabricated number through a mocked model → audit strips/rejects; generated narrative numbers all traceable to tool payloads; suppressed cells never surface in AI text.

### 2.3 Precompute cron + UI swap-in
- Vercel cron (Hobby: chain precompute + Supabase keep-alive ping into **one** daily invocation): national + regions + provinces + top-visited from `usage_events` → `ai_narrative_cache` keyed by `data_version`. Swap `FigureCard`/place-page narrative slots to AI content behind Suspense with template fallback; "AI at capacity" note when live-only content is unavailable.
- **Verify:** disable all providers → site fully functional with cached/template narratives and honest status note; cron run populates cache; re-ingestion (bump data_version) invalidates.

### 2.4 Chat ("Ask the data")
- Chat UI (entry on home + explore), streaming, tool-call transparency ("Looked up: training coverage, Region VII"), suggested starter questions, per-session rate limit, clear AI-generated labeling + link to methodology.
- **Verify:** 10-question script incl. comparisons, small-barangay questions (suppression respected), out-of-scope questions (declines gracefully), all-capped state (honest message, no error).

### 2.5 Admin panel
- `/admin` behind Supabase Auth + `admin_users` role: feedback inbox (read/triage/mark-done), usage dashboards (from aggregated events), changelog editor, ingestion-batch history viewer, AI quota/status panel, spotlight curation.
- **Verify:** non-admin authenticated user is denied; feedback triage round-trips; no admin route leaks to public sitemap/robots.

### 2.6 Growth groundwork
- Complementary-dataset scoping doc (`docs/DATASET_SCOPING.md`): candidate public datasets (PSA population/census for per-capita denominators, DOH facility lists (NHFR), FHSIS indicators, PhilAtlas-style references), each assessed for license/geo-join/update cadence — top candidate proposed for dataset #2 using `dim_dataset` registry. Public `/roadmap` updated to invite suggestions. Optional: document (not build) barangay-PMTiles map upgrade path and open-API design.
- **Verify:** doc reviewed with the owner; roadmap page reflects it.

---

## 9. Pitfall register

| # | Pitfall | Mitigation (owning increment) |
|---|---|---|
| P1 | **PSGC leading zeros stripped** (int-typed codes) → silent join failures with boundary files | Zero-pad to fixed-width TEXT at ingestion (0.4); all joins on padded text; unit tests |
| P2 | **Boundary vintage mismatch** (dataset has NIR ⇒ needs ≥2024-aware 2023-series PSGC boundaries) | Reconciliation script with two-way unmatched report before any map work builds on it (1.6) |
| P3 | Small-cell re-identification (sex skew makes n<5 cells routine) | Build-time suppression + roll-up, blocking unit tests (0.5); exports re-tested for suppression (1.8) |
| P4 | Supabase free tier: **2 active projects max** | Pause `koica-journey-tracker` first (0.2) |
| P5 | Supabase free project **auto-pauses after ~1 week inactivity** | Daily cron doubles as keep-alive (2.3); pre-Phase-2, note in DECISIONS.md to ping manually or add a trivial scheduled fetch |
| P6 | Vercel Hobby **cron limits** (few jobs, daily granularity) | Single chained daily job (2.3) |
| P7 | Vercel Hobby serverless **memory/time limits** vs export rendering | No headless browser; SVG→resvg pipeline; single-figure bound; Node runtime (1.8) |
| P8 | Supabase **500 MB** DB cap creep | Geometry kept out of Postgres entirely; usage_events 30-day aggregate-and-purge; narrative cache TTL (0.3/1.9/2.3) |
| P9 | PostgREST default **1,000-row** response cap surprising list queries | Server-side pagination in `lib/db`; explicit limits everywhere (1.2) |
| P10 | Serverless DB connection exhaustion | Transaction pooler (6543) only (0.3/1.2) |
| P11 | 39K barangay polygons unrenderable on free tier | City/mun ceiling for Phase 1 maps; per-region lazy files; PMTiles path deferred (1.6) |
| P12 | AI free-tier ToS drift / non-production clauses | Re-verify at 2.1; Cohere/HF excluded; limits as config; provider set swappable |
| P13 | AI hallucinated statistics on a public health site | Structural grounding + post-hoc numeric audit + adversarial tests (2.2) |
| P14 | Traffic spike exhausting AI caps | By-design degradation order (chat first, cached narratives last); honest status UI (2.3/2.4) |
| P15 | Honorarium flag/amount inconsistencies (27 rows) | Reconciliation rule + QA exception log (0.4) |
| P16 | `Others` training free-text may contain PII | Never leaves raw tables; excluded from aggregates and exports (0.4) |
| P17 | Vercel Hobby ToS (non-commercial scope) vs public traffic | Accepted: launch on Hobby, monitor, revisit (owner decision); revisit trigger noted in DECISIONS.md |
| P18 | Glossary/methodology drifting from UI reality | Build-time glossary term check (5); methodology page updated in same PR as any metric-definition change |

---

## 10. Definition of Done (Phase 1 launch checklist)

- [ ] All Phase 0 + Phase 1 increment **Verify** checklists pass; CI green.
- [ ] National figures cross-checked against parquet-computed values (5 indicators, exact match).
- [ ] No public API/page/export can return an unsuppressed individual-level cell with n<5 at barangay level (spot-audit 3 known small barangays across UI, permalinks, and all 4 export formats).
- [ ] RLS audit script passes (anon: agg/dim read-only; facts denied; feedback/usage insert-only).
- [ ] Lighthouse: a11y ≥ 95, perf budgets met on `/`, `/explore`, one `/place` page (mobile emulation).
- [ ] Every figure shows Person/Place/Time caption + layman headline + technical details + working exports.
- [ ] Methodology, glossary, data-quality, privacy, feedback, roadmap pages live and accurate; CC BY 4.0 and source attribution present in footer and every export.
- [ ] Usage events and feedback verified flowing, anonymized.
- [ ] Production deploy at `bhw-connect.vercel.app`; error pages, sitemap, OpenGraph verified.

**Phase 2 DoD (abbrev.):** AI narratives/chat pass adversarial grounding tests; zero-AI mode fully functional; quota cascade proven under forced caps; admin gated and functional; scoping doc delivered.
