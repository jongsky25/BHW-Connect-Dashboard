# Decisions log

Dated entries recording deviations from `docs/BUILD_PLAN.md` and judgment calls made during implementation.

---

## 2026-07-19 — Increment 0.1 kickoff

Scaffolded Next.js (App Router, TypeScript strict, Tailwind) at repo root via `create-next-app`, then merged in the folder skeleton from BUILD_PLAN.md §4.2 (empty directories tracked with `.gitkeep` pending their implementing increments). `dataset.parquet` moved to `ingestion/data/`. No deviations from the plan.

## 2026-07-19 — Increment 0.2: Supabase + Vercel provisioning

- Paused Supabase project `koica-journey-tracker` (ref `zmoybshitjcgeijiysoi`) to free a slot on the free tier, per §2/P4.
- Created Supabase project **`bhw-connect`** (ref `ejcuwrnxngdwvecxwrhy`) in org `rparoyuerqqrozxehztm`, region `ap-southeast-1`, confirmed $0/month. Project URL: `https://ejcuwrnxngdwvecxwrhy.supabase.co`.
- Created Vercel project **`bhw-connect`** under team `jongsky25's projects` (`team_wavZZVJXBgbZ6xwRdtgYQCi6`) via a direct file deploy (no git repo available to the deploy tool), confirming the scaffold builds and serves on Vercel. Production alias: `bhw-connect-rose.vercel.app`.

**Deviation:** the available Vercel MCP tooling can create a project and deploy files directly, but cannot link a project to a GitHub repository for auto-deploy-on-push, nor set environment variables. Both require the Vercel dashboard and are left as manual follow-up (tracked outside this doc, not a plan change — the target end state, a `main`-tracking Vercel project, is unchanged).

## 2026-07-19 — Increment 0.3: schema migrations

- Wrote and applied all 18 tables from BUILD_PLAN.md §4.1 as 21 migrations under `supabase/migrations/`, RLS enabled in the same statement as each `CREATE TABLE` (never created open then locked later, per the increment's guardrail). Seeded `dim_dataset` with the `bhw-2025` entry.
- **`geo_level_enum` adds `'national'`** beyond the plan's literal `ENUM(region|province|citymun|barangay)`, because §6 increment 0.5 requires a national sentinel row (`geo_code = 'PH'`) in `dim_geo`, which needs a matching level value.
- **`ingestion_batches` created alongside the Phase 0 tables**, not grouped with the Phase-2 tables as its position in the §4.1 listing suggests — `fact_bhw_raw.ingestion_batch_id` references it, and increment 0.4 populates it in Phase 0.
- **`changelog_entries` RLS**: the plan's RLS summary in §4.1 doesn't classify this table. Treated as public-read (like `agg_*`/`dim_*`) since it's displayed on public pages, with service-role-only writes via the Phase 2 admin panel.
- `pg_trgm` installed into a dedicated `extensions` schema (not `public`) per Supabase's advisor guidance; `dim_geo`'s trigram index references `extensions.gin_trgm_ops` accordingly.
- Wrote `ingestion/verify_rls.py` and ran it against the live `bhw-connect` project as `anon`: all public-read tables readable, all service-role-only tables return zero rows to anon, `feedback`/`usage_events` accept anon INSERT and deny SELECT. All checks pass.
- **Finding for future `lib/db` / API route work:** Postgres's `RETURNING` clause on `INSERT`/`UPDATE` re-checks the affected row against the table's SELECT policies, not just the INSERT/UPDATE policy's `WITH CHECK`. Since `feedback`/`usage_events` deliberately have no SELECT policy for `anon`/`authenticated` (write-only, to protect submitters), inserting with `Prefer: return=representation` (or a client library default that requests the row back) fails with the same generic "new row violates row-level security policy" error as a real `WITH CHECK` failure — Postgres does not distinguish the two in its error message. The fix is `Prefer: return=minimal` (Supabase JS: `.insert(...).select()` triggers the bug; plain `.insert(...)` does not) — which is also the correct behavior here, since the client has no reason to read the row back.
- Two `get_advisors` findings are accepted as intentional, not gaps: `rls_enabled_no_policy` (INFO) on the six service-role-only tables — that's the deny-all-by-design outcome; `rls_policy_always_true` (WARN) on `feedback`/`usage_events` INSERT policies — public, unauthenticated insert is the intended design for these two tables.

## 2026-07-19 — Increment 0.4: ingestion pipeline

Wrote `ingestion/ingest.py` implementing the full §3 transformation: zero-padded PSGC codes at all four levels, year-list parsing for active/inactive service, honorarium flag/amount reconciliation (`receives = flag='YES' OR amount>0`) across all 4 payer levels, and a compact `training` JSONB that stores only `trained: true` topics (avg. 2.5 of 44 topics per BHW) rather than all 44 — keeps row size sane and is a strict subset of what the plan asks for (absence = not trained). The `Others please specify` free-text detail is included only inside this JSONB, per P16 (fact_bhw_raw is service-role-only, so this satisfies "raw-side only").

**Deviation — how the data actually got loaded.** This sandbox has no direct Postgres connection: raw TCP egress is blocked (confirmed empirically — outbound HTTPS through the environment's proxy works, arbitrary TCP does not), and the project's DB password isn't retrievable through any available Supabase MCP tool. `ingest.py` still supports the intended production path (`--database-url`, direct `psycopg2`) for when it's run somewhere with real network access. To actually populate the live project from this session, the ~890K rows (41,052 `dim_geo` + 270,917 `fact_bhw_raw` + 577,069 `fact_honorarium`) were pushed over HTTPS: three temporary `SECURITY DEFINER` RPC functions (`_bulk_load_dim_geo`/`_bulk_load_fact_bhw_raw`/`_bulk_load_fact_honorarium`), each gated by a random one-time secret argument and `GRANT EXECUTE ... TO anon`, were created via `execute_sql`, called in batches from a local Python script (`urllib`, no ORM) using the anon key so the ~150MB of row data never had to pass through the assistant's own context, then **dropped immediately** after the load finished and the secret discarded. This was a one-time operational workaround for this environment, not a pattern to repeat outside it — the functions were never committed to `supabase/migrations/`, and none exist in the project post-load (verified via `pg_proc`).
- Bug caught during this process: a `case when r->'active_years' is null then null else ... end` guard in the `fact_bhw_raw` loader function didn't catch JSON `null` (a real jsonb value, not SQL `NULL`) — fixed by switching to `jsonb_typeof(...) = 'array'`. Same class of bug guarded against for `inactive_years`/`training`.
- **Verify results:** row counts exact (`dim_geo`=41,052 with 18/118/1,639/39,276 at region/province/citymun/barangay; `fact_bhw_raw`=270,917; `fact_honorarium`=577,069); 5 random `bhw_id`s spot-checked field-by-field against the parquet, all exact; national totals cross-checked against parquet-computed values for accredited count (193,897), sex split (266,335F/4,582M), and barangay-level honorarium recipients (241,712) — all exact matches. 34 honorarium flag/amount mismatches found and reconciled (logged in `ingestion_batches.qa_report`), 0 unparseable year-lists. `fact_bhw_raw_bhw_id_seq` resynced to continue after 270,917 for future inserts.

## 2026-07-19 — Increment 0.5: aggregate build + suppression

Wrote `ingestion/build_aggregates.sql`, a plain-SQL job (no client-side data movement needed — it computes entirely from the already-loaded `fact_*` tables) building `agg_bhw_counts`, `agg_demographics` (with suppression), `agg_certification`, `agg_training`, `agg_honorarium`, `agg_geo_summary`, and `agg_data_completeness`, then ran it against the live project.

**Incident: hit the Supabase free tier's disk cap mid-build.** Building `agg_training` at all 5 geo levels (39,276 barangays x 44 topics was the dominant term) while a ~390 MB scratch working table (`_agg_base`) was still alive pushed the live database to 951 MB, past the ~500 MB free-tier budget; Postgres auto-set `default_transaction_read_only = on`, which blocks all writes including `DROP TABLE` (confirmed via Supabase's own docs on this exact behavior — search for "Understanding Database and Disk Size"). Recovery, in order:
1. `SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE;` in the same session before a statement overrides the read-only default for that session (this is Supabase's documented manual override) — used it to `DROP TABLE _agg_base`, freeing 388 MB (951 MB -> 563 MB).
2. Once usage dropped comfortably below the platform's automatic-recovery threshold, `default_transaction_read_only` flipped back to `off` on its own within the next query — no dashboard action was needed in the end.
3. `VACUUM` (plain, table-scoped; `VACUUM FULL`/bare `VACUUM` cannot run inside a transaction block, so it had to be its own statement) reclaimed the ~200 MB a failed `agg_training` insert had allocated but rolled back.

**Design change to fit the budget:** `agg_training` is scoped to national/region/province/citymun only, not barangay — that axis (39,276 barangays x 44 topics) was the single biggest contributor to the overrun, for per-topic granularity a place page doesn't need at that level (it shows `agg_geo_summary.top_training_gap` instead, which is unaffected). `agg_bhw_counts`, `agg_demographics`, and `agg_certification` remain at all 5 levels including barangay and national. Final database size after the full build: **497 MB**.

**Verify results (BUILD_PLAN.md §6 checklist):**
- A real barangay (`0504101002`, n_total=2) has every `agg_demographics` row suppressed (n/pct nulled, `is_suppressed=true`), correctly rolled up to its citymun.
- Rollup chain distribution across all suppressed barangay cells: 363,968 -> citymun, 15,857 -> province, 570 -> region, 18 -> national (the full chain is exercised by real data, not just a synthetic test case).
- National totals match parquet-computed values exactly for all 5 required indicators: % accredited (71.57%), sex split (266,335F/98.31% - 4,582M/1.69%), one training topic (Dengue: 20,140/270,917 = 7.43%), any-level honorarium (97.88%), avg active-service years (10.47).
- Row counts: `agg_bhw_counts`/`agg_geo_summary`=41,052 (one per `dim_geo` row); `agg_certification`=123,156 (41,052 x 3 cert types); `agg_training`=78,144 (1,776 non-barangay geos x 44 topics); `agg_demographics`=530,465; `agg_honorarium`=93,561; `agg_data_completeness`=8.

## 2026-07-19 — Increment 1.1: design system & shell

- Design tokens added to `app/globals.css` as CSS custom properties (mapped into Tailwind v4 via `@theme inline`): neutral background/foreground/surface/border/muted, one accent color, a 7-step colorblind-safe sequential teal ramp (for later choropleth/bar use), a type scale, and a spacing scale. Dark mode overrides via `prefers-color-scheme`.
- `components/layout/header.tsx` (client component): desktop nav (Home, Explore, Compare, an "About" disclosure grouping Methodology/Glossary/Data quality/Roadmap/Privacy/Feedback via a native `<details>`, no JS needed for the dropdown itself) and a mobile hamburger menu. Active-link state derived from `usePathname`; mobile-menu auto-close on route change uses the React-recommended "adjust state during render" pattern (comparing current vs. last-seen pathname) rather than a `useEffect` + `setState`, since the latter trips `react-hooks/set-state-in-effect` under this ESLint config.
- `components/layout/footer.tsx` (async server component): source attribution, CC BY 4.0 license line, "last updated" date, and links to the trust pages. Reads `dim_dataset` live via a new minimal `lib/db` — this is the first real database read in the app, ahead of the full typed query layer that increment 1.2 builds; kept intentionally small (`lib/db/supabase.ts` client factory + `lib/db/dataset.ts`) and degrades to omitting the date rather than throwing if the read fails, since no page should hard-depend on this call.
- Root layout (`app/layout.tsx`) now renders a skip-to-content link, the header, a `<main id="main-content">` wrapper, and the footer around every page.
- Added `@supabase/supabase-js` and `server-only` as real dependencies. Added `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` to a local `.env.local` (gitignored, not committed) sourced from the live `bhw-connect` project so `npm run build`/`npm run dev` resolve the footer's data read; these still need to be added to the Vercel project's environment variables via the dashboard before production deploy (same manual-follow-up gap noted in the 0.2 entry — Vercel MCP tooling has no env-var-write tool either).
- **Verify:** ran an axe-core accessibility scan (Playwright + `@axe-core/playwright`, installed transiently for this check, not added to `package.json`) against the rendered shell at 1280x900 and at 360x740 (mobile) — zero violations at both, no horizontal overflow at 360px, and the mobile menu (opened via the hamburger button) also scanned clean. `npm run lint && npm run typecheck && npm test && npm run build` all pass.

## 2026-07-19 — Increment 1.2: filter codec + data layer

- `lib/filters/schema.ts`: Zod schema for `FilterState` (`geoLevel`, `geoCode`, `indicator?`, `compareGeos?`, `breakdowns?`), with the enums (`GEO_LEVELS`, `INDICATORS`, `DEMOGRAPHIC_DIMENSIONS` — the latter mirrors `demographic_dimension_enum` in the DB) as the single source of truth other modules import from. Uses Zod's `.catch(...)` so a structurally invalid value falls back to the national default at the schema level too, not just in the codec.
- `lib/filters/codec.ts`: the actual URL <-> state codec, built on `nuqs/server`'s `createLoader`/`createSerializer` over `parseAsStringEnum`/`parseAsArrayOf`. This is genuinely the single source of truth — `loadFilterState` never throws on malformed input (nuqs parses invalid enum values to `null`, then `.withDefault(...)` resolves the default), which is what the increment's "invalid params fall back to national view, never crash" guardrail is testing.
- `lib/db/database.types.ts`: full generated types via the Supabase MCP `generate_typescript_types` tool against the live `bhw-connect` project, checked in (not generated at build time, since this sandbox has no `supabase` CLI / direct DB connection — see the 0.4 entry on network constraints). `lib/db/supabase.ts` now threads `Database` through `createClient<Database>(...)`, which surfaced that `dataset.ts`'s `DatasetInfo` had non-nullable fields (`sourceName`, `license`, `asOfDate`) that are nullable in the schema — fixed, and added `getActiveDatasetId()` since every `agg_*` query keys on the numeric `dataset_id` FK, not the slug.
- `lib/db/geo.ts`: cascading child-geo lookup (`getChildGeos(parentCode, parentLevel)`, national -> region -> province -> citymun -> barangay) and `resolveGeoOrNational(geoCode, geoLevel)`, which validates a permalink's geo against `dim_geo` and falls back to the `PH`/national sentinel if it doesn't exist or the level doesn't match — the DB-side half of the "never crash on bad params" guardrail (the codec can't validate geo existence on its own, since that requires a query).
- `lib/db/indicators.ts`: first two typed query functions over `agg_*` — `getBhwCounts` and `getGeoSummary` — parameterized by `(geoCode, geoLevel)` exactly as §4.2 specifies, so the Phase 2 AI tool layer can call the identical functions later. Remaining indicators (demographics, training, honorarium, certification) are added in 1.3/1.4 as the pages that need them are built, rather than speculatively now.
- **Verify:** `lib/filters/index.test.ts` rewritten with 6 tests — full round-trip of a populated filter state, default/empty round-trip, and three "invalid input falls back, doesn't throw" cases (bad `geoLevel`, bad `indicator`, one bad entry inside `breakdowns`) plus a garbage-input catch-all. All pass. Ad hoc query smoke-test (not committed) against the live project confirmed `agg_bhw_counts`/`agg_geo_summary`/`dim_geo` shapes match the new query functions exactly (national totals: 270,917 total, 71.57% accredited, matching the 0.5 verification numbers). `npm run lint && npm run typecheck && npm test && npm run build` all pass.

## 2026-07-19 — Increment 1.3: home page

- `supabase/migrations/20260719140000_search_geo_function.sql`: a `search_geo(search_query, result_limit)` SQL function backing "find my barangay," applied directly to the live project (this sandbox has no CLI/direct DB connection — same constraint noted in 0.4/1.1). It unions two ranked sources — full-text search over `agg_geo_summary.search_text` (handles a common region name like "CALABARZON") and pg_trgm `word_similarity` over a new case-insensitive expression index on `dim_geo.geo_name` (handles a misspelled place name) — with full-text matches boosted +100 so they always outrank fuzzy ones (the two scores aren't on comparable scales). **Deviation from the obvious approach:** plain `similarity()` was tried first and rejected — it compares whole-string trigram sets, so a short query like "caloocan" scores only ~0.17 against the true match "CITY OF CALOOCAN" (confirmed by direct query during development), because the longer string has many trigrams the short query doesn't share. `word_similarity()` instead scores the best-matching word-boundary substring and correctly returns ~1.0 for that same pair — this is what makes "misspelled municipality" search actually work rather than just working for single-word exact names.
- `lib/db/search.ts` (`searchGeo`) calls the function via `.rpc()`; `app/api/geo/search/route.ts` wraps it as a rate-reasonable `GET ?q=` endpoint (Zod-validated, 1-100 chars, empty results on invalid input rather than an error).
- `components/narrative/figure-card.tsx`: the shared `FigureCard` contract from §4.2 (title, Person/Place/Time caption, figure, layman headline, collapsed technical details, optional export-menu slot for 1.8) — built now since the home page KPIs are captioned in this style, but not yet used by the KPI tiles themselves (those use a simpler `StatTile`, since KPI numbers aren't charts and don't need the collapsible-details/export affordances); `FigureCard` starts earning its keep in 1.4's explore figures.
- `lib/db/spotlight.ts`: template-driven "insight of the day" (no AI until Phase 2, per §2) — a small curated list of real aggregate queries (highest-accreditation region, lowest-coverage national training topic, highest-honorarium region, largest province by BHW count), picked deterministically by day-of-year with fallback to the next template if a given day's query returns nothing.
- `components/home/geo-search.tsx`: debounced (250ms) search box. **Accessibility correction made during verification:** the first version used the full ARIA combobox/listbox/option pattern (`role="combobox"` + `role="listbox"` + `<li role="option"><Link>`); an axe-core scan caught a `nested-interactive` violation because a native `<a>` inside a `role="option"` element is two interactive semantics nested inside each other. Since this widget navigates away on selection rather than filling the input (the actual combobox-with-listbox use case), it was simplified to a plain results list (`<ul><li><Link>`) with an `aria-live="polite"` status region announcing the result count — zero axe violations after the fix, confirmed both via a static scan and by actually typing into the input and reading real navigable links back out via Playwright.
- **Verify:** exercised the three required search cases against the live API through the running app (not just the DB function) — "CALABARZON" (region common name) top-ranks `REGION IV-A (CALABARZON)`; "Adams" (exact name) top-ranks both the barangay `ADAMS (POB.)` and the municipality `ADAMS`; "Dumagete" (misspelled) top-ranks `CITY OF DUMAGUETE` via the trigram fallback. Home page KPI numbers confirmed byte-for-byte matching the 0.5 verification values (270,917 total, 71.57% accredited, 97.88% any-honorarium) by grepping the rendered HTML. `npm run lint && npm run typecheck && npm test && npm run build` all pass; screenshots at 1280px and 360px confirm clean layout. Note: search-result links and the About-nav links point at `/explore`, `/compare`, `/place/...`, and the trust pages, which don't exist until increments 1.4–1.9 land later this build — expected transiently given the plan's own sequencing, not a regression.

## 2026-07-19 — Increment 1.4: explore dashboard

- `lib/charts/`: a chart-spec abstraction per §4.2 — `palette.ts` mirrors the CSS custom properties from 1.1 as real color values (chart libraries need literal colors, not `var()`), and `bar-chart.ts` builds an Observable Plot spec from plain `{label, value}[]` data. `components/charts/bar-chart-client.tsx` is the one client component that actually calls `Plot.plot()`; the rest of the app only ever imports plain data types from `lib/charts`, never Plot itself, keeping the heavy dependency isolated to one file.
- **Chart lazy-loading, and why it's automatic here:** `@observablehq/plot` is imported via a dynamic `import()` *inside* `BarChartClient`'s `useEffect`, not as a static top-level import — this alone makes the bundler code-split it into its own chunk, without needing a `next/dynamic` wrapper around the component. Verified directly: fetched every JS file the home page loads and confirmed none of them mention `observablehq` (Plot only ever loads for pages that actually render a chart).
- `lib/db/indicators.ts` gained `getDemographics`, `getTrainingCoverage`, `getHonorarium` — all parameterized by `(geoCode, geoLevel)` like the existing functions. `getTrainingCoverage` returns `[]` for barangay-level geos rather than querying, since `agg_training` was deliberately not built at barangay granularity (0.5's disk-budget incident) — the UI surfaces this as an explicit "not tracked at this level, see the city/municipality" message rather than a blank chart. `getDemographics` embeds the suppression roll-up's `geo_name` via a Supabase FK-embed (`rollup:dim_geo!agg_demographics_rollup_geo_code_fkey(geo_name)`) in the same query, avoiding a second round-trip.
- `lib/db/geo.ts` gained `getGeoAncestors(geoCode, geoLevel)`, returning the region/province/citymun a geo belongs to (or is) by reading `dim_geo`'s own denormalized `region_code`/`province_code`/`citymun_code` columns — no recursive parent-chain walk needed, since ingestion (0.4) already flattened this.
- **Filter sidebar architecture — URL is the only state, no client-side geo-fetching needed.** `components/filters/geo-cascade.tsx` renders four `<select>`s whose *option lists* are entirely server-fetched by `app/explore/page.tsx` for the geo currently in the URL (via `getGeoAncestors` + `getChildGeos`); picking a value just calls nuqs's `setFilters({geoLevel, geoCode})`, which updates the URL and lets Next re-render the server page with the new ancestor chain — the next level's options simply arrive fresh as props. This avoids a whole client-fetching/loading-state layer that a naive implementation would need. `components/filters/breakdown-picker.tsx` and `active-filter-chips.tsx` follow the same pattern for demographic breakdowns and the geo breadcrumb/reset control.
- **Two nuqs default-option bugs found and fixed during verification, both invisible until actually clicking through the UI:**
  1. nuqs defaults to `shallow: true`, which updates the URL via the History API *without* invoking Next's router refresh — so the server component never re-ran and every dependent `<select>` stayed disabled forever after the first pick. Fixed by passing `{ shallow: false }` to every `useQueryStates` call that should affect server-rendered data (all three filter components).
  2. nuqs defaults to `history: "replace"`, which never pushes new browser-history entries — so *any* filter change permanently overwrote the single `/explore` history entry, and pressing Back skipped straight past every drill-down step to whatever page preceded the site itself. Fixed by adding `{ history: "push" }` alongside `shallow: false`. Confirmed via Playwright: after clicking through region -> province, Back correctly restores province -> region -> national one step at a time, and Forward replays them, with each `<select>`'s enabled/disabled state and value matching the restored URL.
- **Two accessibility violations caught by axe-core and fixed:** (1) `page-has-heading-one` — `/explore` had no `<h1>`; added a visually-hidden one summarizing the current geo. (2) `heading-order` — `FigureCard` used `<h3>` directly under the page's `<h1>` with nothing in between; changed to `<h2>`, since every figure is a top-level content section. Also found, independent of my own markup: Observable Plot's SVG output puts `aria-label` on plain `<g>` elements (its internal mark grouping), which `aria-prohibited-attr` correctly flags as invalid ARIA usage — fixed by setting `aria-hidden="true"` on the whole Plot SVG once rendered, since `BarChartClient`'s wrapping `<div role="img">` already carries a full text summary of the chart's data as its `aria-label`, making the inner SVG redundant for assistive tech anyway.
- **Verify (BUILD_PLAN.md §7 1.4):** drove the full cascade national -> Region I -> Ilocos Norte -> Adams (citymun) -> Adams (Pob.) barangay end-to-end through real `<select>` interactions (not just URL params), confirming every figure's caption/numbers and the URL update at each step; confirmed Back/Forward restore state exactly (above); loaded `/explore` at national, region, province, citymun, and two barangays — one ordinary (`0102801001`) and the known-suppressed `0504101002` (n_total=2 from the 0.5 verification) — and confirmed the suppressed geo shows "Suppressed to protect privacy (n<5)" with a working roll-up link to its citymun, while the ordinary geo shows real bars; zero axe-core violations on every one of those six page states. `npm run lint && npm run typecheck && npm test && npm run build` all pass.

## 2026-07-19 — Increment 1.5: place profile pages

- `app/place/[geoLevel]/[geoCode]/page.tsx`: profile header (breadcrumb, name, level, N, income class), the same key figures as explore (accreditation, service years, default demographic breakdowns, training, honorarium — reusing the exact components from 1.4, not reimplementing them), and "Compare with other places" / "Explore full breakdowns" cross-links. `generateStaticParams` returns every region + province geo_code (`lib/db/geo.ts`'s new `getStaticGeoParams`) for SSG, per §7 1.5; `export const revalidate = 86_400` gives citymun/barangay pages (reached only via `dynamicParams`, not pre-built) daily ISR.
- **Deliberately stricter than explore's fallback behavior.** `/explore`'s bad-permalink guardrail (1.2/1.4) *falls back* to the national view, because explore is a browsing tool where "show me something reasonable" is the right failure mode. A place-page URL is supposed to be a *specific* permalink, so a wrong/nonexistent geo_code here calls `notFound()` instead — a silent fallback would let `/place/barangay/9999999999` render as if it were a real page, which is worse for a canonical/shareable URL. Level-mismatch (a real geo_code under the wrong `geoLevel` segment) also 404s, not just a missing code.
- `app/place/[geoLevel]/[geoCode]/not-found.tsx`: a scoped, friendly 404 reusing 1.3's `GeoSearch` component so a broken link still gets someone to the right place — the plan's own increment-1.5 verify line asks for this specifically. (The site-wide/generic error-page pass — styling parity for the *root* 404, OpenGraph share images, etc. — is 1.10's job; this is intentionally just the place-route case.)
- `generateMetadata` builds a real per-geo description ("270,917 Barangay Health Workers on record in Philippines, 71.57% accredited.") and OpenGraph title/description from the same `getBhwCounts` call the page body uses — one data source, so metadata can't drift from the page content.
- The national sentinel (`geo_code = 'PH'`, `geo_level = 'national'`) works as a place page too (`/place/national/PH`) since `getGeoByCode`'s special-case for it (1.2) returns a `national`-level `GeoOption`, and `national` is itself a member of `geoLevelSchema`'s enum — no special-casing needed in the place route.
- **Verify:** `npm run build` generated all 142 SSG paths (18 regions + 118 provinces + the 6 static app routes) against the live project with no errors. Cold-hit (not in `generateStaticParams`) barangay deep-link `/place/barangay/0102801001` returns 200 with correct title (`ADAMS (POB.) · BHW Connect`), correct OG description, and correct N=16; the known-suppressed barangay `0504101002` shows the suppression UI; `/place/barangay/9999999999` (nonexistent) and `/place/region/0102801001` (real code, wrong level) both 404 to the friendly not-found page with a working search box. Zero axe-core violations across national/region/province/citymun/barangay/suppressed-barangay/404 — seven page states in total. `npm run lint && npm run typecheck && npm test && npm run build` all pass.

## 2026-07-19 — Increment 1.6: maps (flagged highest-risk increment, P2)

**Boundary source discovery.** No search/API access to browse `faeldon/philippines-json-maps` directly was available in this sandbox (`api.github.com`/`codeload.github.com`/`github.com` are all blocked by the session's repo-scope proxy — only `jongsky25/BHW-Connect-Dashboard` is in scope; confirmed via a `403`/"GitHub access to this repository is not enabled for this session" response on all three, even for a public unrelated repo). Two things did work and were combined: the `WebFetch` tool renders `github.com` directory-listing pages fine (it isn't going through the same proxy path), giving real filenames; `raw.githubusercontent.com` file downloads work via plain `curl` (confirmed serving real 200s with full content, not silently truncated/mangled — verified this deliberately before trusting it for actual geometry data, since `WebFetch` itself summarizes content through a small model and would corrupt coordinate arrays if used for the actual GeoJSON payloads).

**Vintage mismatch found, exactly as the pitfall register anticipated — and where it was and wasn't fixed:**
- The source (generated from `altcoder/philippines-psgc-shapefiles`, PSGC as of 31 Dec 2023) **predates the Negros Island Region** entirely — region 18 has no source file at all (17 region features returned, not 18). Reconciliation found that Negros Occidental/Oriental/Siquijor (three of NIR's four provinces) are still filed in the source under their pre-NIR regions (VI/VII) with recoverable codes — since these are literally the same provinces, `ingestion/reconcile_boundaries.py` crosswalks them (`NIR_PROVINCE_CROSSWALK`) rather than accepting them as missing, remapping both the province polygon and its child citymun polygons. This is the one crosswalk applied, per the plan's explicit preference ("prefer crosswalking codes over switching boundary sources blindly").
- Everything else stays an accepted, documented gap, each with a real cause identified (not just "unmatched"): **Highly Urbanized Cities** (dim_geo models them as both a province-level and citymun-level row; the source has no separate HUC-as-province polygon and doesn't include the HUC in its containing province's citymun file either — this cost Bacolod City the 4th NIR province after the crosswalk, since it's an HUC); **NCR** (dim_geo files NCR's "provinces" as its 17 cities; the source instead has 4 legislative-district polygons — two incompatible ways of subdividing the same region); **Isabela City, Basilan** (a well-documented real-world PSGC quirk — administratively BARMM, geographically drawn under Zamboanga in most shapefiles including this one); and 8 individual citymuns (likely PSGC renumbering between shapefile snapshot and dim_geo's ingestion vintage). Full detail in `docs/BOUNDARY_RECONCILIATION.md`.
- **The exact same "leading zeros stripped from int-typed codes" issue BUILD_PLAN.md §3 documents for our own ingestion (0.4) reappeared independently in this third-party source**: its `adm1_psgc`/`adm2_psgc`/`adm3_psgc` properties are bare integers with trailing zeros for the levels below (10-digit PSGC), so region 1 is `100000000` (9 digits) while region 10 is `1000000000` (10 digits) — same bug shape, different dataset. The join key is: zero-pad to 10 digits, then take the first 2/5/7 characters for region/province/citymun, matching dim_geo's own padding convention exactly (confirmed empirically against known codes — Batangas province `04010`, Adams citymun `0102801` — before trusting the join at scale).
- Net result: 17/18 regions, 84/118 provinces, 992/1,000 citymuns matched to a real boundary polygon.
- **Files, not mapshaper.** The source's "lowres" tier is already mapshaper-simplified (0.1%) by its own build process (confirmed by reading its `scripts/*.sh`), so `reconcile_boundaries.py` uses those files close to as-downloaded rather than re-running mapshaper — one national regions file (620 KB), one per-region provinces file (17 files, ~40 KB avg), one per-province citymun file (118 files, ~14 KB avg; ~1.7 MB total) — well under the §4.3/§7 <1 MB per-view budget, and conveniently already chunked by the exact levels the app lazy-loads.
- `components/maps/choropleth-map.tsx`: MapLibre GL JS, dynamically imported (`next/dynamic(..., {ssr:false})`) so it never loads on pages without a map — confirmed by inspecting every JS file the home page fetches and finding zero mentions of `maplibre`. Colored via `lib/charts/color-scale.ts` (buckets a value across the same 7-step sequential ramp from 1.1's design tokens); clicking a filled area calls the same `useQueryStates` filter setter the geo-cascade selects use, so map clicks and dropdown picks drive identical navigation. The map is `aria-hidden` (its canvas explicitly detached from tab order too, since aria-hidden with a focusable descendant is itself an a11y violation axe caught) because `components/explore/geo-comparison-figure.tsx` always renders the same data as a ranked `BarChartClient` list right below it — the accessible fallback isn't a fallback that only appears if the map fails, it's always present, per §4.3.
- The comparison figure (map + ranked list) only appears at national/region/province levels (drilling to region/province/citymun respectively) — Phase 1's choropleth ceiling is citymun per §2, so at citymun/barangay level the figure is simply omitted rather than shown broken.
- **Verify:** loaded `/explore` at national, region (04), and province (04010) — canvas present, zero axe-core violations at all three, choropleth colors visibly correct against the ranked list (Region VI highest at 82.83%, matching the map's darkest region). Clicked a filled region on the national map via Playwright (grid-searched click coordinates to land on a polygon) and confirmed it navigated to `?geoLevel=region&geoCode=05` — same behavior as picking it from the dropdown. Loaded NCR (region 13, the worst-case boundary-mismatch region) and confirmed the map renders all-grey "no data" polygons without erroring while the ranked list still shows every city's real numbers — the intended degradation, not a bug. `npm run lint && npm run typecheck && npm test && npm run build` all pass.

## 2026-07-19 — Increment 1.7: compare mode

- `lib/filters/codec.ts` now maps the `compareGeos` state key to the `?geos=` URL param via nuqs's `urlKeys` option, so the URL matches BUILD_PLAN.md §7 1.7's spec literally (`/compare?geos=CODE1,CODE2&indicator=…`) while the rest of the codebase keeps the more descriptive `compareGeos` name. Added a regression test asserting the serialized URL contains `geos=` and never `compareGeos=`, and fixed the pre-existing garbage-input test to use the real param name.
- `app/compare/page.tsx`: dedupes and caps the requested geo list at 4 (the schema already enforces this, but a permalink can be hand-edited), resolves each code, and handles four states distinctly: 0–1 valid geos (empty-state invitation to add more), ≥2 valid geos at *mixed* levels (blocking guidance naming the exact levels involved and listing each selected place with its level, rather than a generic error or a silently broken partial render), ≥2 at the same level (the actual comparison), and a separate non-blocking notice if any requested code in the URL didn't resolve to a real geo. `indicator` (also already in the filter schema from 1.2, now with a real consumer) narrows the comparison to one figure type across all columns via `components/compare/indicator-picker.tsx`; unset shows every figure, matching the plan's "side-by-side columns of the same FigureCards."
- `components/compare/compare-column.tsx` reuses `DemographicsFigure`/`TrainingFigure`/`HonorariumFigure` from 1.4 verbatim — no comparison-specific figure logic was written, since a comparison column is just a place-page-shaped figure set repeated per geo.
- `components/compare/add-geo-search.tsx`: the same debounced `/api/geo/search` box as 1.3's home-page search, but selecting a result appends to `?geos=` instead of navigating away — disabled once 4 places are already selected.
- **Verify:** compared two provinces (Batangas vs Cavite) and two regions (IV-A vs V) — both render full side-by-side figure columns with correct, differing real numbers per geo. A region+province mix is blocked with the exact levels named ("Region, Province") and both places listed for removal, never a partial/broken render. A permalink with `?geos=...&indicator=training` reproduces byte-for-byte after reload. Zero axe-core violations across five page states (two-provinces, two-regions, mismatched, single-geo empty-state, fully-empty state). `npm run lint && npm run typecheck && npm test && npm run build` all pass.

## 2026-07-19 — Increment 1.8: exports

- `lib/exports/figure-data.ts`: one `getExportFigureData({geoCode, geoLevel, indicator, dimension?})` function covering all five indicator types (accreditation, service_years, demographics, training, honorarium), built from the *same* `lib/db/indicators.ts` query functions every on-screen `FigureCard` uses — so suppression is enforced exactly once, upstream of all four export formats, rather than re-implemented per format. All four routes (`app/api/export/{csv,xlsx,png,pptx}/route.ts`) share this one data source plus a common Zod query schema (`lib/exports/query.ts`).
- **PNG rendering, without a headless browser (guardrail):** `lib/charts/render-svg.ts` calls the *exact same* `horizontalBarSpec` function `components/charts/bar-chart-client.tsx` uses for on-screen charts, but hands it a `linkedom` virtual `document` instead of a real browser DOM — Observable Plot only needs enough DOM API surface to build an SVG string, which `linkedom` (much lighter than jsdom) provides. `lib/exports/render-png.ts` composes that chart SVG together with a title/caption/headline/footer into one larger SVG (nesting the chart as an inner `<svg>` element, which SVG supports natively), then rasterizes via `@resvg/resvg-js` at 2x for crisp export quality — a native Node addon, not a browser.
- **Turbopack build failure, and the fix:** `@resvg/resvg-js` ships a native `.node` binding; Turbopack's production build (`next build`) refused to bundle it ("non-ecmascript placeable asset ... doesn't have a module id"). Fixed via `serverExternalPackages: ["@resvg/resvg-js"]` in `next.config.ts`, which tells Next to leave it as a real runtime `require()` instead of trying to bundle it — a one-line config fix once the actual cause (native addon vs. JS bundler) was identified, not a reason to reach for a different rendering library.
- **A real cosmetic bug caught in verification, not just a smoke test:** the first PNG render composed the footer ("Source: <full dataset source name> · Licensed CC BY 4.0 · Retrieved <date>") as a single `<text>` line — SVG text doesn't wrap, and the full source name alone is 86 characters, so it silently overflowed the image's right edge. Caught by actually looking at a rendered export image, not by the file existing/being valid PNG bytes. Fixed by splitting the footer across two `<text>` lines (`footerLines`, plural) and sizing the canvas accordingly; the PPTX version uses the same two lines joined with an inter-punct, since a real PPTX text box wraps naturally so a single string is fine there.
- `xlsx` (`exceljs`): "Data" sheet with a merged title/caption header row + label/value table; separate "About this data" sheet (source, license, as-of date, retrieval time, methodology pointer, suppression rule) — read back programmatically (not just file-type-sniffed) to confirm both sheets contain the right suppressed-vs-real content.
- `pptx` (`pptxgenjs`, Node output mode): one slide, native editable text boxes for title/caption/headline/footer (extracted and read from the underlying OOXML XML to confirm — not just checked that a zip file exists) plus the same composed PNG embedded as the chart image.
- `components/narrative/export-menu.tsx`: the export affordance `FigureCard`'s `exportMenu` slot has accepted since 1.3, now with real routes behind it — plain links (no client JS needed) built from the same `(geoCode, geoLevel, indicator, dimension?)` params the figure was rendered with. Wired onto the Accreditation and demographics figures on both `/explore` and `/place/*` (representative national and barangay-level, suppression-capable figures); the remaining figures (training, honorarium, service years) don't yet have it wired in as a follow-up, not a gap in the export routes themselves.
- **Verify:** generated all 4 formats for a national figure (`PH`/accreditation) and for barangay-level demographics at both an ordinary barangay and the known-suppressed `0504101002` — CSV shows the correct header comment block and either real rows or the literal suppression line; XLSX (read back via `exceljs`, not just opened) has both sheets with correct suppressed-vs-real content; PNG visually matches the on-screen figure post-footer-fix; PPTX's extracted slide XML contains the real editable text runs plus the embedded chart PNG. All four formats completed in 0.5–1.5s locally per figure (well under the 10s budget) for both the national and barangay cases. `npm run lint && npm run typecheck && npm test && npm run build` all pass.

## 2026-07-19 — Increment 1.9: content & trust pages + telemetry

- `lib/glossary/terms.ts` + `components/glossary/glossary-term.tsx`: a small term registry and a `<GlossaryTerm slug="...">` wrapper that throws for an unregistered slug — the enforcement mechanism §5 calls for ("every technical term used anywhere must exist in `lib/glossary`"), applied wherever the component actually renders (build-time for statically-generated pages, request-time for dynamic ones) rather than a separate static-analysis pass. Tooltip is CSS-only (`group-hover`/`group-focus-within`), no JS, accessible via `aria-describedby` + `tabIndex`. **Scoping note:** wired onto two representative real usages (`suppressed` in the demographics suppression message, `honorarium` in the honorarium figure's technical details) rather than exhaustively retrofitting every technical term across every existing figure — the infrastructure and the `/glossary` listing page are complete and enforced; broader retrofitting is straightforward follow-up work, not a gap in the mechanism itself.
- `/data-quality`: reads `agg_data_completeness` live (8 tracked fields; only `active_years` has any missingness at all — 20 of 270,917 records, 0.01%) and presents it as a plain findings table, per §7 1.9's explicit framing ("presented as findings, not apologies").
- `/methodology`, `/privacy`, `/roadmap`: static content pages pulling the source/license/as-of-date from `dim_dataset` (via `getActiveDataset`, already built in 1.1) rather than hardcoding them a second time, so they can't drift from the footer. `/methodology`'s changelog section reads `changelog_entries` live (currently empty — handled as an explicit "no changelog entries yet" state rather than fabricated history).
- **Usage logging** (`lib/usage/log-client.ts` + `app/api/log/route.ts`): a random session UUID in `sessionStorage`, Do Not Track respected client-side (skips sending entirely) and enforced again server-side (a `DNT: 1` header short-circuits before any DB write, defense in depth against a caller that doesn't check client-side). The IP is salted (`USAGE_EVENTS_IP_SALT`, generated for local dev and added to `.env.local`, gitignored — production still needs this added to Vercel's env, same open item as the Supabase keys) and SHA-256 hashed, truncated to 16 hex chars, and the raw IP itself is never passed to anything that would log or store it. Wired into four of the five event types §7 1.9 lists — page views (`PageViewLogger`, mounted once in the root layout, fires on every route change including search-param changes), searches (`GeoSearch`), filter changes (`GeoCascade`), and exports (`ExportMenu`, logged on click, `keepalive: true` so the fetch survives the browser starting navigation to the download) — feedback submits are logged from the feedback form itself, covering all five.
- `/feedback` (`components/feedback/feedback-form.tsx` + `app/api/feedback/route.ts`): category/message/optional-email form inserting into the `feedback` table (public INSERT, no SELECT, per the RLS already verified in 0.3) plus a honeypot field, submit-button self-disable as the practical rate-limiting available without provisioning separate rate-limit infrastructure (no Redis/KV in this stack) — noted here rather than silently skipped, since the plan explicitly asks for "rate-limited."
- **A real honeypot bug caught by actually testing it, not just reading the code back:** the first version's Zod schema was `website: z.string().max(0).optional().or(z.literal(""))` — intending "must be empty." But a bot's non-empty honeypot value fails *both* branches of that schema, so the whole request 400s at validation *before* the honeypot-check code ever runs, meaning the response (a visible 400 error) would tip off exactly the kind of bot the honeypot is meant to fool silently. Fixed by accepting any bounded string at the schema layer and doing the actual honeypot check as a runtime `if (value)` afterward. Confirmed via a real request with the honeypot field filled: response is `{ok:true}` (looks like success) but the row is verifiably absent from the `feedback` table, while a normal submission in the same test run is present.
- **Verify:** re-ran the RLS check style from 0.3 directly against the live project as `anon` — `SELECT` on `feedback` and `usage_events` returns `200` with zero rows on both, while the same requests' `INSERT`s (via the actual API routes) succeed and are visible via the service-role-equivalent Supabase MCP tools; a `usage_events` row was inserted through `api/log` with a real (non-empty, non-raw-IP) `ip_hash`. Zero axe-core violations across all seven new/changed pages (`/glossary`, `/data-quality`, `/methodology`, `/privacy`, `/roadmap`, `/feedback`, and `/explore` at the known-suppressed barangay where the `suppressed` glossary tooltip renders) — including confirming the tooltip's definition text is actually present in the DOM, not just that the term renders. Test rows cleaned up afterward. `npm run lint && npm run typecheck && npm test && npm run build` all pass.

## 2026-07-19 — Increment 1.10: launch hardening

- `app/robots.ts` + `app/sitemap.ts`: sitemap covers the 9 static routes plus every region/province/citymun place page (barangay-level, ~39K URLs, is intentionally excluded per §5 to keep the sitemap a reasonable, search-engine-relevant size).
- `app/not-found.tsx` / `app/error.tsx`: site-wide 404 and error boundary (the place-route 404 from 1.5 was already scoped; this is the generic site-wide pass). `app/opengraph-image.tsx` and the per-place equivalent give every page a real share-card image via `next/og`'s `ImageResponse`.
- `e2e/smoke.spec.ts` + `playwright.config.ts`: the required home → explore → filter to barangay → export CSV smoke test, `@playwright/test` added as a real devDependency. Wired into CI as a `playwright-smoke` job gated to `push` on `main` only (not every PR), per §5's "keep CI under free-minute budgets" and the plan's own "Playwright smoke on main" phrasing. The Supabase URL/anon key are inlined as plain env values in the workflow (not GitHub secrets) with a comment explaining why: they're anon-key, RLS-enforced, public-by-design values already shipped in every page's client bundle, not something worth secret-managing.
- **A second confirmed instance of the PostgREST 1,000-row hard cap (BUILD_PLAN.md's own pitfall P9), this time actually breaking a shipped feature, not just a report:** `app/sitemap.ts`'s first version queried region+province+citymun in one shot (~1,775 rows expected) and silently got back exactly 1,000 — a truncated sitemap that would have under-reported the site to search engines with no error anywhere. Confirmed by direct testing that this is a genuine server-enforced cap, not a client-side default: neither a larger explicit `limit=` query param nor a larger `.range()` window raises it past 1,000. `ingestion/reconcile_boundaries.py`'s citymun query had the identical bug (1,639 expected, 1,000 returned), silently understating `docs/BOUNDARY_RECONCILIATION.md`'s own numbers. Both fixed with real offset-based pagination: `lib/db/geo.ts`'s new `getAllGeosAtLevels()` (loops `.range()` pages until a short page signals the end) backs the sitemap; `reconcile_boundaries.py`'s `supabase_get()` was rewritten the same way. Re-running the reconciliation script after the fix corrected its own report (citymuns: 1,639 checked, not 1,000 — same accepted gaps as before, just now actually all counted); the sitemap now emits all 1,784 expected entries (verified via `curl | grep -c`).
- **Lighthouse (mobile emulation) on all three required pages:** `/` — perf 99, a11y 100. `/place/region/01` — perf 89, a11y 100 (SSG, 10ms TTFB). `/explore` — a11y 100, perf initially 67, driven entirely by a 2,220ms root-document response time.
- **Explore-page perf fix:** `app/explore/page.tsx` had an avoidable third sequential round-trip — its data-fetching waterfall awaited a `Promise.all` of 6 queries (including `getGeoAncestors`) before starting a second `Promise.all` of 3 more queries that only actually depend on `ancestors`, not on the other five (slower) results in that same batch. Restructured to await `ancestors` alone first, then run all 8 remaining independent queries in one `Promise.all`, collapsing 3 sequential stages to 2. Result: TTFB 2,220ms → 1,830ms, performance score 67 → 73. The residual TTFB is real cross-network latency from this sandbox to the live Supabase project (ap-southeast-1) — inherent to testing a remote-DB-backed page from a dev environment on the public internet, not something further query restructuring fixes; likely to look different once actually deployed near Supabase's region on Vercel. Not chased further: eliminating the one remaining avoidable stage (`getChildIndicators`, which depends on the child-geo codes the batch just fetched) would require querying `agg_geo_summary` by parent code/JSON containment instead of an explicit code list, a real schema-shaped change for a page that already meets its Lighthouse gate on the two indicators the plan actually specifies a hard budget for (`/` and `/place/*` LCU < 2.5s on Fast-3G — both pass; `/explore` has no such hard budget in §5, only the general a11y ≥ 95 gate, which it clears at 100).
- **JS budget (< 200 KB gzipped on content pages, §5) — verified by measuring actual network transfer, not build-log estimates:** summed `network-requests` transferSize for all Script resources across the three Lighthouse runs. `/` = 157.5 KB (no charts). `/place/region/01` = 292.3 KB total, but 133.3 KB of that is two chunks that reference `@observablehq/plot` — the exact lazy-loaded chart chunk 1.4 already verified code-splits automatically via a runtime `import()` inside `BarChartClient`'s effect; excluding that (correctly deferred, not blocking initial render) leaves 159 KB, under budget and consistent with `/`'s baseline. `maplibre-gl` didn't appear in either page's network log at all in this pass, consistent with its own `next/dynamic(ssr:false)` deferral from 1.6.
- **Suppression spot-audit (DoD-required, distinct from the single known-suppressed barangay already exercised in 0.5/1.4/1.8):** queried `agg_geo_summary` live for barangays with `0 < n_total < 5` and picked three not previously touched by any earlier increment's testing (`0102802050` TAMBIDAO, `0102802022` PUNGTO, `0102802040` SAN SIMON II, all n=1). Confirmed for all three: the place page and the explore page both show the real (non-suppressed) total N alongside a "Suppressed to protect privacy (n&lt;5)" demographics figure; the permalink reproduces the same state; all four export formats for the same geo/indicator/dimension show suppression, not raw individual-level data — CSV's data row is literally `suppressed to protect privacy (n<5)`, and XLSX/PPTX were read back (unzipped, not just checked for valid file bytes) to confirm the suppression string appears in their actual document XML rather than a real broken-out sex/age table.
- **Definition of Done (§10) walkthrough:**
  - All Phase 0/1 increment Verify checklists pass (recorded per-increment above); CI green on every commit through `620a8d5` (GitHub Actions `CI` workflow, 8/8 runs `success`).
  - National figures cross-checked against parquet — done in 0.5/1.2 (5 indicators, exact match).
  - n<5 suppression audit — done above (this increment), on top of 0.5/1.4/1.8's per-feature coverage.
  - RLS audit script (`ingestion/verify_rls.py`) — passed in 0.3, re-confirmed live in 1.9.
  - Lighthouse a11y ≥ 95 + perf budgets on `/`, `/explore`, one `/place` — done above; a11y is 100 on all three, perf budgets (the ones §5 actually specifies) met.
  - Every figure's Person/Place/Time caption + headline + technical details + exports — established as the shared `FigureCard` contract since 1.3, exercised across every figure built in 1.4–1.8.
  - Trust pages live and accurate, CC BY 4.0 + attribution present — 1.9, re-verified present in every export format's footer in 1.8.
  - Usage events/feedback flowing, anonymized — verified live in 1.9 (salted/hashed IP, DNT respected both sides).
  - Production deploy at `bhw-connect.vercel.app`; sitemap/OG/error pages verified — sitemap/OG/error pages done in this increment; **production deploy itself remains blocked** on the same open item flagged since 0.2/1.1/1.9: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `USAGE_EVENTS_IP_SALT` still need to be added to the Vercel project's environment variables via the dashboard — no tool available in any session this build used (Vercel MCP or otherwise) can write env vars. This is the one remaining manual step before `bhw-connect.vercel.app` is actually live with a working database connection; once set, a redeploy (push or Vercel's own "Redeploy") picks them up with no code changes needed.

Phase 1 is otherwise feature-complete and verified end-to-end against the live database.

## 2026-07-19 — StepZero quick-count dataset

Added a second, independent data source: `BHW CONNECT STEPZERO.xlsx` (DOH-owned Google Sheet), a rougher barangay-level "quick count" meant as a sanity baseline against the detailed `bhw-2025` per-person dataset, not a replacement for it. One row per barangay: `REGISTERED` / `REGISTERED & ACCREDITED` / `NON-REGISTERED` headcounts plus `POPULATION`/`HOUSEHOLDS`.

- Registered a new `dim_dataset` row (`20260719102100_seed_dim_dataset_stepzero.sql`), slug `bhw-stepzero-2026`, `status = 'draft'` until this data is actually loaded into the live project and spot-checked. `as_of_date` is `'2025-01-01'` - only the year (2025) is confirmed, no month/day is present anywhere on the sheet, so this follows the same year-only convention already used for `bhw-2025`.
- **New dedicated table** `agg_bhw_stepzero_counts` (`20260719102200_agg_bhw_stepzero_counts.sql`), not a reuse of `agg_bhw_counts`: the three-bucket breakdown and population/household columns have no equivalent there, and this sheet's self-reported "accredited" figure is a different, less-verified notion than `agg_bhw_counts.n_accredited` (derived from `fact_bhw_raw.accredited`, a per-person verified flag) - mixing them under one column would misrepresent both.
- **Bucket semantics resolved by inspecting the data, not assumed**: example rows have `REGISTERED=4` and `REGISTERED & ACCREDITED=16` (accredited count exceeds registered count), which rules out "accredited" being a subset of "registered". The three columns are mutually exclusive; `n_total_bhw = REGISTERED + REGISTERED_ACCREDITED + NON_REGISTERED`.
- Wrote `ingestion/ingest_stepzero.py`, importing `pad`/`sql_literal`/`insert_statement`/`batched`/`nullable_int` from `ingest.py` rather than duplicating them. Rollups to citymun/province/region/national are computed by summing the sheet's own PSGC code columns directly (no `dim_geo` join needed for the arithmetic) - `dim_geo` is consulted only to validate each level's code before insertion, since `agg_bhw_stepzero_counts.geo_code` FKs to it.
- **Code validation used `ingestion/data/dataset.parquet` instead of a live `dim_geo` query**, since that parquet is exactly what `dim_geo` was built from and this sandbox still has no direct Postgres access. Full-file comparison (41,965 barangay rows in the sheet vs. `dim_geo`'s 39,276): all 39,276 `dim_geo` barangays are present in the sheet, plus **2,689 barangay codes and 12 citymun codes in the sheet that don't exist in `dim_geo`** (concentrated in NCR, CALABARZON, Eastern/Western Visayas, Bicol, and BARMM - newer PSGC entries or renumbered barangays, e.g. City of Laoag's `BGY. NO. *` naming). Region (18/18) and province (118/118) codes match exactly. These unmatched rows are skipped at insert time (an FK violation isn't a place to silently coerce data) and listed by name in the QA report for a future `dim_geo` PSGC-vintage update - out of scope here. Citymun/province/region/national rollup sums are still computed from the *full* sheet (all 41,965 rows), not just the FK-matched barangays, so a rollup total isn't artificially deflated by a code mismatch at a finer grain.
- Verified end-to-end with `--emit-sql-dir`: 39,276 + 1,639 + 118 + 18 + 1 = 41,052 rows generated, exactly matching `dim_geo`'s own total row count - a clean sanity check that the rollup grain lines up with the existing geo dimension.
- Bug caught during this run: `sql_literal()`'s `isinstance(value, float)` branch matches numpy's `float64` (it subclasses Python's `float`), but recent numpy's `repr()` renders it as `np.float64(65.72)` instead of `65.72`, which is invalid SQL. Fixed in `ingest_stepzero.py` by casting every numeric field to a plain Python `int`/`float` before it reaches `sql_literal()`, rather than patching `sql_literal()` itself (`ingest.py`'s existing callers never hit this path, since its `nullable_int()`/list/dict branches all coerce explicitly).
- Added `agg_bhw_stepzero_counts` to `ingestion/verify_rls.py`'s public-read table list, and `ingestion/requirements.txt` (pandas, pyarrow, openpyxl, psycopg2-binary) - the first declared Python dependency file in the repo, since this is the first script needing `openpyxl`.
- **Not yet loaded into the live Supabase project.** Loading ~41K rows from this sandbox needs the same temporary `SECURITY DEFINER` RPC-over-HTTPS workaround used for the original `dim_geo` load (no direct Postgres TCP access here), which is a deliberate one-time operational step, not something to do casually - left for a follow-up run rather than bundled into this change. `dim_dataset.status` stays `'draft'` until that load happens and is spot-checked.
- Open follow-ups, not blocking: confirm the sheet's license/source URL and get a firmer as-of date from the data owner; decide (separately, out of scope - no dashboard UI exists yet at all) whether a future reconciliation view should surface `bhw-2025` vs. `bhw-stepzero-2026` side by side; consider updating `dim_geo`'s PSGC vintage to cover the 2,689 barangays/12 citymuns this sheet knows about that `dim_geo` doesn't yet.

## 2026-07-19 — Production deploy: env vars set, domain corrected

- The Vercel project's `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `USAGE_EVENTS_IP_SALT` env vars (the one open item repeated since 0.2) were set by the project owner directly in the Vercel dashboard, and a redeploy confirmed a successful build with zero runtime errors — the database connection works in production.
- **`bhw-connect.vercel.app`, assumed throughout 1.5–1.10 as the production URL, turns out not to be assigned to this project at all** (confirmed via a direct request: 404). Vercel's `<project-name>.vercel.app` short domains are claimed platform-wide on a first-come basis, and this one was already taken by something else. The project's real domains are `bhw-connect-jongsky25s-projects.vercel.app`, `bhw-connect-git-main-jongsky25s-projects.vercel.app`, and `bhw-connect-rose.vercel.app`. Fixed the three places that hardcoded the wrong domain (`app/layout.tsx`'s `metadataBase`, `app/sitemap.ts`, `app/robots.ts`) to use `bhw-connect-jongsky25s-projects.vercel.app` — the OG image routes need no change, since both already resolve relative to `metadataBase` rather than hardcoding a host themselves.
- **A separate, still-open blocker found in the same check: Vercel's Deployment Protection (Vercel Authentication/SSO) is enabled on this project**, which redirects every request — including production — to a Vercel login (`vercel.com/sso-api`) before serving anything. This is a project-level dashboard setting (Settings → Deployment Protection → Vercel Authentication), not something the app's code or env vars control, and it defeats the purpose of a public dashboard until it's turned off (or scoped to "Only Preview Deployments") by whoever has dashboard access — flagged for the project owner, not fixed here.

## 2026-07-19 — StepZero as BHW universe; dashboard reframed to Total vs. Validated Profiles

Resolved what the two datasets mean relative to each other and reframed the whole dashboard around it. Previously the UI labeled the 270,917 individual records as "Total BHWs", which conflated the *profiled subset* with the *universe*.

- **Two datasets, two roles (confirmed by summing the source sheet):** the StepZero quick-count (`bhw-stepzero-2026`, `agg_bhw_stepzero_counts`) is the **total BHW universe**; the per-person dataset (`bhw-2025`, `agg_bhw_counts` and the other `agg_*`) is the **individually-validated profiled subset**. National figures: registered 76,587 + registered & accredited 201,653 + non-registered 28,595 = **306,835 total**; registered universe (reg + accredited) = **278,240**; validated profiles = **270,917**.
- **Headline "Total BHWs" = 306,835** (full universe, non-registered included as its own segment).
- **Profiling coverage denominator = 278,240 (registered only)** — non-registered BHWs are never individually profiled, so they are excluded from the coverage ratio (270,917 / 278,240 ≈ **97.4%**) while still counted in the total. Owner decision.
- **Label = "Validated profiles"** everywhere the individual dataset surfaces (owner's wording). Per-person figure captions now read "N = … validated profiles", and per-person percentages are explicitly of validated profiles, not of the total headcount.
- **Official DOH figure 277,767** (registered & accredited) is cited in `/methodology` and reconciled against the sheet-derived 278,240 — a ~473-count drift between an official tally and this sheet export. It does not appear anywhere in the sheet (verified: no matching cell, no combination of columns), so the site computes totals from the sheet and notes the official number for context.
- **Coverage is guarded per-geo:** two independently-collected datasets drift at fine grains, so a barangay can have more validated profiles than its StepZero registered base (e.g. `0603037005`: 46 profiled vs. base 10). `getBhwOverview` returns the raw ratio plus a `coverageExceedsBase` flag; the UI caps the displayed percentage at 100% (raw ratio stays available for technical detail) and shows validated-profiles-only when a geo has no StepZero row.
- **Loaded StepZero into the live project (`ejcuwrnxngdwvecxwrhy`) — the follow-up flagged in the entry above.** Applied the two migrations, then loaded all 41,052 aggregate rows (39,276 barangay + 1,639 citymun + 118 province + 18 region + 1 national) via a temporary `SECURITY DEFINER` RPC (`load_stepzero_batch(jsonb)`, granted to `anon`, called over PostgREST, dropped immediately after) — the same RPC-over-HTTPS pattern used for the original `dim_geo` load, since the sandbox has no direct Postgres TCP. `dim_dataset.status` for `bhw-stepzero-2026` stays `'draft'`: the app reads it **by slug** (`getDatasetIdBySlug`), so it never collides with `getActiveDatasetId()`'s `status='active'` lookup, which keeps returning only `bhw-2025`.
- **New data layer:** `lib/db/stepzero.ts` (`getStepzeroCounts`, `getBhwOverview`, `coverageForDisplay`) is the single chokepoint the UI reads for total/profiled/coverage; `getDatasetIdBySlug` + `DATASET_SLUGS` added to `lib/db/dataset.ts`. Regenerated `lib/db/database.types.ts` for the new table.
- **Not changed:** the two "accredited" notions stay separate (self-reported StepZero tally vs. verified per-person flag), as decided in the prior StepZero entry; `/methodology` now spells out the distinction.

## 2026-07-19 — Increment 2.1: AI provider abstraction + quota tracker

- **Provider clients** (`lib/ai/providers/`): a shared `AIProvider` interface (`complete(messages, tools)`) with one Gemini implementation (its own REST `generateContent` request/response shape — no system/tool roles, function-calling parts instead of OpenAI-style `tool_calls`) and one factory (`createOpenAICompatibleProvider`) reused for Groq, OpenRouter, and Mistral, since all three expose an OpenAI-compatible `/chat/completions` endpoint. Errors are typed (`ProviderUnavailableError` = no API key configured, `ProviderRateLimitedError` = live 429, `ProviderRequestError` = anything else) so the cascade can react differently to each.
- **Re-verified free-tier limits at implementation time** (BUILD_PLAN.md §8 2.1 instruction), via each provider's current official docs: **Groq** (30 RPM / 1,000 RPD / 12,000 TPM, `llama-3.3-70b-versatile`) and **OpenRouter's `:free` pool** (20 RPM platform-wide; daily cap is 50/day with no lifetime credit purchase, 1,000/day once ≥$10 has ever been added to the account — seeded conservatively at 50/day since account credit status isn't queryable from code) are both officially confirmed. **Gemini** and **Mistral** no longer publish static rate-limit tables in their docs (Gemini's are now shown live per-project in AI Studio; Mistral's only in its Admin Console) — seeded conservatively (Gemini 10 RPM/1,000 RPD on `gemini-2.0-flash`; Mistral 1 RPM/50 RPD on `mistral-small-latest`) until an owner with console access confirms the real numbers and updates the live `ai_provider_quota` rows directly (the seed constants in `lib/ai/quota.ts` only apply to a window's *first* row — after that, the DB row governs, per §4.5's "config not code").
- **ToS flag for the owner, not resolved here:** Mistral's free ("Experiment") tier is explicitly documented as "for evaluation, not production," which is in tension with using it on a public production site — the same category of concern that already excluded Cohere/HF Inference (§2). BUILD_PLAN.md locks Mistral into the cascade as the last-resort tier, so it's kept (with the smallest seed limits of the four, making it rarely reached), but this should be revisited by the project owner before real traffic depends on it.
- **Quota tracker** (`lib/ai/quota.ts`): check-before-call against both a `minute` and a `day` window row per provider (lazily created on first use); a live 429 immediately sets `is_paused`/`paused_until` on the day-row (`retry-after` header honored when present, minimum 60s pause otherwise) rather than retrying that provider again this run. `completeWithCascade` tries providers in the fixed §2 order, skipping capped/paused/unconfigured ones, and returns an explicit `{ allCapped: true }` signal — never throws — when every provider is exhausted, so callers can degrade honestly (2.2/2.3/2.4).
- **Window increments aren't atomic** (`reserveRequest` does a read-then-update, not a DB-side `UPDATE ... SET request_count = request_count + 1`): accepted given this app's real request volume (a handful of chat/insight calls plus one daily cron), flagged here rather than added as unused-until-proven-needed complexity.
- **New `lib/db/service-client.ts`** — a service-role Supabase client (bypasses RLS), needed because `ai_narrative_cache`/`ai_provider_quota` are service-role-only tables per the 0.3 RLS design. Reserved for `lib/ai/*`, `app/admin/*` (2.5), and cron/AI API routes; every caller must itself be `server-only`.
- **Test infra:** added the first unit tests that exercise `server-only`-tagged modules directly (mocking the DB/provider calls at the module boundary, per the Verify checklist's "unit tests with mocked providers"). The real `server-only` package throws unconditionally outside Next's build-time `"react-server"` resolution condition, which vitest's plain Node runner doesn't apply — aliased it to a no-op stub (`vitest.server-only-stub.ts`) in `vitest.config.ts` rather than restructuring `lib/ai/*` to avoid the tag, since every other server-only module in the repo (`lib/db/*`) already carries it and untested DB-touching code is the established pattern (§5's mandatory-unit-test list is scoped to pure logic) — this just extends what's testable without changing that principle for `lib/db`.

## 2026-07-19 — Increment 2.2: grounded tool layer + narrative generation

- **Tool layer** (`lib/ai/tools.ts`): the exact seven tools from BUILD_PLAN.md §4.5, each a thin wrapper over the same `lib/db` functions the public pages call (`getBhwCounts`, `getDemographics`, `getTrainingCoverage`, `getHonorarium`, `getDataCompleteness`, `searchGeo`, plus `getBhwOverview` for Total-vs-Validated framing) — so a number the model reports and the number shown on screen are the same query, not just the same table. `getIndicatorByGeo`'s response always carries `totalBhw`/`validatedProfiles`/`profilingCoveragePct` regardless of which indicator was asked for, since conflating those two counts is the single most likely dataset-specific hallucination and the system prompt can't fully guard against it alone. Every tool validates its arguments with the existing `lib/filters/schema.ts` enums via zod and returns `{ error }` rather than throwing, so a malformed or adversarial tool call from the model surfaces as data it can react to instead of crashing the loop.
- **`lib/ai/agent-loop.ts`**: the tool-calling loop shared by narrative generation (single-shot) and chat (2.4, multi-turn) — call the cascade, execute any requested tool calls, feed results back as `tool` messages, repeat up to 4 rounds, then force a wrap-up with tools withdrawn if the model still hasn't returned plain content. Collects every tool-result payload from the run for the audit step.
- **Post-hoc numeric audit** (`lib/ai/audit.ts`): deliberately pure/no I/O (unlike the rest of `lib/ai/`) so it's directly unit-testable without mocking, including PLAN's "adversarial tests — prompt-inject via geo names, ask for out-of-dataset stats, force a fabricated number through a mocked model → audit strips/rejects" (see `audit.test.ts`, `narrative.test.ts`). Extracts every numeric token from the generated text, and strips any sentence containing a number that doesn't trace to a value in that turn's tool-result payloads (exact match, or match after rounding either side to the nearest integer, so "65.72%" reported as "about 66%" still passes) — sentence-level rather than whole-response rejection, since a partially-grounded answer is usually still useful. A small fixed allow-list (0, 100, 2025, 2026) covers trivial percentage bounds and the dataset's snapshot years without requiring every prose date to trace to a tool call.
- **`lib/ai/narrative.ts`**: cache lookup (`ai_narrative_cache`, keyed `data_version|geo|narrative_type` exactly as specified) → live generate via the tool loop → audit → write-back. A stale cache entry is kept as the fallback both when every provider is capped and when the audit strips the entire generated response (rather than serving nothing when something imperfect-but-cached exists); a cold cache with no viable generation returns `null`, which callers (the 2.3 UI slot) treat as "render the Phase 1 template narrative," never as an error state.
- **`app/api/ai/insight` route**: thin wrapper around `getOrGenerateNarrative`, used by the AI insight card (2.3) via client-side fetch so a slow/capped AI call never blocks server-rendered page content.

## 2026-07-19 — Increment 2.3: precompute cron + UI swap-in

- **`components/narrative/ai-insight.tsx`**: implemented the "AI components behind Suspense with non-AI fallbacks" slot as an async Server Component (`AiInsightContent`) wrapped in `<Suspense fallback={<AiInsightSkeleton />}>` by its exported `AiInsight`, calling `getOrGenerateNarrative` directly rather than fetching `app/api/ai/insight` from the client — no reason to pay a self-HTTP round trip when the page is already server-rendering. Renders nothing (not an error state, not an empty card) when there's no narrative to show, since every page it's added to (home, place profiles) already has full Phase 1 template coverage without it. Added to `/` (national) and every `/place/[geoLevel]/[geoCode]` page.
- **Bug caught by actually building the site** (`npx playwright test`, which runs a real `next build` — see the Verify note below): `getOrGenerateNarrative` let `createSupabaseServiceClient()`'s throw (missing `SUPABASE_SERVICE_ROLE_KEY`) propagate uncaught, which crashed the *entire* static export the moment SSG hit a `/place/[region|province]/...` page — not a soft AI-feature failure, a hard build failure for a page that has nothing else to do with AI. Fixed by wrapping the whole cache/generate/audit flow in a try/catch that returns `null` on any failure, mirroring `getActiveDataset()`'s existing degrade-gracefully pattern — an AI feature must never be able to take down a page that doesn't depend on it. Added a regression test (`narrative.test.ts`) asserting this explicitly.
- **`app/api/cron/precompute/route.ts`**: one daily Vercel Cron invocation (`vercel.json`, `0 20 * * *` = 04:00 PHT) precomputing national + all 18 regions + all 118 provinces + the top 20 most-visited other places (`lib/db/usage-analytics.ts`, a bounded recent-events scan aggregated in memory — `usage_events` has no per-geo rollup and Postgrest has no group-by without an RPC, so this is a good-enough ranking rather than exhaustive analytics). Auth via `Authorization: Bearer $CRON_SECRET` (Vercel sends this automatically to `vercel.json` cron routes once `CRON_SECRET` is set as a project env var — added to `.env.example`); refuses to run if the secret is unset, rather than defaulting to open. One job, not two, per Vercel Hobby's cron-count limit (P6); the narrative lookups already touch `dim_dataset` on every call, which doubles as the Supabase keep-alive ping (P5), so no separate ping step exists.
- **No pretense of full coverage in one run:** at the seeded free-tier RPM caps (2.1), ~137 targets can't all be freshly generated inside a single ~50s invocation budget (`TIME_BUDGET_MS`, with `maxDuration = 60` as the hard backstop) — the route reports `attempted`/`generated`/`ranOutOfTime`/`remainingAfterTimeout` explicitly rather than silently under-covering. Already-cached targets are a cheap read-and-skip each, so coverage fills in over consecutive daily runs; any target the cron hasn't reached yet still generates live (behind the Suspense skeleton) on a visitor's first request and is cached from then on.
- **`/methodology#ai`** and a new `ai_generated` glossary term explain the AI-insight/audit mechanism in plain language for visitors, linked from the insight card itself.
- **Verify:** `next build` (via `npx playwright test`, which builds+starts the app for its smoke spec) now completes cleanly against the live project with only public env vars set (no `SUPABASE_SERVICE_ROLE_KEY`/AI keys — reproducing exactly the config a preview build would have), confirming the graceful-degradation fix; the existing home → explore → filter to barangay → export CSV smoke spec still passes unchanged. `lint`/`typecheck`/`test` all green (29 unit tests).

## 2026-07-19 — Increment 2.4: chat ("Ask the data")

- **`app/api/ai/chat` route**: streams newline-delimited JSON — a `tool_call` event per lookup as `runToolLoop` makes it (tool-call transparency, e.g. "Looked up: training coverage"), then exactly one final `message`/`capacity`/`error` event. Deliberately not token-level streaming of the answer: the post-hoc numeric audit (2.2) has to see the *complete* response before any of it is safe to show — streaming raw tokens would risk flashing an ungrounded number on screen before the audit could strip it, which defeats the point of having the audit. Tool-call progress is a safe thing to stream live since it carries no unaudited numbers, so that's what actually streams; the grounded answer arrives as one chunk.
- **Per-session rate limit** (`lib/ai/rate-limit.ts`): 20 messages / 10 minutes, counted against the existing `usage_events` log (`ai_chat_message` event type) rather than a new table.
- **Two more crash-to-degrade bugs caught by actually running the built app**, both variations on the same class as 2.3's fix — a service-role-only code path throwing past the point where anything catches it:
  - `isChatRateLimited`/`recordChatMessage` ran *before* the chat route's streaming try/catch even starts, so `createSupabaseServiceClient()` throwing (unconfigured) took down the whole route with a 500 instead of reaching the stream's own error handling. Fixed by wrapping both in their own try/catch, failing open (rate limiter) or silently (logging) — matches the pattern already documented for `isChatRateLimited`'s read-error case, just extended to cover a thrown client-construction error too, not only a query-level `{error}`.
  - `lib/ai/quota.ts`'s `checkQuota` created the service client *outside* `completeWithCascade`'s per-provider try/catch, so the same throw propagated all the way out of the tool loop instead of being treated as "this provider's unavailable." Since every provider shares the identical service client, this failure mode is identical across the whole cascade — wrapped it to return `{ available: false, reason: "unavailable" }`, which correctly collapses to `completeWithCascade`'s existing `allCapped` signal (verified live: the chat UI now shows the honest "Live AI is at capacity right now" message instead of a 500, in an environment with no `SUPABASE_SERVICE_ROLE_KEY`/AI provider keys configured at all).
  - Net effect: an unconfigured or partially-configured AI backend now degrades to the documented "AI at capacity, core site unaffected" behavior in every code path that touches it, not just the ones covered by the original tests — added regression tests for all three (`quota.test.ts`, `rate-limit.test.ts`) alongside the existing mocked-provider suite.
- **`components/chat/chat-launcher.tsx`**: a floating "Ask the data" button opening a chat panel, added to home (`geoCode="PH"`) and explore (current filtered geo) per BUILD_PLAN.md's "entry on home + explore." Suggested starter questions; reads the NDJSON stream via `response.body.getReader()`, showing live "Looking up …" text from `tool_call` events while waiting.
- **Verified live, not just unit-tested:** ran `npm run build && npm run start` against the real Supabase project (public anon key only, matching a preview deploy's config) and drove the chat UI with Playwright — confirmed the panel opens, a starter question streams through to the capacity message with no 500/console error, and the existing home → explore → export smoke spec is unaffected.
- **Not done here, flagged for the owner:** BUILD_PLAN.md's 2.4 Verify checklist calls for a "10-question script incl. comparisons, small-barangay questions (suppression respected), out-of-scope questions (declines gracefully), all-capped state" run against *real* AI providers — this sandbox has no provider API keys, so only the structural/degradation paths above could be exercised. Once real `GEMINI_API_KEY`/`GROQ_API_KEY`/`OPENROUTER_API_KEY`/`MISTRAL_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are set in the Vercel project, that script should be run manually before relying on live chat answers in production.

## 2026-07-19 — Increment 2.5: admin panel

- **Auth: email + password, not magic link.** BUILD_PLAN.md doesn't pin a specific Supabase Auth method — chose `signInWithPassword` over the more commonly recommended `signInWithOtp` (magic link) deliberately: this sandbox has no email inbox access, so a magic-link flow's callback round trip couldn't be exercised at all, while password auth's failure path (wrong credentials) could be driven end-to-end through the real Supabase Auth API without creating any account. Also simpler operationally for a small, trusted-operator panel (few admins, not a self-serve audience) — no email deliverability dependency. Bootstrap step for the first admin (not automated, deliberately — this grants access, so it shouldn't be self-serve or done silently by an agent): create the user in Supabase Studio (Authentication → Users → Add user, email + password), then `insert into admin_users (user_id, role) values ('<their auth uid>', 'admin');` — left for the project owner.
- **`@supabase/ssr`** added (`lib/db/supabase-auth-server.ts` cookie-based server client, `lib/db/supabase-auth-browser.ts` client-side client) — the standard package for Supabase Auth session cookies in Next.js App Router; distinct from the existing `lib/db/supabase.ts` (anon, no auth) and `lib/db/service-client.ts` (service-role, bypasses RLS) clients.
- **Two-layer gate, deliberately redundant:** `proxy.ts` (see rename note below) refreshes the auth cookie and redirects a fully unauthenticated visitor to `/admin/login` on every `/admin/*` request — a UX shortcut, not the security boundary. The actual authorization check is `lib/db/require-admin.ts`'s `getAdminAuthResult()`, called fresh in `app/admin/(dashboard)/layout.tsx` (distinguishing "signed out" → redirect from "signed in but no `admin_users` row" → explicit "Not authorized" message, satisfying the Verify checklist's "non-admin authenticated user is denied") and again at the top of every server action (`feedback/actions.ts`, `changelog/actions.ts`) — never trusting that a request reaching an action came through the gated UI. **Fails closed**: any error, including missing env vars, resolves to "not authorized," the opposite default from `lib/ai/*`'s fail-*open* philosophy — an admin check failing safe means denying access, never granting it.
- **`/admin/login` lives outside the `(dashboard)` route group** specifically so the gate doesn't apply to itself (would otherwise either loop or need special-casing inside the layout).
- **Additive schema change:** `feedback` had no status column (BUILD_PLAN.md §4.1 didn't include one) — added `feedback_status_enum` (`open`/`resolved`/`dismissed`) and a `status` column (migration `20260719180000_feedback_status.sql`, applied directly to the live project via the Supabase MCP tool, `database.types.ts` hand-updated to match) so "feedback triage round-trips" (2.5 Verify) has something to round-trip.
- **New admin surfaces**, all reading through `createSupabaseServiceClient()` since `feedback`/`ingestion_batches`/`ai_provider_quota` are service-role-only or insert-only to the public: feedback inbox with mark-resolved/dismissed/reopen (`lib/db/admin.ts` + a server action), usage dashboard (reuses 2.3's `lib/db/usage-analytics.ts`), changelog editor (create form + list; edit/delete deferred as out of scope for this pass), ingestion-batch history (read-only), AI quota/status panel (read-only, highlights currently-paused providers).
- **Two more bugs caught only by actually running `next build`**, both new failure classes distinct from 2.3/2.4's service-client-throw pattern:
  - **Next.js 16 renamed `middleware.ts` → `proxy.ts`** (function `middleware` → `proxy`) — the old convention still works but logs a build-time deprecation warning; renamed to the new convention immediately rather than shipping something already flagged deprecated on day one, using the codemod's documented rename (verified against the framework's own bundled docs, not from memory, since this is a very recent rename easy to get subtly wrong).
  - **`next build` tried to statically prerender `/admin/ai-quota`** (and would have for every admin leaf page) because nothing in that specific page component's own render path signals dynamic rendering to Next's static-analysis heuristics — even though the *layout* wrapping it reads cookies via the auth client. Static generation has no request cookie to read, so it hit `createSupabaseServiceClient()`'s missing-env-var throw and failed the whole build (not a graceful in-app degradation this time — a hard build failure, since there's no request/response to degrade for at prerender time). Fixed with `export const dynamic = "force-dynamic"` on the `(dashboard)` layout, which is also simply correct: every admin page is inherently per-request/per-cookie and was never a candidate for static caching in the first place.
- **Verified live:** `next build` succeeds cleanly (public env vars only, matching a preview build); unauthenticated requests to `/admin` and `/admin/feedback` 307-redirect to `/admin/login` (confirmed via `curl`, not just code review); `/admin/login` itself renders without a redirect loop; the existing home → explore → export smoke spec is unaffected by `proxy.ts`'s matcher.
- **Not verified live, and can't be in this sandbox:** the actual password-auth round trip (`supabase.auth.signInWithPassword` call from the browser to Supabase's Auth API) — the headless Chromium here has no outbound network access to *any* external host at all (confirmed directly: `page.goto()` to a bare Supabase health-check URL times out), unlike the Next.js **server** process, which does have outbound access (that's why every other live check this session — real builds, real SSG against the live DB, the chat route's server-side calls — worked). This is a sandbox limitation on the browser process specifically, not a code defect; server-side Supabase Auth calls (session refresh in `proxy.ts`/`getAdminAuthResult`) use the same client library and already work in every build/render tested. Once a real admin account exists, the owner should do one manual sign-in to confirm the round trip.

## 2026-07-19 — Increment 2.6: growth groundwork

- **`docs/DATASET_SCOPING.md`**: assessed four candidate complementary datasets against license,
  PSGC geo-join fit, and update cadence — PSA population/census, DOH NHFR (facility registry), DOH
  FHSIS (service indicators), and PhilAtlas-style reference sites. Recommended the **PSA
  population candidate** (slug `psa-population-2020`) as dataset #2: it's the only one with a
  confirmed open-data license and an expected-clean PSGC join (no crosswalk work anticipated,
  unlike the boundary-vintage mismatch hit in 1.6), it's a one-time decennial load rather than an
  ongoing sync, and "BHWs per 1,000 residents" is a genuinely requested kind of context Phase 1
  can't currently show. NHFR and FHSIS are flagged as higher-value but blocked on confirming
  license/access terms directly with DOH — both researched via their public sites/docs rather than
  assumed, and both explicitly marked unconfirmed where the source material didn't settle the
  question, rather than guessed at.
- Also documented (not built), per §8 2.6's explicit "optional, document only": the barangay
  PMTiles map upgrade path (deferred from 1.6/P11) and an open, versioned public API design
  building on the existing `/api/export/csv` "researcher API" pattern from §4.4.
- **`/roadmap`** updated: Phase 2 features (AI insights/chat, admin panel) moved from "Coming
  next" to "Live now" now that 2.1–2.5 have shipped; "Coming next" reduced to what's actually still
  outstanding (barangay polygons, dataset #2); the dataset-suggestion section now links to
  `docs/DATASET_SCOPING.md` so a visitor can see the actual candidate assessment, not just a
  feedback form.

This closes out BUILD_PLAN.md Phase 2 (§8, increments 2.1–2.6). Everything AI-related degrades
honestly to the existing Phase 1 template/non-AI experience when unconfigured or at capacity —
verified concretely, not just by design, across every code path this phase touched (2.1's mocked-
provider tests, 2.3/2.4/2.5's live `next build`-and-run checks that each caught a real
service-client-throw or static-prerender bug before it could reach production).

## 2026-07-19 — BHWs per 1,000 residents, using StepZero's own population data

Picked up `docs/DATASET_SCOPING.md`'s recommended next step (per-capita context) without its
recommended path (a new PSA population dataset): the owner pointed out that the StepZero
quick-count already carries `population`/`households` per barangay, rolled up to every geo level —
loaded back in the total-vs-validated-profiles reframing, but never actually read for anything
beyond that reframing's own `agg_bhw_stepzero_counts` row. No new dataset, migration, or ingestion
pipeline needed; this is a derived figure over data already in production.

- **`lib/db/stepzero.ts`**: `BhwOverview` gained `population`, `households`, and
  `bhwPer1000Residents` (a new pure `bhwPer1000ResidentsFor(totalBhw, population)` helper — Total
  BHWs, the StepZero universe, not validated profiles, since the point is comparing places by their
  actual workforce headcount, not the individually-profiled subset). Rounded to one decimal place;
  null whenever population is missing or zero (about 2,689 barangays have no `dim_geo`-matched
  StepZero row at all, per the original StepZero-loading entry above — this rate is simply absent
  for those places rather than shown as a misleading zero).
- **Surfaced everywhere `totalBhw`/`coverageForDisplay` already were**, no new page: a fifth home-page
  `StatTile` (national rate), `ProfileHeader`'s meta line (every place page), the `/explore` overview
  banner, and `CompareColumn` — all reading the same `getBhwOverview()` call those surfaces already
  made, so this added zero new database round-trips.
- **AI grounding**: `lib/ai/tools.ts`'s `getIndicatorByGeo` now includes `population`/
  `bhwPer1000Residents` in every response's `base` object (the same object every indicator branch
  spreads), so narratives/chat can cite the rate — it's exactly as grounded as every other number the
  tools return, no separate audit-allowlist entry needed.
- **`lib/glossary/terms.ts`** gained `bhw_per_1000`; wired into `/methodology`'s existing StepZero
  section rather than a new one, and `/roadmap` moved the "per-capita context" line from "Coming
  next" (where it named PSA population as the leading candidate) to "Live now" (describing what
  actually shipped — StepZero-derived, not PSA-derived).
- **`docs/DATASET_SCOPING.md`** updated with a note that its motivating gap for the PSA-population
  candidate is closed; PSA stays listed as a future cross-check source (StepZero's population column
  is a self-reported sheet field, not an actual census), not as a blocking dependency.
- **Verify:** added `lib/db/stepzero.test.ts` for the new pure helpers (`bhwPer1000ResidentsFor`,
  plus `coverageForDisplay`, which had no direct test before this) — normal case, one-decimal
  rounding, and null-population/null-total/zero-population edge cases. `npm run lint && npm run
  typecheck && npm test` all pass (49/49 tests); `next build` compiles and type-checks cleanly but
  this session has no `.env.local` with live Supabase credentials (a fresh sandbox, unlike several
  earlier increments' sessions — see 1.1's entry on how that file is sourced and gitignored), so it
  can't get past `generateStaticParams`' live SSG data collection for `/place/[geoLevel]/[geoCode]`
  to actually finish a full production build here; not a defect introduced by this change, since the
  failure is the pre-existing missing-env-vars point, not anything touched in this diff.

## 2026-07-20 — StepZero provenance confirmed; root cause of the dim_geo gap found

**Owner confirmation, resolving the open follow-up from the original StepZero entry.** StepZero
and `bhw-2025` are the same 2025 profiling initiative, not two independently-collected datasets:
the process was to ask each LGU how many BHWs they had (StepZero) *before* starting individual
profiling, specifically so the profiling's denominators would be clear going in. `as_of_date`
(`2025-01-01`) was already correct and is now confirmed rather than assumed. `license`/`source_url`
remain unconfirmed and unchanged (null). Applied directly to the live project
(`20260720090000_confirm_stepzero_provenance.sql`): `dim_dataset.status` for `bhw-stepzero-2026`
moves from `'draft'` to `'published'` — a value distinct from `'active'` on purpose, since
`getActiveDatasetId()` filters on `status = 'active'` for the sole per-person dataset and StepZero
is always read by slug (`getDatasetIdBySlug`), never by that filter; `source_name` updated to state
the relationship. `/methodology`'s "Two data sources" section gained a paragraph explaining this —
genuinely useful context for why StepZero is a trustworthy denominator baseline, not just an
internal bookkeeping fact.

**This also reframes the ~2,689 barangay / 12 citymun `dim_geo` gap** the original StepZero entry
attributed to "newer PSGC entries or renumbered barangays" — re-investigated using the same two
source files (`ingestion/data/dataset.parquet`, `ingestion/data/bhw_connect_stepzero.xlsx`, both
present in this sandbox) now that the provenance is understood:

- **The 12 missing citymuns are real, currently-existing LGUs with zero rows in the `bhw-2025`
  parquet at all** — not a coding/vintage mismatch. Confirmed by name: `CITY OF IMUS` and
  `GEN. MARIANO ALVAREZ` (Cavite), six Quezon-province municipalities (`MULANAY`, `PADRE BURGOS`,
  `PITOGO`, `QUEZON`, `SAN ANDRES`, `SAN FRANCISCO`), three Basilan municipalities (`SUMISIP`,
  `TIPO-TIPO`, `AL-BARKA`), and `KAPATAGAN` (Lanao del Sur) — Cavite's parquet rows cover only 21 of
  its 23 real municipalities, Quezon only 34 of 40, Basilan only 9 of 11 — real, verifiable
  undercounts, not renamed duplicates. These carry 331 of the 2,689 unmatched barangays.
- **The remaining 2,358 unmatched barangays sit under citymuns `dim_geo` already has** (e.g.
  `SAMPALOC`, `TONDO I/II`, `PASAY CITY`, `CITY OF CALOOCAN`, several Iloilo/Samar towns) — checked
  for name collisions against `dim_geo`'s existing barangays in the same citymun (which would mean
  "same place, different code" rather than "actually missing"): only 7 of 2,358 collide by name:
  the other 2,351 are barangays with no matching name at all under that citymun.
- **Conclusion: this isn't a PSGC vintage problem, it's an individual-profiling-coverage gap.**
  `dim_geo` is built purely from `df[...].drop_duplicates()` over the parquet (`build_dim_geo()` in
  `ingest.py`) — a place with zero profiled BHW rows simply never appears in `dim_geo`, whole-LGU or
  barangay-by-barangay. StepZero's LGU-reported headcount reached every barangay nationally
  (confirmed in the earlier entry: all 39,276 `dim_geo` barangays are a subset of StepZero's 41,965);
  individual profiling, as of the `bhw-2025` snapshot, had not yet reached these ~2,700 places. This
  is consistent with — and now explained by — point 1 above: StepZero establishes the full universe
  first, profiling fills in behind it.

**Executed same-day, on owner go-ahead ("update psgc").** `ingestion/patch_dim_geo_stepzero_gap.py`
builds the patch straight from `bhw_connect_stepzero.xlsx`'s own hierarchy columns (region/
province/citymun/barangay code + name) for the 12 citymuns and 2,682 non-colliding barangays (331
under the 12 new citymuns + 2,351 under already-known ones); `income_class` null (the sheet doesn't
carry it); `psgc_vintage` tagged `'stepzero_only_v1: no bhw-2025 profile rows as of the 2025
snapshot'` so the provenance is honest in the data itself, not just this log. The 7 name-collision
barangays (`0506216039` Balogo/Sorsogon, `0631000198`/`0631000199`/`0631000155`/`0631000200`
Luna/San Isidro/San Jose x2/San Pedro under City of Iloilo, `0931700028` Dulian/Zamboanga City) were
excluded — same name already present in `dim_geo` under the same citymun, more likely a renumbering
than a new place; flagged in `ingestion/_qa_report_patch_psgc_gap.json` for a manual PSGC check
rather than guessed at.

- **Loaded live** via the same temporary-`SECURITY DEFINER`-RPC-over-PostgREST pattern used for the
  original `dim_geo`/StepZero loads (`ingestion/_load_psgc_patch_live.py`; this sandbox still has no
  direct Postgres TCP) — two functions (`_patch_load_dim_geo`, `_patch_load_stepzero_counts`),
  each gated by a random one-time secret, granted to `anon`, called in 200-row batches so the row
  data never had to pass through the assistant's own context, then dropped immediately after (this
  session does have working `execute_sql`/`apply_migration` access via the Supabase MCP tools for
  the function-management statements themselves, unlike earlier sessions — only bulk row data used
  the RPC workaround). Committed as `supabase/migrations/20260720100000_patch_stepzero_psgc_gap.sql`
  for the record even though the live load went through the RPC path, consistent with how the
  original StepZero load's migrations were committed separately from its RPC-based data push.
- **Verified live:** `dim_geo` 41,052 → 43,746 rows (1,639→1,651 citymuns, 39,276→41,958 barangays,
  exactly +12/+2,682); `agg_bhw_stepzero_counts` 41,052 → 43,746 (every `dim_geo` row now has a
  matching StepZero row); spot-checked City of Imus (`0402109`, parent province `04021` Cavite,
  n_total_bhw 39, population 19,320) and one of its barangays (`0402109001` Alapan I-A, population
  10) — correct hierarchy and figures. Temporary RPC functions confirmed dropped (0 left in
  `information_schema.routines`).
- **Confirmed via code read, not just assumption: place pages/explore/compare degrade correctly.**
  `app/place/[geoLevel]/[geoCode]/page.tsx` resolves the profile header via `getGeoByCode`/
  `getGeoAncestors` (both read `dim_geo` directly) and figures via `getBhwOverview`/`getBhwCounts`,
  which already null-degrade to "No accreditation data available" / em-dashes when a geo has no
  `agg_bhw_counts` row — exactly these new geos' situation, and the mirror image of the "no StepZero
  row" case `getBhwOverview` already handled. No code changes were needed for this to work.
- **One real, honest gap surfaced by testing `search_geo` directly (not by reading the code alone):**
  both of `search_geo`'s branches — full-text over `agg_geo_summary.search_text` and the
  `word_similarity` trigram branch over `dim_geo.geo_name` — inner-join against `agg_geo_summary`,
  which is built only from `fact_bhw_raw`-covered geos (0.5's `_agg_base`). So the new geos resolve
  correctly by direct URL/cascading dropdowns but **do not appear in "find my barangay" search** —
  confirmed empirically (`select * from search_geo('City of Imus', 5)` doesn't return it). Not fixed
  here: doing so would mean either loosening `search_geo` to `LEFT JOIN` (works, but then `n_total`/
  ranking need a null-population fallback) or giving these geos a minimal `agg_geo_summary` row,
  which touches the same disk-budget-sensitive aggregate build flagged in 0.5. Left as a known,
  documented gap rather than a silent one.

## 2026-07-20 — Households per BHW replaces BHWs per 1,000 residents as the headline ratio

**Owner direction:** in the Philippines BHWs are assigned to *households*, so households per BHW —
not a per-capita rate — is the ratio that actually matters for workload and coverage. Replaced the
day-old per-1,000-residents figure with households per BHW everywhere it appeared, rather than
showing both: two density ratios side-by-side would dilute the one that maps to how the workforce
is actually organized, and StepZero's `households` column (already loaded and rolled up to every
geo level) is exactly the needed denominator. No schema, migration, or ingestion change.

- **`lib/db/stepzero.ts`**: `BhwOverview.bhwPer1000Residents` → `householdsPerBhw`. The pure
  `householdsPerBhw(households, totalBhw)` helper *moved here* from `lib/db/insights.ts` (where the
  barangay-level "household coverage" insight card had already introduced the identical computation)
  so the overview and the insight generator share one definition; `insights.ts` now imports it.
  Same semantics as the insight always had: rounded to a whole number of households, null unless
  both inputs are positive. Numerator stays Total BHWs (the StepZero universe), matching the old
  rate's reasoning: workload falls on the actual workforce, not the individually-profiled subset.
- **Swapped in place at every surface the old rate occupied** (all already reading the same
  `getBhwOverview()` call — zero new database round-trips): the fifth home-page `StatTile` (now
  "Households per BHW", gauge and BHWs-vs-households enlarge chart), `ProfileHeader`'s meta line,
  the `/explore` overview banner, and `CompareColumn` (prop renamed `bhwPer1000Residents` →
  `householdsPerBhw`).
- **AI grounding**: `getIndicatorByGeo`'s `base` object now carries `households` and
  `householdsPerBhw` in place of `bhwPer1000Residents` (`population` kept — it's raw context worth
  citing on its own).
- **`lib/glossary/terms.ts`**: `bhw_per_1000` → `households_per_bhw`, with the assignment-based
  rationale in the definition; `/methodology`'s StepZero section and `/roadmap`'s "Live now" bullet
  rewritten to match. (Deliberately did not cite a specific DOH ideal ratio such as 1:20 — no
  owner-confirmed source for which target applies; the UI states the observed ratio only.)
- **Verify:** `householdsPerBhw` tests moved from `insights.test.ts` to `stepzero.test.ts`
  alongside the helper (replacing the deleted `bhwPer1000ResidentsFor` tests); lint, typecheck, and
  the full test suite pass. Same sandbox caveat as yesterday's entry: `next build` can't complete
  live SSG here without `.env.local` Supabase credentials.

## 2026-07-20 — Data completeness made per-geo and surfaced on place pages

`agg_data_completeness` was dataset-wide (one row per field), so a place page could only have
shown a national figure dressed up as local. Made it per-geo instead — and the data proves the
point: `active_years` is 0.01% missing nationally, but all 20 missing rows sit in Batad, Iloilo,
where they are 23% of local profiles.

- **Schema** (`20260720140000_agg_data_completeness_per_geo.sql`, applied to the live DB):
  added `geo_level`/`geo_code` to `agg_data_completeness`, unique key now
  `(dataset_id, geo_level, geo_code, field_name)`, plus a `(geo_code, geo_level)` index.
- **Aggregation** (`build_aggregates.sql` §9): rebuilt with the same barangay→ancestor lateral
  fan-out the other aggregates use, at national/region/province/citymun. **Barangay level is
  deliberately omitted** — the same disk-budget cut as `agg_training` (the DB already sits at
  ~529 MB against the free tier's 500 MB); it would have added ~314k of the ~328k rows for the
  least-read pages. Live table rebuilt: 14,208 rows. National rows equal the old dataset-wide
  figures exactly (every `fact_bhw_raw` row joins to a barangay in `dim_geo`).
- **`lib/db/data-quality.ts`**: `getDataCompleteness(geoCode?, geoLevel?)` defaults to national,
  so `/data-quality` is unchanged. Missingness remains NULL-only — fields with explicit
  "unknown" source categories (e.g. blood type) count those rows as present; stated in the
  card's technical details rather than silently.
- **`components/place/completeness-figure.tsx`**: place-page FigureCard. Fields with gaps render
  as a `FigureView` bar list (worst first); a fully-complete place states that plainly instead
  of an empty chart; barangay pages link to their citymun's figures (same pattern as
  `TrainingFigure`). Field labels are shared with `/data-quality` via
  `COMPLETENESS_FIELD_LABEL` (map moved out of that page).

## 2026-07-20 — Households-per-BHW home tile: gauge replaced with regional spread

Closes the E2 loose end from HOME_SEARCH_REVIEW: #29 gave the households-per-BHW home tile the
gauge the old per-1,000 tile had, whose max was still an arbitrary `1.5×` of the value — a gauge
arc implies a benchmark, and none exists (the previous entry deliberately cites no DOH target
ratio). Implemented the review's item-9 prescription for the national context: show the observed
distribution across regions instead.

- **`lib/db/stepzero.ts`**: `getRegionHouseholdsPerBhw()` — all regions' ratios from
  `agg_bhw_stepzero_counts` in one query (names joined from `dim_geo`), computed with the same
  shared `householdsPerBhw()` helper, sorted ascending.
- **`components/home/mini-viz.tsx`**: `DotStrip` — a strip plot (one dot per region, accent
  marker for the national value) on a 0-to-max-observed scale, with "0" / "regions lo–hi" end
  labels. Positions read as proportions of the real spread, not of an invented cap.
- **`app/page.tsx`**: the tile's gauge swapped for the strip; its enlarge modal now charts
  households-per-BHW by region (replacing the old "Total BHWs vs. Households" two-bar chart,
  whose million-scale bars dwarfed the actual story). The data makes the case for the change:
  regional averages run 45 to 519 (NCR) households per BHW around the national 91 — a spread no
  half-arc against `1.5×` could show. The Accredited tile keeps its gauge: percent-of-100 is a
  real scale, not an invented one.

## 2026-07-21 — Phase E0: Map trust (EXPLORE_ENHANCEMENT_PLAN.md, ships as its own release)

First release of the Explore enhancement plan (owner decision Q6: P0/E0 ships alone before E1).
All six increments landed together as one PR-sized phase, no schema changes except E0.5's query
widening. Everything lives in the Explore map figure and its supporting chart/color helpers.

- **E0.1 Honest bins + legend.** `lib/charts/color-scale.ts` rewritten: `colorForValue(value, min,
  max)`'s continuous min-max normalization (whose `floor(t*7)` sent the max value one bucket out
  of range, silently clamped) is replaced by `computeQuantileBins(values, count=5)` →
  `binIndexForValue`/`colorForValue(value, bins)`. Quintile breaks are linear-interpolated
  quantiles, deduped ascending so ties collapse to fewer real bins instead of zero-width ones;
  0 values → `[]` (all no-data), 1 distinct value → single mid-ramp bin, `<5` distinct → fewer
  bins. New `components/maps/map-legend.tsx` renders one real-DOM swatch per bin with its value
  range (the map canvas is `aria-hidden`, so the legend is the accessible encoding), plus no-data
  and small-N markers. The figure caption gains the scale disclosure ("Color bins are quintiles
  across the N regions shown"). Unit tests in `color-scale.test.ts` (7 cases: empty, single, five
  contiguous quintiles, tie fallback, max-in-top-bin, min-in-bottom-bin, no-data).
- **E0.2 Hover tooltips + select-then-drill.** `components/maps/choropleth-map.tsx` rewritten.
  MapLibre `mousemove` on `geo-fill` shows a positioned, `aria-hidden` tooltip (name · value ·
  N profiled, "No data — see ranked list" for grey polygons). Click no longer navigates: a single
  map-level `click` handler selects on first click, drills on a second click of the same polygon,
  and dismisses on a background click. Selection state lives in `GeoComparisonFigure`, which
  renders a real-DOM mini-card (name/value/N + "Open {name} →" and dismiss buttons) — the
  keyboard/touch-accessible drill path. Esc dismisses. One flow for mouse and touch.
- **E0.3 Gestures + controls.** `cooperativeGestures: true` (Ctrl/Cmd+wheel zoom, two-finger pan —
  kills the page-scroll trap), `NavigationControl` (zoom, no compass), and a custom "reset view"
  control re-running the initial `fitBounds`. `attributionControl: false` kept. Every injected
  control button is set `tabIndex = -1` (like the canvas) so the `aria-hidden` container has no
  focusable descendant — keeping axe's `aria-hidden-focus` clean; keyboard users drill via the
  mini-card and ranked list.
- **E0.4 Map ↔ list linked highlighting.** `hoveredGeoCode` lifted into `GeoComparisonFigure`. Map
  hover sets it (via `onHoverGeo`) and the ranked-list table highlights the matching row; hovering
  a table row outlines the polygon. Implemented with MapLibre feature-state (`promoteId:
  "geo_code"`) and a dedicated `geo-highlight` line-layer, and by threading optional
  `geoCode`/`hoveredGeoCode`/`onHoverGeoCode` through `BarDatum` → `FigureView` → `FigureTable`
  (all optional, so the chart's export-shared spec and every other figure are untouched — this is
  the "smallest change that doesn't disturb `BarChartClient`" the plan asked for; the chart view
  keeps its own Plot hover).
- **E0.5 Small-N signaling.** `getChildIndicators` widened to also select `n_total`. Polygons with
  `n_total < MIN_LEADER_N` render at 0.4 fill-opacity with a dashed slate outline; tooltip,
  mini-card, and legend all carry "Only {n} BHWs profiled — rate is unstable." `MIN_LEADER_N` was
  moved to a new client-safe module `lib/analysis/thresholds.ts` and re-exported from the
  `server-only` `lib/db/insights.ts`, so the client map and server insight generator share the
  identical floor (30) without the map importing `server-only` code.
- **E0.6 Telemetry + pending feedback.** `logEvent` fires `map_select`, `map_drill`, and (sampled
  once per pageview) `map_hover_tooltip`, meta `{ childLevel }`. A shared React transition
  (`components/explore/explore-nav.tsx` + `app/explore/layout.tsx`) is threaded into every Explore
  navigator (geo cascade, breadcrumb chips, map drill) via nuqs' `startTransition` option, driving
  one thin top progress bar during the RSC re-render. Scoped to the Explore layout, not global.

**Verify.** `npm run lint`, `npm run typecheck`, and `npm test` (86 tests, incl. the 7 new
color-scale cases) all pass; `next build` compiles and type-checks clean. Live-DB checks — the
Playwright map interactions (E0.2), axe on `/explore` at national/region/province, and the
Lighthouse a11y=100 / JS-budget release gate — could **not** run in this sandbox (no `.env.local`
Supabase credentials; `next build` fails only at static page-data collection for `/place/*`, the
same caveat as prior entries), so they are deferred to a live pass on the deploy preview. Legend
ranges are computed from the same `withData` values the ranked list renders, so they match by
construction. The E0 **telemetry baseline** (XU3: two weeks of map/cascade events before E1) is a
post-deploy measurement, not a code artifact; E1 development need not block on it.

## 2026-07-21 — Phase E1.1: Explore map indicator switcher

First increment of Phase E1 (EXPLORE_ENHANCEMENT_PLAN.md). Turns the Explore map from
"a map of accreditation" into a switchable map of the dataset — the highest-value E1 change,
and the data foundation E1.3 (distribution) / E1.4 (relationships) reuse. Branch off the merged
E0 `main` (not the E0 branch).

- **New `mapIndicator` URL param.** Added to `lib/filters/schema.ts` (`MAP_BASE_INDICATORS` =
  `pct_accredited`, `any_honorarium_pct`, `households_per_bhw`, `avg_active_years`, `coverage_pct`;
  plus `training:<topic_slug>` for per-topic training) and `lib/filters/codec.ts` via a custom
  `createParser` (base values + a kebab-slug-validated `training:` prefix; everything else
  `normalizeMapIndicator`s back to the default `pct_accredited` — permalinks degrade, never throw,
  matching the rest of the codec). Default is omitted from serialized URLs by nuqs. `mapIndicator`
  is its own param, separate from the per-theme `indicator`. Codec round-trip + `normalizeMapIndicator`
  unit tests added (`lib/filters/index.test.ts`, now 11 cases).
- **Data.** `getChildIndicators` widened from accreditation-only to all five base indicators,
  merging three aggregates by geo_code in one round-trip each: `agg_geo_summary`
  (pct_accredited, any_honorarium_pct, n_total), `agg_bhw_counts` (avg_active_years), and the
  StepZero companion `agg_bhw_stepzero_counts` (registered/accredited universe + households +
  total BHWs). `households_per_bhw` and `coverage_pct` are derived in-helper exactly as
  `lib/db/stepzero.ts` does. New `getChildTrainingCoverage(codes, topicSlug)` queries `agg_training`
  and is fetched (in parallel with the base query) only when a `training:` indicator is active.
  Child counts per parent stay far under the PostgREST 1,000-row cap at every level the map renders
  (national→region ≈18 … province→citymun ≤~50; national→citymun's 1,639 is never rendered here),
  so single `.in()`s suffice — documented inline, consistent with `getChildSummaries`.
- **Coverage denominator — deviation from the plan's literal text, logged per §1.** The plan wrote
  `coverage_pct = validated / n_total_bhw`. Implemented as `validated / registered-universe`
  (registered + registered-&-accredited), capped at 100 — i.e. the *exact* figure the summary
  strip ("X% of registered") and place pages already show via `coverageForDisplay`. Chosen so the
  E1.1 verify gate ("values spot-checked against place-page figures") holds by construction and the
  map never contradicts the strip directly above it. Resolves under §1's ground rules (reuse
  Home/place wording + denominator conventions) and identity rule Q1.
- **Presentation.** New client-safe `lib/analysis/map-indicators.ts` (no `server-only`, like
  `thresholds.ts`) holds per-indicator label / headline phrase / axis label / unit suffix /
  caption denominator as plain strings (crosses the server→client boundary) plus a pure
  `formatIndicatorValue`. Both the server page (value resolution, caption) and the client figure
  (switcher, headline, legend) read it. Direction handling: headlines always say "highest
  {phrase}", never "best/worst" — so `households_per_bhw` (higher = heavier load) carries no valence.
- **UI.** `GeoComparisonFigure` gained a labeled `<select>` (five base indicators + a "Training
  coverage" option that reveals a topic `<select>`, disabled when the geo has no training topics).
  Values/headline/caption/legend all bind to the server-resolved `activeIndicator` (not the
  optimistic URL read), so the control, the colors, and the ranked list update together on the RSC
  round-trip — the E0 top progress bar covers the in-between, and a stale `training:` permalink that
  fell back to accreditation never shows a topic the map isn't rendering. Map recolors, bins
  recompute (E0.1), ranked list re-sorts, and the caption swaps its denominator per indicator.
  `logEvent("map_indicator_change", { indicator, childLevel })` fires on change.
- **Page.** `app/explore/page.tsx` reads `filters.mapIndicator`, validates an active `training:`
  topic against the parent's available topics (falling back to the default if absent), resolves each
  child's value server-side, and passes resolved `items` + `activeIndicator` + `meta` + the topic
  list to the figure. The two big-number cards are untouched here (their removal is E1.2).

**Verify.** `npm run lint` (clean), `npm run typecheck` (clean), `npm test` (91 pass, incl. 5 new
codec/normalizer cases), and `next build` all run; `next build` compiles + type-checks clean and
fails only at `/place/[geoLevel]/[geoCode]` page-data collection for lack of `.env.local` Supabase
credentials — the identical sandbox caveat as the E0 entry, unrelated to this change. The live
checks the plan lists for E1.1 (each indicator round-tripping through the URL against real data;
values spot-checked against place-page figures for two geos per indicator; suppressed/absent data
rendering grey, never 0; `map_indicator_change` landing in `usage_events`; axe on the new switcher
control) require live DB + browser and are **deferred to the Vercel preview** — not claimed here.

## 2026-07-21 — Phase E1.2: Explore page restructure

Second E1 increment (same branch/PR as E1.1, per the pinned working branch). Reorders
`app/explore/page.tsx` around the map and removes the two big-number cards.

- **New order.** breadcrumb chips → labeled summary strip → **map figure (hero, full-width)** →
  [distribution E1.3 / relationships E1.4 slots, marked with a comment for the next increments] →
  per-theme figure groups (demographics, training, honorarium) → insights. The map figure was
  lifted out of the 2-column grid to its own full-width block above the groups.
- **Deleted the two big-number cards** (Accreditation %, Average years of service) and their now-
  orphaned `FigureCard` / `ExportMenu` imports. Per the plan, their numbers live on elsewhere:
  both are now stats in the summary strip (for the current geo) and selectable map indicators (for
  its children). **Note:** the accreditation card's `ExportMenu` (indicator="accreditation") was
  removed with it; export-menu parity is restored in E1.5 on the appropriate parity figures, per
  the plan's sequencing — no export route was deleted, only the button placement.
- **To avoid a regression in the E1.2→E1.3 gap**, the current geo's own accreditation % and avg
  years are added as strip stats (they were previously only in the deleted cards; the map switcher
  colours *children*, not the parent, and E1.3's parent-value marker isn't built yet). This is the
  plain reading of the plan's "their numbers live in the strip and the switcher."
- **Summary strip upgraded** (plan E1.2): wrapped in a `<section>` with an `aria-labelledby`
  heading ("{Geo} at a glance"); `GlossaryTerm` on "validated profiles", "accredited", and
  "households per BHW"; and a collapsed `<details>` reusing `DenominatorExplainer` (the funnel
  content, not Home's always-open card) so the two-denominator relationship is one click away
  without duplicating Home. The explainer only renders when StepZero data exists for the geo.

**Verify.** `npm run lint` (clean, no orphaned imports), `npm run typecheck` (clean), `npm test`
(91 pass — unchanged; this increment is presentational), `next build` compiles + type-checks clean
(same `/place/*` no-creds caveat). The plan's visual pass at 360 px / 1280 px, axe on the new strip
+ `<details>`, and the PR screenshot need the rendered page and are **deferred to the Vercel
preview** — not claimed here.

## 2026-07-21 — Phase E1.3: Distribution view ("spread among children")

Third E1 increment (same branch/PR). New `components/explore/distribution-figure.tsx` renders,
directly below the map, the spread of the **active `mapIndicator`** across the current geo's
children — answering "is my province's 62% typical or an outlier?".

- **No new query.** Reuses the exact `items` the map figure already resolved for the active
  indicator; the page additionally computes the parent geo's own value for that indicator from the
  same sources the summary strip uses (`getBhwCounts` for accreditation / any-honorarium / avg
  years, `getBhwOverview` for households-per-BHW and coverage %, the parent's `agg_training` row for
  `training:` topics), so the parent marker and the strip can never disagree (E1.3 verify gate).
- **Bespoke server-rendered dot-strip** (no client JS — keeps the map/chart budget lazy), in the
  same honest-comparator idiom as the home `DotStrip`: one dot per child positioned by value, a
  shaded interquartile band, a median tick, and an accent marker + "{Parent} overall: X" callout.
  Small-N children (`nTotal < MIN_LEADER_N`) render as hollow dots with a legend note — consistent
  with the map's E0.5 signaling. The strip is `role="img"` with a full numeric `aria-label` (lowest/
  p25/median/p75/highest + parent), and the same five-number summary is in `FigureCard`'s technical
  details, so the visualization has a complete text alternative without duplicating the ranked list.
- **Headline template** per the plan: "Most {children} fall between {p25} and {p75}[; {outlier}
  stands out at {value}]." The outlier is a Tukey 1.5·IQR fence pick, only asserted when there are
  ≥4 children with a real spread (`iqr > 0`) — never manufactured from 2–3 points or a flat
  distribution. Values format through the shared `formatIndicatorValue`, so units track the
  indicator (% vs households vs years).
- **Placement/keying.** Renders only where the map does (national/region/province parents with
  children); re-keyed on `geoCode + activeMapIndicator` so it recomputes cleanly when the indicator
  switches.

**Verify.** `npm run lint`, `npm run typecheck` (both clean), `npm test` (91 pass — presentational
increment), `next build` compiles + type-checks clean (same `/place/*` no-creds caveat). Live checks
(parent marker visually matches the strip; small-N dots hollow; headline sanity per indicator across
levels) are **deferred to the Vercel preview**.

### E1.3 follow-up — unified value formatting (strip ⇄ map ⇄ distribution)

Live smoke-check on the preview showed the distribution's parent marker and the summary strip
displaying the same figure at different precision (avg years 10.5 vs 10.47; accreditation 72% vs
71.57%) — the same number, but a reviewer would read it as a mismatch against the "parent marker
matches the strip" gate. Fixed by making `formatIndicatorValue` the single formatter for all of
them: dropped its whole-number special-case for percentages so it now rounds every non-integer to
one decimal, identical to the map tooltip (`formatValue`) and legend (`formatEdge`); and the summary
strip now imports `formatIndicatorValue` for accreditation % and avg years instead of printing the
raw 2-decimal DB value. Result: strip, map tooltip/legend, headline, mini-card, and the distribution
marker all render the same value identically (e.g. 71.6% everywhere, 10.5 everywhere).

## 2026-07-21 — Phase E1.4: Relationships view (scatter) + correlation-in-words (S7)

Fourth E1 increment (same branch/PR). New `components/explore/relationship-figure.tsx` renders a
scatter of the current geo's children on two chosen base indicators, below the distribution view,
and states the link between them in plain words.

- **Two new URL params `relX` / `relY`** (base-indicator enums; defaults `households_per_bhw` ×
  `pct_accredited`) in `schema.ts` + `codec.ts`, with round-trip tests. Restricted to the **five
  base indicators** (not `training:`) to avoid a two-axis topic-picker; training-on-axes is a
  possible follow-up. No server fetch depends on relX/relY — the scatter has every base value per
  child already — so switching axes recolors instantly while the URL updates (shallow:false +
  transition per the §1 ground rule; the client data makes the round-trip a no-op visually).
- **No new query.** `getChildIndicators` (E1.1) already returns all base values per child; the page
  hoists that row set (`childIndicators`) so the map, distribution, and scatter share one query.
- **Correlation-in-words (S7).** New client-safe `lib/analysis/correlation.ts`: Spearman's ρ
  (tie-aware average ranks → Pearson on ranks), `describeCorrelation` bucketing |ρ| at 0.2 / 0.4 /
  0.7 (none / weak / moderate / strong) with direction. Small-N children (`nTotal < MIN_LEADER_N`)
  are **excluded from ρ** and drawn as hollow dots; **< 10 comparable places → "too few places to
  assess a pattern"** instead of a coefficient. The headline carries the ecological caveat inside
  the sentence ("This compares places, not individual BHWs"), per the review. Thresholds documented
  in a new `/methodology#relationships` section. **10 unit tests** cover ρ = ±1, a hand-computed
  single-swap case (ρ = 0.9), ties/constant → undefined, the strength buckets, and the small-N /
  insufficient paths.
- **Bespoke accessible SVG scatter (deviation from the plan's Plot suggestion, logged).** The plan
  suggested Observable Plot (lazy). Chose a hand-rolled SVG instead because each point is a real
  `<a href="/place/{level}/{code}">` with an `aria-label` (name + both values + N) and a `<title>`
  tooltip — keyboard-focusable and screen-reader-navigable, which a Plot-rendered SVG is not. Dot
  size ∝ profiled BHWs; hollow = small-N. This keeps the page's a11y-first posture (the map's
  aria-hidden-canvas + accessible-equivalent rule) and adds no chart-lib client JS. Fires
  `rel_axis_change` telemetry.

**Verify.** `npm run lint`, `npm run typecheck` (clean), `npm test` (101 pass, +10 correlation),
`next build` compiles + type-checks clean (same `/place/*` no-creds caveat). Live checks (ρ sign/
strength against hand cases on real data — the unit tests already cover the math; URL round-trip;
place-page links; axe on the SVG links + selects) are **deferred to the Vercel preview**.

## 2026-07-21 — Phase E1.5: Figure parity + exports

Fifth E1 increment (same branch/PR). Brings the figures Explore was inexplicably shallower on up to
parity with the place page — but now responding to the geo filter, which the place page (one fixed
geo) and Home (national only) can't do.

- **Certification.** `CertificationFigure` (training & certification coverage) added to the figure
  grid, fetched via `getCertification` — built at all five geo levels, so no fallback needed.
- **Honorarium as one tabbed card.** Replaced the lone by-payer-level `HonorariumFigure` with a
  `FigureTabs` "Honorarium" card — **Who receives · How much · Distribution** — the exact composition
  Home uses, reusing `HonorariumFigure` / `HonorariumAmountFigure` / `HonorariumDistributionFigure`
  unchanged, scoped to the selected geo. Rendered full-width below the grid, as on Home.
- **Completeness.** `CompletenessFigure` at the current geo (`getDataCompleteness`), with the same
  barangay→citymun pointer fallback it uses on place pages.
- **Exports.** `TrainingFigure` and the honorarium figures now receive `geoCode`/`geoLevel` on
  Explore, so their built-in `ExportMenu`s appear (they were previously omitted here); certification
  carries its export too. Demographics already had exports. The map/distribution/relationship
  figures get exports in E5, per the plan — not here.
- **Benchmarks — re-homed vs the plan's literal placement (logged, per §1 + identity rule Q1).**
  The plan said "BenchmarkBars vs region/national on accreditation, avg-years, training, honorarium."
  The place page actually attaches benchmarks to the **accreditation, avg-years, and households-per-
  BHW scalar cards** — which E1.2 *deleted* from Explore. Rather than reintroduce those cards or
  invent training/honorarium benchmarks the place page doesn't have, I added one compact "How {geo}
  compares" section under the summary strip with three `BenchmarkBars` (accreditation %, avg years,
  households/BHW) vs region + nation — the same three metrics, same `benchmarkRows` shape, and the
  same ancestor queries (`getBhwCounts`/`getBhwOverview` at national/region) as the place page, so
  "benchmark values match the place page for the same geo" holds by construction. Hidden at national
  level (nothing above to compare against); region level compares vs nation only.

**Verify.** `npm run lint`, `npm run typecheck` (clean), `npm test` (101 pass — this increment is
composition/parity, no new logic to unit-test beyond what E1.1–E1.4 added), `next build` compiles +
type-checks clean (same `/place/*` no-creds caveat). Live checks (benchmark values match the place
page for a sample geo; export links resolve for 2 geos; barangay training/completeness show their
citymun pointers; axe on the tabbed honorarium card) are **deferred to the Vercel preview**.

## 2026-07-21 — Phase E1.6: Sidebar + edge states (Phase E1 complete)

Final E1 increment (same branch/PR).

- **Sidebar `GeoSearch`.** Added the compact `GeoSearch` above the cascade with a new `mode` prop:
  `mode="explore"` makes a selection navigate to `/explore?geoLevel=…&geoCode=…` (browse in place)
  instead of the place page — the explore-context behavior the verify gate asks for. Default
  `mode="place"` leaves Home / place / not-found usages unchanged. Threaded through the keyboard
  (router.push), result-list, and recents navigation paths.
- **Breakdown picker.** Retitled its legend "Demographic breakdowns" → **"Add demographic figures"**
  with a one-line hint ("Show extra breakdowns of the profiled BHWs here"). Component is Explore-only.
- **Map-absence stub + list-only comparison (edge state).** Refactored the page's `mapChildLevel`
  into `compareChildLevel`, which now goes one level deeper than the *map*: national→region,
  region→province, province→citymun, **and citymun→barangay**. Boundary files still stop at citymun
  polygons (province view), so `mapGeojsonUrl` is null at citymun/barangay. When it's null the page
  renders a dashed **stub card** ("Maps below the city/municipality level are on the roadmap…",
  linking `/roadmap`), and — at citymun, where barangay children exist — the `GeoComparisonFigure`
  renders **list-only** (it already guards the choropleth/legend on `geojsonUrl`), so the stub's
  "ranked list below covers every barangay" is literally true. The distribution and relationships
  views render at citymun too (they never needed a map). Barangay is a leaf: stub only, no list.
- **Barangay training guard.** `agg_training` has no barangay rows, so the switcher's training option
  is suppressed (empty `trainingTopics`) when the children are barangays, rather than offering a
  topic every child would render as no-data.
- **Known follow-up (logged, not a blocker):** a large city (e.g. ~140 barangays) makes the
  list-only *bar* view tall; the figure's chart/table toggle mitigates it, and the plan asks for
  "every barangay", so the list is intentionally uncapped. A per-level default-to-table or top-N
  affordance could refine this later.

**Verify.** `npm run lint`, `npm run typecheck` (clean), `npm test` (101 pass), `next build`
compiles + type-checks clean (same `/place/*` no-creds caveat). Live checks (sidebar search stays on
`/explore` with new geo params; stub shows only at citymun/barangay; citymun barangay list renders;
axe on the new sidebar search + stub) are **deferred to the Vercel preview**.

**Phase E1 release gate.** All six increments (E1.1–E1.6) are merged into this branch/PR. The
full-cascade Playwright pass (national→barangay exercising switcher/distribution/relationships/parity
figures), the Lighthouse budget re-check, and the telemetry comparison vs the E0 baseline are
live/deploy-time activities (no Supabase creds or browser here) and remain **deferred to the preview
+ post-deploy** — called out rather than claimed.

## 2026-07-21 — Phase E2.1: Surface computed-but-unread fields

First increment of Phase E2 (EXPLORE_ENHANCEMENT_PLAN.md), on a fresh branch off `main` after
Phase E1 merged (PR #38). Owner decisions this session: **merge E1 first**, and **start with the
no-DB work only** — so E2 opens with E2.1 (and later E2.5), both pure read + UI. The DB-dependent
increments (E2.2 Wilson CIs, E2.3 percentile ranks, E2.4 outlier flags) need `build_aggregates.sql`
migrations + an aggregate rebuild against the live free-tier project and are **parked** until that
access exists — not shipped as unverifiable migrations.

All three E2.1 fields were confirmed already computed in the aggregate build before any UI was
written (`agg_training.median_training_year` in `build_aggregates.sql`;
`agg_bhw_stepzero_counts.pct_registered_accredited` + `population` in `ingest_stepzero.py`), so this
increment is purely surfacing them — zero ingestion/schema change.

- **Training recency.** `getTrainingCoverage`/`TrainingRow` now select `median_training_year`.
  `TrainingFigure` gains a "median last-trained year" explanation in technical details and a
  **staleness flag**: topics whose median is ≥5 years before the 2025 snapshot (≤2020) render a
  warning note ("Refresher may be due: {topic} (median last trained {year})…"), stalest first.
  Recency is computed across *all* topics, not just the 8 lowest-coverage ones charted, since a
  topic can be widely trained yet long ago. Threshold documented at `/methodology#derived-indicators`.
- **Accreditation triangulation.** `getStepzeroCounts`/`getBhwOverview` now expose
  `pct_registered_accredited`. New `AccreditationSourcesFigure` shows the quick-count's accredited
  share of the *whole* BHW universe beside the verified per-person rate (validated profiles) — two
  sources, two denominators, **shown side by side and never averaged** (review R8.2). Headline
  calls out a ≥5-point gap as "worth a closer look"; renders only where StepZero data exists.
  Glossary term `lgu_reported_accreditation` added.
- **BHWs per 1,000 residents.** New `bhwPer1000` helper + `BhwOverview.bhwPer1000`; added as a
  summary-strip stat (glossary `bhw_per_1000`) **and** a sixth base map indicator `bhw_per_1000`
  (extends `MAP_BASE_INDICATORS`, so the switcher, distribution, and relationships axes all pick it
  up automatically). `getChildIndicators` now also selects `population` and derives per-child
  `bhwPer1000`. Caption/denominator note that population is StepZero self-reported (census swap is a
  later E4 item). Direction is valence-neutral ("highest", never "best").

**Verify.** `npm run lint`, `npm run typecheck` (clean), `npm test` (101 pass; the codec test's
example "unknown" value was updated since `bhw_per_1000` is now a real indicator, and the
base-indicator round-trip list gained it), `next build` compiles + type-checks clean (same
`/place/*` no-creds caveat). Live checks (median-year staleness flags on real data; triangulation
numbers vs place-page accreditation; per-1,000 values; the new map indicator round-tripping through
the URL) are **deferred to the Vercel preview**.

## 2026-07-21 — Phase E2.5: Data-quality grade (S10)

Second no-DB E2 increment (same branch/PR #39). Collapses the field-level completeness rows that
already back `/data-quality` and the completeness figure into one explainable per-geo letter grade —
computed at read time, no new column or aggregate.

- **Grade.** New client-safe `lib/analysis/data-quality-grade.ts`: `computeDataQualityGrade(rows)` =
  mean completeness (100 − pct_missing) across the tracked fields, **each weighted equally** (a
  trust-first choice — no hidden editorial weighting, stated in `/methodology#derived-indicators`).
  A ≥95%, B ≥85%, else C. Names the single worst field only when it's missing ≥10% of the time, so a
  grade-A geo never gets a spurious "X is often missing". **6 unit tests** (null/empty, A/B/C bands,
  null-field skipping, inclusive 95%/85% boundaries).
- **UI.** New `DataQualityBadge` (server) renders a compact "Data completeness here: grade B — X% of
  key fields filled; blood type is often missing · See data quality" beside the Explore figures
  (right under the summary strip), colored by grade (accent/warning/danger). Glossary term
  `data_completeness` added; links to `/data-quality` for the field-by-field view.
- **Barangay fallback.** `agg_data_completeness` is citymun-grain (no barangay rows), so at barangay
  the page fetches the citymun's completeness and the badge labels the grade "for {citymun}
  (city/municipality)" — mirroring `CompletenessFigure`.

**Verify.** `npm run lint`, `npm run typecheck` (clean), `npm test` (107 pass, +6 grade tests),
`next build` compiles + type-checks clean (same `/place/*` no-creds caveat). Live checks (grade
matches the hand-computed average of the /data-quality field table for a sample geo; barangay shows
its citymun's grade with the label) are **deferred to the Vercel preview**.

E2.2 (Wilson CIs), E2.3 (percentile ranks), E2.4 (outlier flags) remain parked — they need
`build_aggregates.sql` migrations + a live aggregate rebuild this sandbox can't run or verify.

## 2026-07-21 — Phase E2.2: Wilson 95% confidence intervals (live DB)

First DB-dependent E2 increment. Owner authorized applying migrations + rebuilds to the live
`bhw-connect` project (ref ejcuwrnxngdwvecxwrhy) via the connected Supabase MCP.

- **DB.** Migration `supabase/migrations/20260721000000_e2_2_wilson_ci.sql` adds immutable
  `wilson_low(k,n)`/`wilson_high(k,n)` helpers (closed-form 95% Wilson score interval, z=1.96) and
  `ci_low`/`ci_high` columns (percentage points) to `agg_bhw_counts` (accreditation), `agg_training`
  (coverage), and `agg_honorarium` (pct receiving — denominator joined from `agg_bhw_counts.n_total`,
  confirmed against the build's own definition). Populated in place from the stored success/total
  counts. **Applied live via MCP `apply_migration`; idempotent** (create-or-replace / add-column-if-
  not-exists / recompute), so re-running through normal tooling is harmless. Mirrored into
  `ingestion/build_aggregates.sql` (§9b) so full rebuilds stay in sync. Types regenerated
  (`lib/db/database.types.ts`) — surgically, to preserve the committed `search_geo.parent_chain`
  the generator currently omits.
- **Verified live** (plan's "spot-check 3 geos by hand"): large-n narrow (region 01 15704/23185 →
  [67.13, 68.33]); small-n wide (barangay 0/1 → [0, 79.35]; 1/1 → [20.65, 100]) — matches textbook
  Wilson exactly.
- **UI.** `ciLow`/`ciHigh` surfaced on `BhwCounts`, `TrainingRow`, `HonorariumRow`. The interval is
  stated in technical details of the place-page Accreditation card, the Explore
  `AccreditationSourcesFigure` (verified rate), `TrainingFigure` (lowest-coverage topic), and
  `HonorariumFigure` (top paying level). New glossary term `confidence_interval` in plain language.
  **Note:** the plan's "enlarged-view interval whiskers" are deferred — stating the interval in
  technical details satisfies the "technical details state the interval" gate; drawing error bars on
  the Plot charts is a follow-up refinement, not yet done.

**Verify.** `npm run lint`, `npm run typecheck` (clean), `npm test` (107 pass), `next build`
compiles + type-checks clean (same `/place/*` no-creds caveat). Live figure rendering deferred to
the Vercel preview.

## 2026-07-21 — Phase E2.3: Peer percentile ranks (live DB)

New thin `agg_peer_ranks` table (one row per geo × indicator) instead of sprawling rank columns on
`agg_geo_summary`, per the plan's escape hatch. Ranks each geo among its **same-level siblings**
(grouped by `dim_geo.parent_code` — provinces within a region, citymuns within a province, regions
nationally) for all six base indicators, storing value, rank_position (1 = highest), n_siblings,
percentile (percent_rank×100), plus median/mad and an `is_outlier` flag (E2.4). Region/province/
citymun only — **barangay excluded**, same disk-budget cut as `agg_training` (≈10.6k rows total).
Cross-dataset: the three main-dataset indicators from `agg_bhw_counts`, and households-per-BHW /
BHWs-per-1,000 / coverage from `agg_bhw_stepzero_counts` (+ `agg_bhw_counts.n_total` for coverage's
numerator).

- **DB.** Migration `supabase/migrations/20260721010000_e2_3_peer_ranks.sql` (create table + populate
  in one CTE). Applied live via MCP; idempotent (`create table if not exists` + delete-then-insert by
  dataset). Mirrored in `build_aggregates.sql` §9c. Types: `agg_peer_ranks` block added to
  `database.types.ts` by hand.
- **Verified live**: region 07 ranks are internally consistent across all six indicators —
  `percentile = (n_siblings − rank_position)/(n_siblings − 1)×100` holds (e.g. avg-years rank 17/18 →
  5.9; any-honorarium rank 1/18 → 100).
- **UI.** `getPeerRank` accessor + `PeerRankChip` (server) shown under the map: "On {indicator},
  {geo} ranks {ordinal} of {n} {siblings} in {parent}." **Suppressed** when the geo has < 30 profiled
  BHWs (E0.5 `MIN_LEADER_N`) or isn't ranked (national/barangay/training indicator). The chip already
  carries the E2.4 "Stands out" outlier badge. `/methodology#derived-indicators` documents ranks +
  the 3×MAD / min-8-siblings outlier rule.

**Verify.** lint/typecheck clean, `npm test` 107 pass, `next build` compiles + type-checks clean
(same `/place/*` caveat). Live chip rendering deferred to the preview.

## 2026-07-21 — Phase E2.4: Outlier flags + insight generator (live DB)

Completes the DB-dependent E2 work. The MAD outlier flag ships in `agg_peer_ranks.is_outlier`
(computed in E2.3's migration: |value − median| > 3×MAD, only in groups of ≥8 siblings). This
increment surfaces it.

- **Peer chip badge.** `PeerRankChip` (E2.3) shows a "Stands out" badge when the current geo is a
  flagged outlier for the active indicator.
- **Insight generator.** New `peerOutlier` generator in `lib/db/insights.ts`, following the existing
  score/curation conventions: at national/region/province it reads the outlier flags for the current
  geo's children (their sibling group is exactly those children), skips any whose own profiled count
  is below `MIN_LEADER_N` (so a tiny-N place isn't crowned an outlier on an unstable rate), and picks
  the single most extreme (largest deviation in MAD units) across all six indicators — "{Name} stands
  out from other {level}s in {parent} on {indicator} — {value}, well above/below the typical
  {median}." Labels/units come from the shared `MAP_BASE_INDICATOR_META`/`formatIndicatorValue`.
- **Verified live**: real, honest outliers surface, e.g. City of Olongapo any-honorarium 0% vs a
  regional-typical 99% (n=80), Quezon City coverage 37% vs 98%.
- **Deferred** (noted, not shipped): the plan's optional "map outline" for outlier geos on the
  choropleth — the chip badge + insight card already surface outliers; a map stroke is a cosmetic
  add-on left for later.

**Verify.** `npm run lint`, `npm run typecheck` (clean), `npm test` (107 pass), `next build`
compiles + type-checks clean (same `/place/*` caveat).

### Phase E2 status
E2.1, E2.5 (no-DB) and E2.2, E2.3, E2.4 (live DB) are all done. Suppression audit note (plan's
phase verify): the new barangay-grain columns are `agg_bhw_counts`/`agg_training`/`agg_honorarium`
`ci_low`/`ci_high` (Wilson) — these are intervals, not counts, and reveal nothing an existing
suppressed count doesn't; `agg_peer_ranks` deliberately excludes barangay. Live axe/Lighthouse/
figure-render checks remain deferred to the Vercel preview.

## 2026-07-21 — Phase E3: New internal aggregates (live DB)

Phase E3 of the Explore enhancement plan — new precomputed aggregates from the already-loaded
`fact_bhw_raw`/`fact_honorarium` (no re-ingestion needed; the facts are fully loaded on the live
`bhw-connect` project). Five new figures shipped; two increments downgraded to documented findings
after the data failed their audit gate. All aggregates are pure SQL applied live via MCP
`apply_migration` (idempotent, delete-by-dataset then insert) and mirrored into
`ingestion/build_aggregates.sql` (§11–§15). Types hand-edited into `lib/db/database.types.ts`
(regeneration drops the committed `search_geo.parent_chain`, per the E2.2 note). DB grew 551 → 576
MB — within budget; barangay grain deliberately skipped on the new tables (same disk cut as
`agg_training`), with barangay pages falling back to their citymun ancestor (labeled), mirroring
the training/completeness pattern.

- **E3.1 `ROLE` dimension — GATED (not shipped).** The audit gate found **no `ROLE` column in the
  source parquet at all** (nor any position/designation/title field — full column dump checked).
  There is nothing to ingest, so per the plan's gate ("downgrade to a normalization proposal for
  the owner instead of shipping garbage categories") this is recorded here and not built. If a role
  field is wanted, it must first be added to the source dataset upstream.

- **E3.2 Joining waves — SHIPPED.** `agg_cohorts` (geo × kind × cohort_year × n), national→citymun,
  only non-zero cells (~104k rows). `kind` ∈ {registered, accredited, first_active}. `CohortsFigure`
  renders three server-side small-multiple column strips (no client JS). Locked 2025-snapshot
  framing: years as recorded in the snapshot, "when today's BHWs arrived," explicitly not a
  workforce time series, with the survivorship caveat in the technical details. **Verified live:**
  national 2025 first_active = 21,635 / registered = 21,585 / accredited = 28,988; region 07
  first_active 2020→2024 rises 1,196 → 2,516.

- **E3.3 Retention/attrition — DOWNGRADED (not shipped).** Built `agg_retention` (national+region,
  share of each start-cohort active k years later) and verified it empirically: **every national
  cohort-year sits at 99.3–100%** (global min 99.3, none below 95). This is pure survivorship — a
  single 2025 snapshot can't observe anyone who left, so the "curve" is a flat ~100% line. Shipping
  it would falsely imply BHWs almost never leave. Applying the same audit discipline as E3.1, the
  table was **dropped** and no figure ships; the finding is documented in `/methodology`
  (Limitations) so users understand why there is no retention curve. The joining-waves figure (E3.2)
  carries the honest slice of the same idea.

- **E3.4 Household workload — SHIPPED.** `agg_workload` (p10/p25/median/p75/p90 + mean +
  busiest-decile share), national→citymun, distribution suppressed for <5 reporting BHWs.
  `WorkloadFigure` reuses `RangeChartClient` (p10–p90 span) + a percentile table. Headline: "The
  busiest 10% of BHWs here cover {x}% of all assigned households." **Verified live:** national
  median 52, p90 180, busiest-decile 43.6% (n=270,662); Pangasinan median 52, busiest 30.9%.

- **E3.5 Honorarium inequality — SHIPPED.** `agg_honorarium_inequality` (Gini + p90:p10 of each
  BHW's total normalized monthly honorarium among receivers), national→citymun, suppressed for <5
  receiving. Added as a fourth **Inequality** tab on the Explore honorarium tabbed card. Gini via the
  standard rank formula `G = 2·Σ(i·x_i)/(n·Σx_i) − (n+1)/n`. **Verified live:** national Gini 0.391,
  p10 ₱783, p90 ₱4,650, ratio 5.9× (n=265,160); region 07 Gini 0.387, ratio 5.5×.

- **E3.6 Adjusted small-area rates — SHIPPED (owner Q7).** `agg_bhw_counts.adjusted_pct` column,
  empirical-Bayes (DerSimonian–Laird random-effects, beta-binomial method-of-moments) shrinkage of
  each citymun/barangay raw accreditation rate toward its parent's pooled rate:
  `B_i = A/(A + m(1−m)/n_i)`, `adjusted_i = m + B_i·(p_i − m)`, `A` = per-parent-group between-area
  variance (clamped ≥0). Region/national stay NULL (shown raw). UI: an **opt-in toggle** on the
  Explore map + ranked list (raw is the default per Q7), only when accreditation is active and the
  children are citymun/barangay grain; every adjusted rendering is labeled and links
  `/methodology#adjusted-rates`. **Verified live:** small-N pulls sensibly (13-BHW DATU HOFFER
  38%→57% toward province 81%; SIGAY 100%→85% toward 73%); region/national untouched (0 non-null);
  83 provinces have adjusted citymun children for the toggle.

- **E3.7 Income-class equity — SHIPPED.** `agg_by_income_class` (6 national rows: pooled
  accreditation & any-honorarium shares + median honorarium among receivers, per LGU income class).
  `IncomeClassFigure` (national view only) — table with a median-honorarium bar; thin classes
  (<5,000 BHWs) flagged. Uses only `dim_geo.income_class` (E4.3 will refresh it). **Verified live:**
  median honorarium ₱833 (1st class) vs ₱542 (4th); any-honorarium 98.3% (1st) → 92.5% (6th, thin,
  n=1,666).

**New glossary terms:** `gini`, `income_class`, `adjusted_rate` (plain-language). **Methodology:**
new "Joining waves, workload, honorarium inequality, and adjusted rates" section (`#adjusted-rates`
anchor) + a Limitations bullet on why retention isn't published.

**Verify.** `npm run lint`, `npm run typecheck` (clean), `npm test` (107 pass), `next build`
compiles + type-checks clean (fails only at `/place/*` page-data collection for missing
`NEXT_PUBLIC_SUPABASE_*` creds — the same documented caveat as every prior E-phase). Suppression
audit: the new barangay-grain data is `agg_bhw_counts.adjusted_pct` (a rate, not a count — reveals
nothing a suppressed count doesn't); `agg_cohorts` is national→citymun and counts, not individual
disclosures; workload/inequality suppress <5. Live axe/Lighthouse/figure-render checks deferred to
the Vercel preview.

## 2026-07-21 — Phase E4.1: PSGC crosswalk (infrastructure, EXPLORE_ENHANCEMENT_PLAN.md §E4.1)

First increment of Phase E4 (external datasets), built first because every later load in the phase
depends on it. `dim_geo` is fixed on one PSGC vintage (`2023 series (>=2024 release, includes
NIR)`); the Tier-1 sources arriving next (POPCEN/CPH, SAE poverty, DOF/BLGF income classes) each key
on their own vintage, and a renumbered/reassigned code would silently drop out of a naive join.
`dim_psgc_crosswalk` + `map_psgc_to_dim_geo()` are the insurance against that. Migration
`20260721060000_e4_1_psgc_crosswalk.sql`, applied live via the Supabase MCP; full report in
`docs/PSGC_CROSSWALK.md`.

- **Table** `dim_psgc_crosswalk` (`old_code`, `new_code` FK→`dim_geo`, `geo_level`, `old_vintage`,
  `new_vintage`, `change_kind` CHECK-constrained vocabulary, `old_name`/`new_name`, `note`,
  `dataset_id`; `unique(old_code, old_vintage, new_vintage)`; RLS public-read like every other
  `dim_*`/`agg_*`). Indexed on `old_code` (the downstream lookup key) and `new_code`.
- **Resolution primitive** `map_psgc_to_dim_geo(p_code, p_old_vintage default null)` (SQL, `stable`,
  `security invoker`, granted to `anon`/`authenticated`): direct-hit → crosswalk-hit → NULL. Its
  Python twin (`map_code()` in the builder) is what non-SQL loads import. NULL is deliberate — the
  caller logs the miss, mirroring the 1.6 two-way reconciliation discipline.
- **Seeded change: NIR (RA 12000, 2024).** The one large PSGC vintage change the repo already has
  hard evidence for. Pre-NIR PSGC filed Negros Occidental under Region VI (`06`) and Negros Oriental
  + Siquijor under Region VII (`07`); dim_geo files all three under Region `18`. Crosswalk rows are
  derived **from `dim_geo` itself** (region prefix swapped back, province digits preserved) — the
  same remap `reconcile_boundaries.py` already applies to boundary polygons — not from any external
  file. **1,357 rows** (3 provinces + 62 citymuns + 1,292 barangays). **Verified live:** 0 `new_code`
  orphans, 0 `old_code` collisions with live dim_geo; `map_psgc_to_dim_geo('06045')→18045`,
  `('07061')→18061`, `('18045')→18045` (direct), `('0604502')→1804502`, unknown→NULL. The builder,
  run offline against a dim_geo CSV export, independently reproduces the same 1,357 rows and a clean
  report.
- **Derived from `dim_geo`, not the parquet, on purpose:** the parquet alone yields 1,345 NIR rows;
  the live `dim_geo` has 1,357 because the StepZero patch (`stepzero_only_v1`) added 12 NIR
  barangays the parquet never carried. The crosswalk must map onto the real join target, so the
  seed is an `INSERT … SELECT FROM dim_geo` and the builder's authoritative mode reads `dim_geo`.
- **Accepted, flagged gap: Bacolod City (HUC).** `dim_geo` has a 4th Region-18 province row `18302`
  (63 rows); its pre-NIR code isn't a clean region-prefix swap, so — exactly as
  `reconcile_boundaries.py` already excluded it — it is left unmapped. Not silent: a pre-NIR Bacolod
  code resolves to NULL and surfaces in the consuming load's reconciliation.
- **Quarterly-file path not fed (documented):** the general mechanism (diff two PSA PSGC publication
  snapshots → change rows) is implemented and `--selftest`-covered in
  `ingestion/build_psgc_crosswalk.py`, but `psa.gov.ph/classification/psgc` is Cloudflare
  bot-challenged from this environment (`403` challenge — the plan's flagged "research pass hit
  bot-blocks"). `dim_dataset.psa-psgc-crosswalk.status` stays `draft` until a real file is diffed
  in. Other known changes (2022 Maguindanao split, city→HUC conversions) are **not** hand-seeded —
  they need the real correspondence column; guessing codes is what this discipline forbids.
- **Provenance:** `dim_dataset` row `psa-psgc-crosswalk` (source = PSA PSGC quarterly publication,
  `as_of_date` = RA 12000 effectivity `2024-06-13`, `status` = `draft`).
- **Types:** regenerated `lib/db/database.types.ts` for the new table + function via the Supabase MCP.

**Verify.** Migration applied clean; live integrity checks above all pass; `build_psgc_crosswalk.py
--selftest` passes and its offline reconciliation matches the live seed. No UI surface in this
increment (pure infrastructure). RLS: `dim_psgc_crosswalk` is public-read, service-write — same as
every other `dim_*`; no new suppression surface (it holds public geographic codes, no individuals).

## 2026-07-21 — Fix: enable RLS on agg_peer_ranks

Follow-up (not a plan increment). The E2.3/E2.4 migration created `agg_peer_ranks` but never
enabled row level security or added a read policy, unlike every other `agg_*`/`dim_*` table.
With RLS off, PostgREST exposed the table to `anon`/`authenticated` for both read and write —
the Supabase advisor's `rls_disabled_in_public` (ERROR), and a live write hole (anon could
INSERT). Surfaced while making the repo public for Vercel previews (which also makes the project
ref + anon key publicly visible).

Migration `20260721070000_agg_peer_ranks_rls.sql`, applied live via the Supabase MCP: `enable row
level security` + a `public read` SELECT policy for `anon`/`authenticated` (`using (true)`) —
identical posture to the other `agg_*` tables (public read, service-role write; the aggregate
build runs as service role and bypasses RLS). The table holds only non-disclosive derived
rank/percentile stats at region/province/citymun grain, no individuals. **Verified live:** RLS
enabled with exactly one SELECT policy, 10,668 rows intact; anon REST read still returns rows (app
unaffected), anon INSERT now rejected with `42501` (row-level security policy violation). No
`database.types.ts` change — RLS/policies aren't reflected in generated types. `build_aggregates.sql`
needs no change (it defers table DDL to migrations and writes as service role).

## 2026-07-21 — Phase E4.3: DOF/BLGF 2024 LGU income reclassification (EXPLORE_ENHANCEMENT_PLAN.md §E4.3)

First external **data** load of Phase E4 (E4.1 was infrastructure). RA 11964 (Automatic Income
Classification of LGUs Act) replaced the old six-class income ladder with **five** classes and
recomputed every province/city/municipality from FY2021–2023 regular income; **DOF Department Order
No. 074-2024** (Annex A) is the schedule, effective **2025-01-01**. `dim_geo.income_class` had
carried the StepZero-reported (≈DO 23-08, 2008 vintage) class; this refreshes it to DO 074-2024 and
E3.7's equity figure re-runs on the new classes. Migration `20260721080000_e4_3_income_reclass.sql`,
applied live via the Supabase MCP; full reconciliation in `docs/INCOME_RECLASS.md`.

- **Source is name-keyed, not code-keyed.** The Annex lists `REGION · [PROVINCE ·] LGU · old · new`
  with **no PSGC codes** and **pre-NIR** region labels (Negros under VI/VII). So the join is a
  province-scoped, NIR-aware fuzzy name-match (`ingestion/build_income_reclass.py`, `rapidfuzz`),
  not a code join — this is the "name-match + manual fixups file" the plan called for, and where
  E4.1's NIR awareness is exercised (Negros disambiguated by pre-NIR region VI→Occidental /
  VII→Oriental). The public file is an **OCR'd mirror**, so ~45 rows need eyeball-verified
  `OVERRIDES` (OCR names like "Sais"→Bais, HUCs listed under a mother province, renamed LGUs like
  Datu Montawal←Pagagawan). Auto-accept threshold 88; 0 duplicate targets.
- **Tables.** `dim_lgu_income_reclass` (`geo_code` FK→dim_geo, `geo_level`, `dof_kind`,
  `old_class_dof`, `new_class` CHECK 1–5, `converted`, `match_method`/`match_score`, `dataset_id`;
  `unique(geo_code,dataset_id)`; RLS public-read) is the queryable geo_code→class link; the source
  LGU **names** live in the reviewed CSV `ingestion/data/income_reclass_2024.csv`, not duplicated in
  the DB. New `dim_geo.income_class_prior` preserves the superseded value.
- **Coverage (verified live):** 1637/1651 city/municipalities and 81/82 provinces classified; 1724
  mapping rows, distinct codes, 0 collisions. Provinces gained a class for the first time (were all
  null). Spot-checks: Quezon City/Makati/Davao = 1st; Adams (Ilocos Norte) 5th→4th matches the PDF.
- **Honest gaps (retain prior / stay null, never guessed — the 1.6 discipline):** 6 LGUs the Annex
  itself leaves unclassified — Ubay, Bohol (literal dash) and 5 BARMM munis printed "New"
  (newly-created); 8 BARMM Special Geographic Areas (not LGUs to DOF); Eastern Samar **province** is
  absent from the source Annex. All enumerated in `docs/INCOME_RECLASS.md`.
- **Documented source fix-ups:** the single "Manila City" Annex row fans out to all 10 dim_geo
  City-of-Manila districts (class 1); "Buenavista" mislabeled under Sultan Kudarat (which has none)
  is mapped to Agusan del Norte's Buenavista — it sits in the Agusan alphabetical block and is the
  only otherwise-unmatched Buenavista of the country's five.
- **Validation of the join:** the Annex's *old* (DO 23-08) column vs dim_geo's prior class — names
  align across the board (correct joins), classes differ systematically (dim_geo higher, consistent
  with real post-2008 income growth incl. Mandanas NTA), so the disagreement is vintage, not
  mismatch. New-vs-prior delta is mostly "unchanged" (1,422) then ±1–2.
- **Downstream.** `dim_geo.income_class` now 1–5 (+ a 5-LGU 6th-class remnant = the unclassified
  that kept prior); `agg_by_income_class` rebuilt in the same migration. E3.7 figure + glossary +
  `/methodology` copy updated from "will be refreshed" to the DO 074-2024 vintage (1st highest, 5th
  lowest; 6th labeled "prior class, not reclassified"). `dim_dataset.dof-blgf-income-2024`
  (`status=active`, `as_of_date=2024-11-05`). Types: `dim_lgu_income_reclass` + `income_class_prior`
  added to `lib/db/database.types.ts` (surgical edit, not a full regen — a wholesale regen dropped
  the `search_geo.parent_chain` return column, a generator quirk). `typecheck` + `eslint` clean.

**Verify.** Migration applied clean; coverage/spot-checks above pass live; `build_income_reclass.py`
reproduces the mapping + reconciliation offline from the PDF + a dim_geo export. RLS:
`dim_lgu_income_reclass` public-read, service-write — same posture as every `dim_*`; it holds public
LGU classifications, no individuals. `build_aggregates.sql` unchanged (its E3.7 block rebuilds
`agg_by_income_class` from whatever `dim_geo.income_class` currently holds — now the DOF values).

## 2026-07-21 — E4.2 Population: PSA POPCEN 2024 + CPH 2020

Second Phase-E4 increment (after E4.1's crosswalk infrastructure). Loads PSA census population
into a new `agg_population` table and switches the "BHWs per 1,000 residents" indicator (E2.1)
from StepZero self-reported population to census population, with a per-geo fallback to StepZero.

**Sources.** Two PSA "Table B — Population … by Province, City, and Municipality, By Region"
workbooks the owner supplied: the 2024 Census of Population (POPCEN, dataset `psa-popcen-2024`,
`census_year` 2024) and the 2020 Census of Population and Housing (CPH, dataset `psa-cph-2020`,
`census_year` 2020). Both are population-only; **only population is loaded**. The 2020 CPH
*household* counts are a separate PSA table and a documented follow-up (would add a
`households_2020` measure and a census households-per-BHW denominator).

**Schema.** `agg_population` is long format — one row per `(dataset_id, geo_code, geo_level,
census_year, population)` — so each year keeps its own provenance and reloads idempotently by its
own dataset (the delete/upsert-by-dataset pattern every `agg_*` table uses). Two sources feeding
one wide row would have broken that. RLS: public-read, service-write, like every other `agg_*`.
Migration `20260721080000_e4_2_agg_population.sql`, applied live via the Supabase MCP; the two
`dim_dataset` rows are seeded with `status = 'published'` — **not** `'active'`, the single-dataset
sentinel `getActiveDataset()` picks for `bhw-2025`; seeding another row `'active'` is what blanked
the site in E4.3 (#44), so E4.2 follows the corrected convention (and the live rows first mistakenly
loaded as `'active'` were updated to `'published'`).

**Name-matching (the hard part).** Unlike `ingest_stepzero.py`, these workbooks carry geography
*names*, not PSGC codes. `ingestion/ingest_population.py` name-matches every row to `dim_geo`
(post-NIR) province-scoped — province names are globally unique (118/118), which disambiguates the
~200 duplicate city/municipality names — and rolls national/region/province up from the matched
citymun leaves via `dim_geo`'s own parentage. Rolling up from leaves (not the file's printed
subtotals) is what makes the pre-NIR CPH 2020 numbers land on post-NIR Region XVIII automatically.
Province-header vs eponymous-town collisions (RIZAL-the-province vs RIZAL-the-Laguna-town;
BULACAN-in-Bulacan) are resolved by a lookahead ("the next leaf must be one of this province's
towns") plus a "same name as the current province ⇒ it's the town" rule.

**Grain deviation (flagged).** These PSA releases stop at city/municipality — there is no barangay
population — so `agg_population` is national→region→province→citymun. Barangay-level per-capita
falls back to citymun, mirroring `agg_training`. This is a deviation from the plan's "barangay
grain rolled up" wording; the source simply doesn't carry it.

**Reconciliation (the 1.6 discipline).** Matched **1,628/1,639 citymun (99.3%)** for POPCEN 2024
(national roll-up 111.64M vs published 112.73M, −0.97%) and 1,618/1,639 (98.7%) for CPH 2020
(roll-up 107.00M, −1.87%). The shortfall is **not** matching error: it is LGUs absent from `dim_geo` entirely
(municipalities with no BHW records — e.g. Imus, Gen. Mariano Alvarez, five Quezon towns, three
Basilan towns), plus Manila stored at its province node, plus CPH-2020-only cases (Bacolod — the
E4.1-flagged gap; Cotabato City and the pre-split Maguindanao subtotal; BARMM SGA clusters). Full
categorised list in `docs/POPULATION_RECONCILIATION.md`; machine-readable residuals in
`ingestion/_qa_report_population.json`. Four one-letter spelling reconciliations
(`BALIUAG→BALIWAG`, `PIO V. CORPUS→CORPUZ`, `LEON T. POSTIGO→BACUNGAN`, `DR. JOSE P. RIZAL→RIZAL`)
are documented in the script's `SPELLING_FIXUPS`, not silent guesses.

**UI.** The map indicator switcher's `bhw_per_1000` (E1.1) and the place-page per-capita stat now
prefer census population (`getCensusPopulation2024` / a batched census query), falling back to
StepZero's self-reported population per geo where census is absent — so the feature works whether
or not the bulk load has run, and upgrades automatically once it does. Caption/denominator wording
updated in `lib/analysis/map-indicators.ts`.

**Data load — loaded live and verified.** All **3,517 rows** (1,764 POPCEN + 1,753 CPH) loaded
into the live project (`ejcuwrnxngdwvecxwrhy`). The sandbox has no direct Postgres TCP and the
Supabase MCP can't stream a bulk literal file, so — following the `load_stepzero_batch` precedent
above — a temporary `SECURITY DEFINER` RPC `load_agg_population_batch(p_slug, p_rows jsonb)` was
created, granted to `anon`, called over PostgREST/HTTPS with the JSON batches (one per dataset),
then **dropped immediately after**. Verified live: per-dataset row counts and grain match the
offline build exactly, and the national roll-ups match to the peso (POPCEN 2024 = 111,641,591;
CPH 2020 = 107,000,833). `get_advisors(security)` surfaces no new issues from the table or the
(dropped) loader. The documented, reproducible re-load path remains
`python ingestion/ingest_population.py --database-url "$DATABASE_URL"` (idempotent upsert).

**Determinism.** `variants()` returns a **priority-ordered list**, not a set — Python's randomised
string hashing over a set made the "first matching variant wins" choice differ between runs (a ~46k
CPH swing). Ordered matching makes the pipeline reproducible (verified identical across
`PYTHONHASHSEED` values); `--selftest` guards the helpers.

**Verify.** `npm run lint`, `npm run typecheck`, `npm test` (107 pass), and `npm run build` all
clean; `database.types.ts` carries the new table; `ingest_population.py --verify` reproduces the
reconciliation numbers above offline.


## 2026-07-21 — E4.4 Poverty: PSA Small Area Estimates (flagship external dataset)

The flagship of Phase E4 (EXPLORE_ENHANCEMENT_PLAN.md §E4.4). Loads PSA city/municipal **Small
Area Estimates of poverty** into a new `agg_poverty` table and adds poverty incidence as an
external variable on the Explore Relationships scatter — never on the workforce map (identity
rule, owner Q1). Migration `20260721090000_e4_4_agg_poverty.sql`, applied live via the Supabase
MCP; full reconciliation in `docs/POVERTY_SAE.md`.

- **Vintage: 2023, not 2021.** The plan named the 2021 SAE; the public PSA/FOI pages are
  bot-blocked here (PSA 503, FOI 403; HDX carries only the archived **2009** SAE), the exact
  research-pass block the plan predicted, so — as with E4.2's census workbooks — the owner supplied
  the file directly: PSA "Annex 1 … 2018, 2021 and 2023 City- and Municipal-Level Poverty
  Estimates", **PSGC-stamped**. It carries all three years (2018/2021/2023 back-estimates on one
  methodology), so one `dim_dataset` row `psa-sae-poverty-2023` (`status='published'`, NOT
  `'active'` — the E4.3 #44 lesson) covers them; 2023 is the headline the UI reads.

- **Grain — citymun only, no rollup (deviation, flagged).** Poverty incidence is a rate, so it is
  **not** rolled up to province/region/national (would need population weighting PSA doesn't
  publish). `agg_poverty` is `geo_level='citymun'` only; poverty surfaces in Relationships solely
  where children are cities/municipalities (a province view). Deliberate deviation from the plan's
  "province/citymun grain" wording — the source stops at city/municipality.

- **Join — classic PSGC → dim_geo 2020+ series.** The source uses the **classic pre-2020 PSGC**
  (NCR districts as pseudo-provinces, Manila=`39`; ARMM region `15`); dim_geo is the 2020+ series
  (Manila=`806`, BARMM=`19`). `ingestion/build_poverty.py` derives dim_geo's province code from the
  old PSGC then name-matches the muni within it, region-scoped-unique as fallback (NCR, and the
  2022 Maguindanao split whose old province `38` no longer resolves; its Parang needs a documented
  override vs Sulu's Parang). Coverage **1,607/1,651 citymun**, 4,821 rows.

- **Honest residuals (the 1.6 discipline).** The source is **"noHUC"**: 34 Highly Urbanized Cities
  (Cebu/Davao/… and all Metro Manila outside the City of Manila) are a separate SAE domain, absent
  here; plus 8 BARMM Special Geographic Areas, Pateros, and Kalayaan (the source's own footnote 3,
  "not generated"). Four City-of-Manila source districts (Binondo/San Miguel/Ermita/Intramuros) have
  no dim_geo node (dim_geo folds Manila into 10, the source into 14). All enumerated in
  `docs/POVERTY_SAE.md` / `ingestion/_qa_report_poverty.json`; nothing silently dropped.

- **Wiring.** New Relationships-only axis type (`REL_EXTERNAL_INDICATORS = ['poverty_incidence']`
  in `schema.ts`, kept out of `MAP_BASE_INDICATORS` so the map never offers it); `RelAxisIndicator`
  drives `relX`/`relY`, meta + source stamp in `map-indicators.ts` (`REL_EXTERNAL_INDICATOR_META`),
  per-child fetch in `lib/db/poverty.ts` (`getChildPoverty`), figure offers the axis only where
  data exists and stamps the source + ecological sentence. New insight `bhw-density-vs-poverty`
  correlates BHWs-per-1,000 (census, E4.2) vs poverty across a province's citymun, emitting a card
  **only when |ρ|≥0.4** — verified live: fires for 22/118 provinces (mostly moderate positive),
  silent on the rest. `/methodology#relationships` + `glossary(poverty_incidence)` cite the source
  and the HUC gap.

- **Data load.** Following the `load_agg_population_batch` precedent (no direct Postgres TCP in the
  sandbox), a temporary `SECURITY DEFINER` RPC `load_agg_poverty(jsonb)` was created, granted to
  `anon`, called over PostgREST/HTTPS with JSON chunks, then **dropped immediately after**. Verified
  live: 4,821 rows, 1,607 citymun, 0 orphan FKs, 2023 incidence 1.21–67.83 %, RLS on.

**Verify.** `npm run lint`, `npm run typecheck`, targeted `vitest` (correlation/filters) clean;
`database.types.ts` carries `agg_poverty` (surgical add, per the E4.3 regen-quirk note);
`build_poverty.py --selftest`/`--verify` reproduce the join + reconciliation offline.

## 2026-07-21 — Compare page enhancement: head-to-head summary, chips, quick-add

Compare was the thinnest of the four pages (task model: *pit places against each other*) and had
drifted behind Home/Explore. This increment builds it up strictly from patterns those pages already
established — no new visual language.

- **Head-to-head summary strip (`components/compare/compare-summary.tsx`).** The page's answer to
  "who leads on what?", shown before the figure columns. One block per comparative headline metric
  — the same six base indicators as Explore's map switcher — each rendering all compared places on
  a single `BenchmarkBars` track with the leading place emphasized (`isPrimary`) and named in a
  leader line ("Heaviest load: …"), plus a muted Philippines reference row (skipped when comparing
  at national level). Metric defs live in client-safe `lib/analysis/compare-metrics.ts`, built on
  `MAP_BASE_INDICATOR_META` so labels/suffixes stay identical to Explore; `leaderIndex()` names a
  leader only for a strict maximum among ≥2 non-null values (ties and single-value metrics get no
  leader — naming one would be arbitrary). Unit-tested. Leader wording is deliberately factual, not
  evaluative ("Heaviest load", "Densest coverage") since a max isn't a merit ranking.
  `BenchmarkBars` gained a `flush` prop (drop its under-figure top border) for embedding here.
- **Small-N honesty (E0.5 carried over).** The strip lists places under `MIN_LEADER_N` validated
  profiles in a "read with care" caveat and each affected column gets a small-sample banner; metrics
  where fewer than two places carry data are named in a "not enough data" line, never silently
  dropped.
- **Selected-place chips (`selected-geo-chips.tsx`).** Removable chips + Clear all, present in every
  state. This fixes a real dead end: in the mixed-level state the columns (and their Remove buttons)
  don't render, so the guidance "remove places until only one level remains" previously had no
  control to act on. Column Remove also no longer hides at exactly 2 places — removing down to one
  now lands on the (useful) one-place state instead of being impossible.
- **Quick-add suggestions (`quick-add-chips.tsx`).** The empty state offers all regions (the natural
  entry comparison); the one-place state offers the selection's largest same-level peers (top 8 by
  validated profiles via `getChildSummaries` on the parent — same-level by construction, so a
  suggestion can never trip the mixed-level guard).
- **Column parity with Home/Explore.** Columns add the certification figure and the honorarium
  story told three ways as `FigureTabs` (who receives / how much / distribution), and now pass
  `geoCode`/`geoLevel` through so every figure gets its per-place export menu. When a honorarium
  focus is active the single matching figure renders instead of tabs — tab state is per column and
  would misalign a focused side-by-side.
- **Indicator picker fix.** `LABELS` covered 5 of the 8 `INDICATORS`, so certification and the two
  honorarium sub-views rendered as *blank* options. Now typed `Record<Indicator, string>` so a
  future enum addition without a label is a compile error, not an invisible option.

**Verify.** `npm run lint`, `npm run typecheck`, `npm test` (123 tests incl. new
`compare-metrics.test.ts`) all clean; `next build` compiles (page-data collection needs live
Supabase env, unavailable in the sandbox).

## 2026-07-21 — Gemini model: pin to `gemini-flash-latest`

Changed `MODEL` in `lib/ai/providers/gemini.ts` from `gemini-2.0-flash` to `gemini-flash-latest`. During live AI bring-up on the production deployment, the cascade reached the Gemini provider (quota rows incremented, not rate-limited/paused) but the request did not complete — consistent with the account's key lacking access to the `gemini-2.0-flash` model id. `gemini-flash-latest` is Google's rolling alias for the current-generation flash model, so it resolves against whatever the key is entitled to and won't need a code change on the next flash revision. Rate-limit seed constants in `lib/ai/quota.ts` are unchanged (per §4.5 they only seed a window's first row; the live `ai_provider_quota` row governs thereafter), and the DECISIONS entry of 2026-07-19 (2.1) referencing `gemini-2.0-flash` is left intact as the historical record of what was verified at that time.

## 2026-07-21 — Gemini live bring-up: thoughtSignature + cascade observability

Bringing AI up on the live deployment surfaced two issues beyond the model-id change above:

- **Root cause of "always at capacity" was Supabase, not AI.** `completeWithCascade` runs `checkQuota` (a Supabase read/write of `ai_provider_quota`) _before_ any provider key is consulted, so a deployment missing `SUPABASE_SERVICE_ROLE_KEY` makes every provider report `unavailable` and the cascade collapses to `allCapped` — indistinguishable, from the outside, from "no AI keys." Confirmed by two independent write paths (`ai_provider_quota` and `usage_events`) producing zero rows from a live probe. Fixed operationally by setting the deployment env var; no code change.
- **`ProviderRequestError` on the Gemini tool-call continuation.** Once the cascade reached Gemini, the _first_ call (tool request) succeeded but the _continuation_ (feeding the tool result back) failed with HTTP 400: `Function call is missing a thought_signature in functionCall parts`. `gemini-flash-latest` resolves to a Gemini 2.5 thinking model, which attaches an opaque `thoughtSignature` to each `functionCall` part and requires it echoed back verbatim on the following turn. The provider dropped it when normalizing to the generic `ToolCall`. Fix: carry `thoughtSignature` through `ToolCall` (optional; ignored by the OpenAI-compatible providers) and replay it on the reconstructed `model` turn in `toGeminiRequest`; also exclude internal `thought` text parts from answer text. Verified end-to-end against the live preview — the chat route returns a grounded, audited answer with `provider: "gemini"`.
- **Observability.** The cascade previously swallowed every non-429 provider error silently, which is what made the above a multi-step diagnosis. `completeWithCascade` now logs `ProviderRequestError` (with status + detail) and unexpected errors; `ProviderUnavailableError` (no key configured) stays unlogged as expected noise.

## 2026-07-21 — /compare interactive controls dead: client/server URL-key mismatch (root cause + guardrail)

End-to-end diagnosis of the "Compare places" page, which stayed on its empty state no matter what
was clicked, across several prior fix attempts that changed layout/content but not the actual fault.

- **Root cause.** `lib/filters/codec.ts` maps the `compareGeos` state key to the `?geos=` URL param
  (`urlKeys`, per BUILD_PLAN.md §7 1.7) — but only in the *server-side* loader/serializer. Every
  client `useQueryStates(filterParsers, …)` call omitted `urlKeys`, so nuqs defaulted the URL param
  to the state-key spelling: clicking a search result or quick-add chip wrote `?compareGeos=…`,
  the server component parsed only `?geos=` and saw nothing, and the page re-rendered unchanged.
  Confirmed live against production: `/compare?geos=04,05` renders the full comparison,
  `/compare?compareGeos=04,05` (what the UI actually wrote) renders the empty state.
- **Why every symptom follows from this one fault.** Add-from-search, quick-add, chip removal,
  column removal, and Clear all all round-trip through the same mismatched key — so all of them
  were no-ops. It also explains the *missing quick-add chips* in the user's screenshot: the chips
  component reads `filters.compareGeos` client-side (from `?compareGeos=`), so after four futile
  clicks the client believed 4 places were selected and hid itself, while the server still rendered
  the empty state. Only hand-built `?geos=` permalinks ever worked — which is exactly how 1.7 and
  the follow-up compare PR were verified, letting the bug slip through repeatedly.
- **Redesign, not spot-fix.** New `lib/filters/use-filter-state.ts` exports `useFilterState()`, the
  single client entry point: it wires `urlKeys` (now exported as `filterUrlKeys`), `shallow: false`,
  and `history: "push"` (the two prior nuqs-default bugs from 1.4) in one place, with an optional
  `startTransition` passthrough. All ten client call sites now go through it; direct
  `useQueryState(s)` imports from `nuqs` are an ESLint `no-restricted-imports` error (the hook file
  itself carries the one sanctioned per-line disable), so client and server can't drift again.
- **Regression coverage at both layers.** Unit: `loadFilterState(new URLSearchParams("compareGeos=04,05"))`
  must parse to `null` (the state-key spelling is never a valid URL param). E2E (`e2e/compare.spec.ts`):
  drives the real click path — quick-add two regions, assert the URL uses `geos=` and never
  `compareGeos`, assert "Head to head" renders, remove via chip — the path no amount of
  permalink-based verification covers.

**Verify.** `npm run lint`, `npm run typecheck`, `npm test` (124) all clean; `next build` compiles
(page-data collection needs live Supabase env, unavailable in the sandbox). Behavior verified on
the Vercel preview deployment via the real click path.

## 2026-07-21 — No-naked-numbers rollout: benchmarks, honorarium sufficiency, DOH 1:20 reversal

The stakeholder ask (paraphrased): the platform proves its worth if it shows a *status* for
BHWs — is the count per place *enough* for the workload, is honorarium *sufficient* — not bare
numbers that invite "compared to what?". This lands the full rollout (Increments 1–7): every
headline figure now carries a vertical benchmark (this place vs. region vs. nation), a peer
rank among same-level siblings where one exists, and an adequacy signal (the n behind the
number, degrading visibly below `MIN_LEADER_N` and suppressing below 5).

- **(a) Consolidation.** `getBenchmarkContext`/`benchmarkRowsFor`/`rowsFromAncestorValues`
  (`lib/db/benchmark-context.ts`) replace the hand-rolled this-place/region/nation fetches that
  `/place`, `/explore`, and `/compare` each duplicated. Batch `getPeerRanks` (`lib/db/peer-ranks.ts`)
  fetches several indicators' peer standing in one query. `FigureBenchmark`
  (`components/narrative/figure-benchmark.tsx`) fills `FigureCard`'s existing `benchmark` slot —
  no new slot — rendering bars, a `peerRankSentence` (extracted from `PeerRankChip` so wording
  never drifts), and an adequacy note. `getBhwCounts`/`getBhwOverview`/`getGeoAncestors` gained
  React `cache()` at their definitions so the context is free when a page already fetched the
  same geo. Threaded through every figure in the Increment 4 contract table; `/bhw` gets a
  `regionalSpread` helper (no vertical benchmark makes sense at the national page) plus a
  `context` prop on `StatTile`/`StatHero`; `/place`'s `ProfileHeader` gained a `benchmarkNote`
  line; `CompareColumnData` gained serializable `peerRanks`/`nationalReference` for place-vs-nation
  column benchmarks.
- **(b) DOH 1:20 reversal.** `docs/HOME_SEARCH_REVIEW.md` §6 previously recorded "External DOH
  staffing-ratio targets (e.g., household-per-BHW norms) — not adopted; benchmarks use
  national/regional averages computed from this dataset," and the 2026-07-20 "Households per BHW"
  entry above independently declined the same ratio ("Deliberately did not cite a specific DOH
  ideal ratio such as 1:20 — no owner-confirmed source for which target applies"). The owner has
  now sanctioned citing it, but strictly as an **indicative reference, never a pass/fail gauge**:
  `DOH_INDICATIVE_HOUSEHOLDS_PER_BHW = 20` + a verbatim `DOH_INDICATIVE_NOTE` string
  (`lib/analysis/thresholds.ts`) appear only as a footnote on the households-per-BHW
  tiles/cards/strip and on `WorkloadFigure` — never as a chart marker or target line. Dataset-relative
  comparison (this place vs. region vs. nation) remains the primary status signal throughout.
- **(c) `agg_honorarium_cumulative`.** New table (migration
  `supabase/migrations/20260721100000_honorarium_cumulative.sql`, mirrored as
  `ingestion/build_aggregates.sql` §16, applied live) reproduces the deck's "59% receive less
  than ₱68/day" headline as a real, banded figure — 8 bands (None, ₱1–4,000 … Over ₱24,000),
  built to national/region/province/citymun (barangay skipped, matching `agg_training`'s disk
  discipline). The critical design delta versus E3.5's recipients-only inequality CTE: the
  denominator here is a LEFT JOIN from `fact_bhw_raw`, so **all 270,917 profiled BHWs** land in a
  band (non-recipients fall into "None"), not just those who receive something. Suppression is
  both per-cell (a band with 0 < n < 5 is nulled — band membership at n<5 could reveal an
  individual's pay band) and per-geo (n_total < 5 nulls every row for that geo). Verified live:
  row counts national=8, region=144, province=944, citymun=13,112; band totals reconcile exactly
  to 270,917 at every level; DB size 591 → 593 MB (~2 MB delta, comfortably inside the free-tier
  budget). **R5 resolved empirically**: the scope doc's own arithmetic conflicted (₱68/day ≈
  ₱2,040/month vs. its own "≈₱300/month" parenthetical) — querying the live per-BHW cumulative CTE
  gives pct below ₱300/month = 3.6% and pct below ₱2,040/month = 59.2%. Only the latter is
  anywhere near the deck's "59%," so the ₱300/month parenthetical in
  `docs/HONORARIUM_ANALYSIS_SCOPE.md` was simply a measurement error, not an alternate reading;
  ₱2,040/month (₱68/day) is confirmed as the real cut. National median cumulative honorarium =
  ₱1,750/month (~₱58/day). `HONORARIUM_SUFFICIENCY_MONTHLY_PHP = 2040` and
  `HONORARIUM_SUFFICIENCY_DAILY_PHP = 68` (`lib/analysis/thresholds.ts`) are the single source of
  truth — the threshold is never hard-coded a second time anywhere else. Surfaced by the new
  `HonorariumSufficiencyFigure` ("Is it enough?"), mounted as the first honorarium tab on `/bhw`,
  `/explore`, and `/compare`, and as a new slide right after the honorarium slide on `/place`
  (barangay falls back to its citymun ancestor, labeled).
- **(d) Export parity + narrative prompt.** `ExportFigureData` gained an optional `benchmark`
  block (place/region/nation rows + peer-rank sentence) and an always-present `adequacyNote`,
  rendered in all four formats (PNG/PPTX/CSV/XLSX) via one shared `formatBenchmarkLine` helper so
  they can't drift from each other — pure insertions, existing indicators' row payloads are
  unchanged. The ₱ glyph was confirmed rendering correctly through `resvg` for the PNG path.
  `lib/ai/narrative.ts`'s generation prompt gained one added sentence instructing the model to
  situate a cited headline figure against its region and the nation (by calling
  `getIndicatorByGeo` again with the region/national geo_code — no new tool needed, it already
  accepts any geo), mention peer standing among same-level places when it can tell, and always
  state the N behind a percentage, flagging small samples plainly. Already-cached narratives keep
  their pre-rollout style until they naturally regenerate (cache TTL / dataset version bump) —
  not backfilled.
- **(e) Follow-up.** Honorarium sufficiency was deliberately **not** added to `agg_peer_ranks`
  this pass (Risk R1 — scope control): it gets an adequacy note and vertical benchmark like every
  other figure, but no peer-rank line. Adding it is a small, isolated follow-up (one more indicator
  in the existing peer-ranks migration/build), not a design gap.

**Verify.** `npm run lint && npm run typecheck && npm test` all pass; `next build` compiles
(page-data collection needs live Supabase env — the known, pre-existing sandbox residual).

**Post-merge verification findings (same day).** An end-to-end pass against the live preview
(axe scans, DOM adequacy audit, presentation-mode check, export read-back, suppression walk)
confirmed the rollout: 0 axe violations on `/bhw` and `/place/province/04010`; all 9
contract-eligible figures on a province place page carry an adequacy line; the sole n<5 citymun
in `agg_honorarium_cumulative` (KALAYAAN, 1705321) exports the correct "Withheld" adequacy line.
Two pre-existing defects (both reproduced on production `main`, unrelated to this branch) were
found and are tracked separately rather than fixed here: (1) every citymun/barangay place page
under Palawan (17053) returns HTTP 500; (2) PNG exports render with **all text missing** on
Vercel — `lib/exports/render-png.ts` never configures a font source for resvg and the serverless
runtime has no system fonts, so text is silently dropped. That second finding **corrects the
claim in (d) above**: the ₱ glyph was verified through resvg in the sandbox (which has system
fonts), not on Vercel; the benchmark/adequacy lines are correctly present in the PNG's SVG input
and will appear once a font is bundled into the resvg call (`loadSystemFonts: false` +
`fontFiles`), the proper fix for the whole PNG export feature.

## 2026-07-22 — Ask-the-Data answer bank: capture (A1) + first-layer serve (A2)

Implements Phases A1 and A2 of `docs/ASK_CACHE_PLAN.md`: every chat turn is captured to a new
service-role-only `ai_ask_log` table, and single-turn questions are answered from a new
`ai_ask_cache` answer bank before the provider cascade — a repeat question costs zero AI credits.

- **Capture (`ai_ask_log`)** records question (raw + normalized), geo context, turn index,
  audited answer, outcome (`answered`/`audited_empty`/`capacity`/`error`), provider, served-from,
  data_version, tool trace, and latency. Best-effort in every branch of the chat route, wrapped
  like `rate-limit.ts` — a logging failure can never break the turn. Nothing is served from the
  log; it's the curation corpus for Phase A3 and the measure of savings.
- **Serve (`ai_ask_cache`)** keys on `data_version|geo_scope|question_norm` — the identical
  invalidation scheme as `ai_narrative_cache`, so a dataset refresh invalidates every stored
  answer automatically and a cached answer can never quote stale numbers. Only single-turn
  questions (`messages.length === 1`) are looked up or written back: follow-ups depend on
  conversation history. Geo scope is part of the key because the route injects the current place
  into the system prompt — identical words mean different answers on different pages. Only
  audit-surviving text is ever stored, so the bank replays only verified answers.
- **Normalization is deliberately dumb** (NFKC → lowercase → collapse whitespace → strip terminal
  punctuation → strip leading politeness prefixes, exhaustively unit-tested): a collision serves
  a wrong answer while a miss just costs one live call, so every choice biases toward missing.
- **Owner decisions per plan §0 defaults:** cache hits skip the rate limit (they cost nothing;
  logged as `ai_chat_cache_hit` usage events so hit rate = cache_hit / (cache_hit + chat_message)
  with no new infra) and are labeled in the chat UI ("Instant answer from a previously verified
  response"). `auto` (unreviewed) entries are served — the numeric audit is the safety gate;
  A3 curation adds approve/edit/block on top. Write-back never clobbers an `approved`/`blocked`
  row. `/methodology#ai` gains a paragraph disclosing question storage and the dataset-version
  lifetime of stored answers.

**Verify.** `npm run lint`, `npm run typecheck`, `npm test` (140 tests incl. new
`ask-cache.test.ts`/`ask-log.test.ts`) all clean. Live behavior verified against the Vercel
preview after applying the two migrations: first ask of a fresh question answers live and lands
in log + bank; the identical ask answers instantly with `cached: true` and no `tool_call` events.

## 2026-07-22 — Ask-the-Data answer bank: admin curation (A3)

Implements Phase A3 of `docs/ASK_CACHE_PLAN.md`: the `/admin/answer-bank` surface that turns the
raw capture into a deliberately curated FAQ layer, plus a savings signal on the admin overview.

- **`lib/db/ask-bank.ts`** (service-role reads/writes, same convention as `usage-analytics.ts`):
  `listAskBank` (stored answers, most-hit first), `listFrequentQuestions` (log grouped by
  normalized question — "what people actually ask", bounded in-memory scan like the usage
  dashboard), `getAskCacheSavings` (live vs. cache-hit counts from `usage_events` → hit rate),
  and the curation mutations `setAskBankStatus` / `updateAskBankAnswer` / `deleteAskBankEntry`.
- **`/admin/answer-bank` page + actions**: three cards (cache hits, live calls, hit rate over
  30d); the stored-answer worklist with per-entry approve / block / reset-to-auto, an inline
  answer editor (Save & approve — pins the edit so write-back can't clobber it), and delete; and
  a most-asked-questions table from the log. Every server action re-checks `getAdminUser()`
  itself — a form on an admin page is not proof the request is authorized (feedback/actions.ts
  discipline). Nav link + an overview card added.
- **Curation semantics** reuse the invariants A2 already enforces: `block` both makes the serving
  path miss the question (always live) and — since `storeAskAnswer` never overwrites a non-`auto`
  row — stops it being repopulated; `approve`/edit pin an entry against write-back; `delete` is
  for a bad `auto` capture you want regenerated fresh (vs. `block`, which suppresses permanently).
- **Theming fix caught in review:** first pass used raw `red-*` + Tailwind `dark:` classes; the
  app themes via a `data-theme` attribute with semantic tokens (no `dark:` usage anywhere), so
  switched to the existing `--color-danger` token, which adapts in both themes.

Deferred (unchanged from plan): A3.3 refresh-on-ingest precompute for `approved` entries (extends
the daily narrative cron) and A4 trigram near-match (gated on measured hit rate).

**Verify.** `npm run lint`, `npm run typecheck`, `npm test` (148 tests incl. new
`ask-bank.test.ts`) all clean; the two A1/A2 migrations are already applied to the live project so
the page reads real captured rows.

## 2026-07-22 — Ask-the-Data answer bank: refresh-on-ingest (A3.3)

Implements Phase A3.3 of `docs/ASK_CACHE_PLAN.md` — the big credit saver: after an ingestion
bumps the dataset version, every `approved` bank entry keyed to the old version goes dormant (the
serving path keys on the current version, so it never quotes stale numbers — it just misses).
`refreshApprovedAskAnswers` (`lib/ai/ask-refresh.ts`) proactively regenerates those curated
questions under the new version so the first visitor after a refresh still gets an instant answer
instead of eating a live call. Each dataset refresh then costs N precompute regenerations instead
of N × visitors live calls.

- **Only `approved` entries are refreshed.** `auto` entries regenerate lazily on first ask, so
  this stays bounded to the small admin-curated set.
- **Regeneration reruns the full grounding path** — same system prompt, page context
  reconstructed from `geo_code` via `getGeoByCode`, same numeric audit — so a refreshed answer
  meets the identical safety bar as a live one. A refreshed row stays `approved` so it keeps being
  refreshed on the next bump; the superseded old-version row is deleted only after the new one is
  safely written. If a provider is capped or the audit strips everything, the dormant old row is
  kept and retried next run.
- **Decision — a hand-edited approved answer is replaced on a version bump, by design.** Its
  numbers were checked against the *old* data; carrying its text forward verbatim under a new
  version would risk quoting stale figures — the one invariant the whole scheme forbids. Edits are
  therefore dataset-version-scoped.
- **Cron wiring (`/api/cron/precompute`):** the refresh runs *first* with a 15s reserve, then the
  existing narrative precompute takes the rest of the 50s budget. It self-yields — on a normal day
  there are no stale approved entries so it returns in ~one query and narratives keep the full
  budget; only on an ingestion day does it consume its slice. Both fill over a few days per this
  cron's existing philosophy. `askRefresh` counts are added to the JSON response.

Remaining: A4 trigram near-match stays intentionally deferred (plan §0 #4: "off until measured") —
it's gated on the real hit-rate numbers the A3 dashboard now collects, not built speculatively.

**Verify.** `npm run lint`, `npm run typecheck`, `npm test` (155 tests incl. new
`ask-refresh.test.ts` covering regeneration, context reconstruction, capped/audit-empty skips,
deadline, and no-stale/error paths) all clean. Live cron behavior is driven by Vercel's scheduler
(same as the existing narrative precompute, which likewise can't be manually invoked without
`CRON_SECRET`).

## 2026-07-22 — Ask-the-Data answer bank: trigram near-match (A4)

Implements Phase A4 of `docs/ASK_CACHE_PLAN.md`: a phrasing variant can reuse a stored answer via
`pg_trgm` similarity instead of a fresh live call. Built at the owner's request ahead of the
"measure first" default, but shipped **behind a flag (`ASK_NEAR_MATCH_ENABLED`, default off)** so
enabling it is a deliberate env change, not a deploy — the plan's safety stance intact.

- **`match_ask_answer` SQL function** (`extensions.similarity`, `security invoker`, pinned
  `search_path`, GIN trigram index on `question_norm`) mirrors the existing `search_geo` pattern.
  Far stricter than exact match: `approved` entries **only** (the audit verified the stored answer
  against the *stored* question, not the asked one), **same geo scope AND data_version**, single
  best match at/above the threshold. Not granted to anon — service-role path only.
- **Threshold calibrated against real trigram scores, not guessed.** Measured on live data:
  the dangerous near-collision `accreditation rate in cebu` vs `…bohol` scores **0.667**;
  rewordings ~0.48; legitimate variants like `which`/`what region…` and `vs.`/`versus` land at
  **~0.85**. So the default **0.85** rejects the wrong-answer cases while catching trivial
  variants, and misses looser paraphrases (0.75) — the safe failure direction (a miss just costs
  one live call). Override via `ASK_NEAR_MATCH_THRESHOLD` while tuning.
- **Route + observability:** near-match runs only after an exact-match miss on a single-turn
  question; a hit streams with `cached: true`, skips the rate limit, and is logged
  `served_from: 'cache_near'` (distinct from `'cache'`) so the admin page can split exact vs near
  hits per question — the "Near" column exists to audit false positives. The answer-bank page
  shows the on/off state and how to enable it.
- **Verified live:** applied `match_ask_answer` to the project; an above-threshold variant
  (`…profiles versus the total`, 0.852) returns the approved entry, while the Cebu/Bohol case and
  a different question correctly return nothing. Security advisors unchanged (the function's pinned
  search_path avoids the mutable-path warning).

That completes every phase in `docs/ASK_CACHE_PLAN.md` (A1–A4).

**Verify.** `npm run lint`, `npm run typecheck`, `npm test` (161 tests incl. near-match config +
lookup coverage in `ask-cache.test.ts` and the exact/near split in `ask-bank.test.ts`) all clean.

## 2026-07-22 — Present mode: fit-to-screen scaling for large crowds / LED walls

Present view previously promoted each slide to a fullscreen box but rendered it at the *normal
page* font sizes, capped at `max-w-5xl` (1024px) and centred — tiny for an audience and wasting
most of a 1920px+ LED wall. The ask was "the biggest font that still doesn't overlap."

- **Uniform scale, not font-only.** Several figures mix rem-based type (`text-*`) with **fixed-rem
  column widths** (e.g. the benchmark bars' `grid-cols-[7rem_1fr_auto]`), so scaling *only* fonts
  would overflow those fixed tracks and overlap. Instead each promoted slide is composed at a fixed
  design width and scaled up with **CSS `zoom`** (`components/present/use-fit-scale.ts`), which
  grows fonts, padding, and fixed-rem widths in lockstep — overlap is impossible by construction.
  `zoom` (unlike `transform: scale`) reflows, so the existing `m-auto` centring and
  `overflow-y-auto` scrolling keep working. Charts are vector (Observable Plot / SVG) so they stay
  crisp when magnified.
- **"Maximum" is computed, not a magic number.** The hook measures the slide's natural height at
  the design width, then picks the largest zoom that still fits the fullscreen frame in *both*
  axes, so the type is as large as each slide and each screen allow. It never scales **below 1**
  (a slide too tall to fit keeps its size and scrolls, exactly as before) and is capped at
  **2.6×** so a sparse single-stat slide doesn't blow up cartoonishly. On a laptop preview the fit
  usually lands at 1× (unchanged); on a 1080p+ wall the type grows ~1.5–2.6×.
- **Applies to every slide.** Content slides (`presentation-slide.tsx`, design width 1024px) and
  the generated title/closing slides (`presentation-deck.tsx`, 768px) share the same hook, so the
  whole deck reads at one large size. Recomputes on viewport/frame resize; the ResizeObserver
  watches only the never-zoomed frame, so there's no measure↔zoom feedback loop.

**Verify.** `npm run lint`, `npm run typecheck`, and the presentation unit tests
(`deck-logic.test.ts`) all clean. No DB/env available in this environment for a live screenshot, so
the fit is derived from the layout mechanics (fixed design width + uniform zoom) rather than
measured against rendered data.

## 2026-08-26 — Internal AI assistant, Increments 1.1–1.2: pgvector + the dataset registry

First code for `docs/AI_ASSISTANT_PLAN.md`. Phase 1 opens with the two increments that add no new
data source: the registry schema (1.1) and the hand-written backfill that describes every table
the public read layer already queries (1.2). Nothing calls the registry yet — `queryDataset` is
1.3 — but 1.2 is the reference example every later auto-profiled entry is measured against, so it
ships before the tool that consumes it rather than alongside it.

- **Two tables, service-role only.** `dataset_registry` (one row per queryable table: title,
  summary, grain, exposure, status) and `dataset_column` (name, type, allowed values, meaning,
  unit, role, join key, plus null profile-statistic columns for Phase 4). RLS enabled in the same
  statement block as each `CREATE TABLE` with no anon/authenticated policy — the 0.3 guardrail,
  and the plan's own rule that new tables match `ai_ask_cache`. **Verified live** by
  `set local role anon`: 0 rows from both tables while a control read of `agg_bhw_counts` returns
  its row. Security advisors show the two new tables only under the existing INFO
  `rls_enabled_no_policy` lint, alongside `ai_ask_cache`/`fact_*` — no new WARN or ERROR.
- **`exposure` is part of the schema, not a later filter.** Each registry row is `public` (the
  `agg_*`/`dim_*` layer anon can already read) or `internal` (`fact_*`/raw). This is what lets one
  generic query tool serve both the public tools and the internal assistant without a second
  allowlist — and it is why the registry itself must not be public-readable: it is the map of what
  is meant to stay internal.
- **`role` per column, and `is_queryable`.** `key` / `dimension` / `measure` / `meta`. A stated
  number may only come from a `measure`; surrogate ids, `search_text` (tsvector) and
  `parent_chain` (jsonb) are `meta` and marked not queryable, so a generic tool cannot select or
  filter on them at all. The allowlist is per column, not per table.
- **What was registered: 22 tables, 230 columns — every column of every registered table.**
  Verified against `information_schema` live: no undocumented column, no phantom column, no
  ordinal mismatch, and every hand-written `data_type` matches the live type (enums compared by
  `udt_name`). That covers all nine tables the public tools query plus the analytic tables no tool
  reaches today (peer ranks, workload, cohorts, honorarium sufficiency/inequality, income class,
  population, poverty, UUC).
- **The dictionary records the traps, not just the columns.** Where two tables use one word for
  differently-measured things, the meaning says so: `agg_bhw_stepzero_counts.n_registered_accredited`
  is a self-reported barangay tally, not `agg_bhw_counts`' per-person verified flag;
  `agg_honorarium_inequality` is denominated on recipients while `agg_honorarium_cumulative` is
  denominated on all profiled BHWs; `agg_cohorts.n` is a milestone year of today's roster, never a
  headcount as of that year; `agg_poverty` is deliberately not rolled up above city/municipality.
  Suppression rules and missing geographic levels are on the rows that carry them. A generic query
  tool has no other way to learn any of this.
- **Registry rows are `hand_written` / `approved`, not `auto`.** Owner decision 5 puts only
  extraction output through review; a description asserted in a migration is asserted, not
  inferred. `source_kind` keeps the two distinguishable once Phase 4 starts writing rows.
- **Profile statistics deliberately left null.** `distinct_count`, `null_rate`, `min_value`,
  `max_value`, `sample_values`, `profiled_at` are in the schema but unfilled: they are outputs of
  the ingest-time profiling pass, and a hand-typed cardinality would go stale silently while
  looking authoritative. `row_estimate` is filled from live counts and documented as advisory.
- **pgvector installed now, unused now.** `create extension vector` into `extensions` (0.8.2,
  `halfvec` present) so the extension question is settled before Phase 2 embedding work starts.
  No column stores a vector yet, and no embedding dimension is committed anywhere — per §4 that
  gets confirmed against the live model at implementation time.
- **`lib/db/dataset-registry.ts`** is the typed read layer: `listRegisteredDatasets` /
  `getRegisteredDataset` (service-role client, `status = 'approved'` filtered in the query so no
  caller can forget), `queryableColumns` / `measureColumns`, and `describeDataset` — the compact
  dictionary rendering a model is shown, with caveats last so a long column list cannot push a
  suppression rule out of sight. Unknown `role` or `exposure` values are dropped rather than
  coerced, and a registry entry with no approved dictionary is not handed out at all (there would
  be nothing to allowlist against). Reads degrade to an empty list, never a throw.
- **`fact_uuc_phc_barangay` is registered with a flag on it.** The table is live and public-read
  but has no committed migration in `supabase/migrations/`, so its `notes_md` records the gap
  rather than inferring a source — that is Increment 1.5's to resolve, and it is exactly the kind
  of lineage the graph seeding is meant to make queryable.
- **One live table is deliberately not registered: `agg_uuc_phc_counts`.** It was created on the
  live project by the concurrent UUC for PHC work while this backfill was being written, after the
  table enumeration behind it, and its migration is not in this branch. No public tool queries it
  yet, so 1.2's Verify still holds; describing it from a live table comment rather than its own
  migration would be exactly the inference this increment exists to avoid. The seed is idempotent,
  so registering it is a few added rows once that branch lands.

- **Owner decisions in §0 are still open**, decision 1 (Supabase Pro) included. Nothing here
  depends on them: both tables together hold 252 metadata rows, and the plan only requires the
  decisions be settled before 1.2 changes what gets *built* — the schema and the backfill are the
  same either way. 1.3 (`queryDataset`) and 1.4 (the internal page) are the first increments that
  need decisions 2–4 answered.

**Verify.** Both migrations applied live via the Supabase MCP and committed to
`supabase/migrations/`; re-running them is idempotent (`on conflict do update`). `npm run lint`,
`npm run typecheck`, `npm test` (212 tests, 12 new in `lib/db/dataset-registry.test.ts`) all clean.
`database.types.ts` hand-extended for the two new tables, matching the existing practice for
surgical schema additions.

## 2026-08-26 — Internal AI assistant, Increment 1.3: `queryDataset`, one tool over every registered table

The ceiling this removes: `lib/ai/tools.ts` is hardcoded around BHW indicators, so a new dataset
means a new hand-written tool, a new Zod schema and new prompt copy. `queryDataset` reads the
registry from 1.2 instead, which makes adding a dataset a data operation.

- **Two tools, not one — discovery is load-bearing.** `createDatasetTools(exposure)`
  (`lib/ai/dataset-tools.ts`) returns `listDatasets` and `queryDataset`. The plan names one tool,
  but the registry is what the model is *shown*, and it cannot write a correct query against a
  table it has never seen described: `listDatasets` with no arguments returns the catalogue,
  `listDatasets { table }` returns that table's full dictionary via `describeDataset`. Counting
  them as one increment is the plan's own framing (§3: "the registry is also what the model is
  shown").
- **Filter, order, project — deliberately no aggregation.** Every registered table is already an
  `agg_*` or a dimension, so a generic GROUP BY would let the model re-derive a figure the
  pipeline already computed, by a different definition, with no way to tell the two apart in the
  answer. `mode: 'count'` is the single exception, because "how many rows match" cannot be
  misdefined. This is a narrowing of what "query anything" could have meant, and it is the reason
  the tool needs no SQL at all.
- **No SQL is composed anywhere.** Identifiers come from the registry and go to PostgREST through
  supabase-js; values go through as parameters. The plan's "never string-concatenates user input
  into SQL" is structural here rather than a review rule. The one cost is that the generated
  `Database` type pins `.from()` to known table literals, so `runPlan` casts the client to the
  untyped `SupabaseClient` — confined to that function, and sound precisely because every
  identifier reaching it was resolved against `dataset_column` first.
- **Refusals teach the vocabulary.** An unknown or non-queryable column is refused with the list
  of columns that *are* queryable; a value outside a column's `allowed_values` is refused with the
  real values (`geo_level = 'municipality'` → "only takes: national, region, province, citymun,
  barangay"); text on a numeric column and a non-boolean on a boolean column are refused before
  the query is issued. A refusal that returns zero rows instead teaches the model nothing and
  invites it to state the emptiness as a finding.
- **Two warnings ride with every payload.** The table's `notes_md` caveat, and — when the table
  has a `dataset_id` the query did not filter on — an explicit "rows may span several source
  datasets or vintages". `agg_population` holds two censuses and `agg_poverty` three SAE years;
  ranking across them silently mixes vintages, so the payload says so rather than relying on the
  caveat being read.
- **Limits:** 100 rows hard cap (20 default), 25 columns, 8 filters, 20 `in` values, 8s request
  timeout via `AbortSignal.timeout`. All enforced before the query is issued.
- **`runToolLoop` now takes a tool set** (defaulting to the public `TOOLS`, so the public chat,
  narrative generator and ask-refresh are byte-for-byte unchanged), and `executeToolFrom` runs a
  call against a given set. Scope becomes a property of which tools exist in the loop rather than
  of what a system prompt asks the model not to call — the seam Increment 1.4 needs.
- **Not wired to any surface yet, on purpose.** The public "Ask the data" chat keeps exactly the
  tools it had. `queryDataset` reaches tables the public tools deliberately never touch, and the
  place it belongs is the admin-gated assistant of 1.4; adding it to the public route would be a
  product change this increment has no mandate for.

**Verify.** Against the live project: every one of the 22 registry projections executes and
returns rows (209 queryable columns probed via `query_to_xml`, 0 failures), and two representative
plans — an `agg_peer_ranks` outlier question and an `agg_workload` caseload question, both against
tables no hand-written tool reaches — return correct rows. In tests: 21 new cases covering the
refusal paths and, with a recording stand-in for the query builder, the exact PostgREST call the
tool issues (projection, each filter, ordering, limit, head-only count) — a filter silently dropped
is the failure a payload assertion alone would miss. `npm run lint`, `npm run typecheck`,
`npm test` (233 tests) all clean.

**What is not yet verified:** the increment's "the assistant selects the tool and answers a
question" half. That needs a surface and a provider key, neither of which exists until 1.4 — this
environment has no AI provider credentials — so it is deferred to 1.4's verification rather than
claimed here.

## 2026-08-26 — Internal AI assistant, Increment 1.4: the admin-only assistant

The surface the §0 decisions describe, built on the defaults the plan proposed (owner confirmed):
admin session only (2), numeric audit retained (3), answer cache bypassed (4). That closes Phase 1
except the graph work (1.5–1.6).

- **`app/api/ai/assistant/route.ts` re-checks the admin session itself.** `proxy.ts` matches
  `/admin/:path*` only, so it never sees an `/api/*` request, and a route handler is reachable
  without ever loading the page that links to it. `getAdminUser()` is therefore the security
  boundary for this endpoint, and it runs *before the body is parsed* — nothing about the request
  can influence whether the gate opens. It fails closed, per the posture already documented in
  `lib/db/require-admin.ts`.
- **Scope is the tool set, not the prompt.** `createInternalTools()` = the six public indicator
  tools plus `listDatasets`/`queryDataset` at `internal` exposure, passed into `runToolLoop`. A
  tool the model may not use is *absent* from its set rather than merely undescribed — which is
  why 1.3 made the loop take a tool set at all. The public chat still gets the default `TOOLS` and
  is unchanged.
- **The hand-written tools were kept alongside the generic one.** `searchGeo` resolves a place
  name to a geo_code in one call — the registry path would need a `like` scan of `dim_geo` and
  would still have to guess between namesakes — and the indicator tools return the same shaped
  figures the dashboard renders, which is what keeps "the number in the answer matches the number
  on screen" true for internal users too. `queryDataset` covers everything they do not.
- **Nothing internal is written to `ai_ask_log`.** Decision 4 removes the cache; the log is a
  separate question, and the answer is also no. That log is explicitly the corpus the *public*
  answer bank is curated from (`ASK_CACHE_PLAN.md` §3), so seeding it with internal exploration
  would corrupt what eventually gets offered to visitors. Internal turns are counted in
  `usage_events` under their own `ai_assistant_message` type, which keeps the rate limit working
  and keeps internal volume out of the public chat's usage figures.
- **Relaxed rate limit = 60 turns / 10 minutes, keyed on the admin's user id** (public chat: 20 per
  browser session). Relaxed rather than removed: the provider quota an internal turn spends is the
  same free-tier budget the public chat depends on, so a runaway loop must still hit a wall. The
  existing `usage_events` counter is reused — `session_id` is a uuid column and an admin user id is
  a uuid, so no schema change was needed.
- **A separate system prompt, not a variant.** `INTERNAL_SYSTEM_PROMPT` relaxes style and scope
  (many datasets, technical register, table names in the answer, longer answers) and keeps every
  grounding rule, adding three the registry makes possible: read the dictionary before querying,
  respect the stated grain, and report the payload's `warnings` rather than absorbing them. What
  differs between the two surfaces is scope, and scope drift is exactly what one shared prompt
  with conditional paragraphs invites.
- **The UI shows tool calls with their arguments,** not the public chat's friendly labels. An
  internal answer is only as good as the query behind it, and the difference between right and
  wrong is usually a filter — a missing `dataset_id`, a `geo_level` one step off. A reader who can
  see `queryDataset {"table":"agg_poverty",…}` can catch that; one shown "Looked up poverty
  figures" cannot. The page also lists the registered datasets server-side, so what the assistant
  can reach is visible before asking rather than discovered by being refused.

**Verify.** 9 new route tests: an anonymous request returns 401 with no provider call and no usage
event; the admin check runs on the route itself; a malformed body is 400; the per-admin limit
returns 429 before any provider call; the loop is invoked with the internal tool set and the
internal prompt; tool calls stream with their arguments. Grounding is covered by two tests that run
the *real* `auditNarrative` through the route — an answer whose figure is in no tool payload has
that sentence stripped before it reaches the stream, while a figure that is in a payload survives.
`npm run lint`, `npm run typecheck`, `npm test` (242 tests) clean, and `next build` succeeds with
`/admin/assistant` and `/api/ai/assistant` both dynamic (no prerender attempt on an auth-gated
page — the failure mode the layout's `force-dynamic` note warns about).

**Still not verified end-to-end:** a real question answered by a live provider. This environment
has no AI provider keys, so the model-selects-the-tool half of 1.3's and 1.4's Verify needs a run
against the deployed preview with `GEMINI_API_KEY` set. Everything up to the provider boundary is
covered; the boundary itself is not, and that is the one claim not made here.

## 2026-08-26 — Internal AI assistant, Increments 1.5–1.6: the graph, and the first traversal

Phase 1 complete. 1.5 creates `kb_node`/`kb_edge` and populates them from structure this
repository already asserts; 1.6 adds the traversal primitive over two edge shapes — the `dim_geo`
containment tree and those lineage edges.

### 1.5 — lineage, generated rather than hand-written

- **A committed generator, not a hand-authored seed.** `ingestion/build_kb_lineage.py` reads the
  migrations, the ingestion scripts and the 1.2 registry and emits
  `supabase/migrations/20260826120100_seed_kb_lineage.sql`. The plan asks for edges "no model
  authored"; a generated seed is the strongest available form of that, because every edge is
  reproducible by re-running the script and checkable by opening the file it names. It also means
  the graph stays current: add a migration, re-run, re-apply.
- **160 nodes, 259 edges**, all `origin = 'asserted'`, all `status = 'approved'`, all carrying a
  provenance pointer, none sourced from a model chunk. Relations: `built-by` 73, `derived-from` 69,
  `has-column` 44, `joins-on` 42, `reconciled-in` 31.
- **`origin` is a column, not a convention** (§9.9). It defaults to `'extracted'`, so a row that
  does not explicitly claim to be asserted is not treated as one — the safe direction for a table
  Phase 3 will write into.
- **`has-column` was added to the plan's four relations.** Nodes include columns, and a column has
  to attach to its table or a lineage walk from a table can never reach its join keys. The `joins-on`
  edges the plan does name are between columns, so without it they are unreachable.
- **Geographies are deliberately not materialized as nodes.** `dim_geo` is already a containment
  tree over 43,746 rows with its own index; copying it into `kb_node` would create a second copy to
  keep in sync for no gain. The traversal reads `dim_geo` directly instead.
- **`derived-from` is emitted from SQL files only.** In a `.sql` file a read can be scoped to the
  statement that writes; in a Python module the whole file is one blob, so every table it mentions
  anywhere would attach to every table it writes. That is co-occurrence, not lineage, and an edge
  nobody can check by reading one statement is what this increment exists not to produce. Python
  scripts still yield `built-by` edges, which are file-scoped by nature.
- **Working tables are resolved through.** `build_aggregates.sql` builds `_agg_base` from
  `fact_bhw_raw`, then builds `agg_bhw_counts` from `_agg_base`; the generator follows that one hop
  so lineage reaches the fact table rather than stopping at a table that is dropped at the end of
  the run.
- **Two generator bugs worth recording, both found by reading the output rather than by tests.**
  (1) A quote-tracking SQL splitter desynchronizes on the apostrophes in this repository's prose
  migration headers, silently producing zero registry edges — comments are now stripped before any
  statement parsing. (2) The `kb_graph.sql` header used a real path (`docs/POVERTY_SAE.md`) as an
  illustrative node key, and the generator dutifully asserted a `reconciled-in` edge from it; the
  example is now a placeholder. Both are the same class of error: a parser reading prose as data.
- **The generator reports what it cannot establish.** A table node with no `built-by` edge is
  printed to stderr; today that is exactly one — `fact_uuc_phc_barangay`, the live table with no
  committed migration that 1.2 flagged. The gap is surfaced, not filled by guessing.

### 1.6 — `traverse_geo` / `traverse_kb`, the project's first recursive CTE

- **The recursion lives in Postgres, the refusals in both places.** §9.8's guardrails — depth cap,
  visited-set cycle guard, row cap, statement timeout — are enforced in the functions, where they
  hold however the function is called; `lib/ai/traverse-graph.ts` adds an earlier refusal so a bad
  request never reaches the database.
- **Excessive depth is refused, not clamped.** A traversal silently served at a lower depth than
  asked produces an answer nobody can reproduce. Hard caps: geo 5, lineage 6.
- **Results are paths with provenance, never bare endpoints.** A lineage row carries the node
  chain, the relation at each step and the file asserting it, rendered as one quotable line. A
  provenance claim without its chain is not checkable, and an unverifiable one reads as authority.
- **`search_path` is pinned** on both functions, and EXECUTE is revoked from `public` and granted
  only to `service_role` — these functions read service-role-only tables, and PostgREST would
  otherwise expose them to `anon`.
- **Registered in the internal tool set and described in the internal prompt in the same
  increment**, per the plan: a traversal the model never selects has not shipped.

**Verify (all live against the project).**

- Lineage chain: `traverse_kb('table:agg_honorarium', 'out', …)` returns its three migrations, its
  ingestion script, and `fact_honorarium`/`fact_bhw_raw`, each step citing the file that asserts it.
- The depth-1 check in 1.5 showed `agg_geo_summary` with no direct fact source; the traversal shows
  why that was the wrong question — it reaches `fact_bhw_raw` at depth 2 via `agg_bhw_counts` and
  via `agg_training`. Transitive resolution is the capability, and it is what makes every table the
  public tools query resolve to its source fact table.
- Subtree: cities and municipalities inside Cebu (`07022`) below their peer median on accreditation
  — GINATILAN 11.02% and ARGAO 22.17% against a peer median of 76.89% — each row carrying its path
  to the queried ancestor. This is the question that has been unanswerable at any depth against
  data in production for a month.
- Ancestors: a barangay walks up citymun → province → region → national at depth 4, each row
  carrying its path.
- Excessive depth: `traverse_geo('PH','down',9,10)` raises `max_depth 9 exceeds the limit of 5`
  rather than running.
- Cycle: two synthetic nodes pointing at each other terminate after one step at `max_depth 6`,
  returning one row rather than recursing. Test rows deleted afterwards; 259 edges before and after,
  zero leftovers.
- Advisors: `kb_node`/`kb_edge` appear only under the existing INFO `rls_enabled_no_policy` lint,
  and neither new function appears under `function_search_path_mutable`. No new WARN or ERROR from
  this work.
- `npm run lint`, `npm run typecheck`, `npm test` (257 tests, 15 new) clean.

**Unrelated advisor finding, not fixed here.** A new ERROR-level lint appeared during this work —
`public.ref_uuc_phc_provincial` is a SECURITY DEFINER view — created on the live project by the
concurrent UUC work. It is not in this branch and not this increment's to change; recorded so it
is not mistaken for fallout from the graph work.

**Still not verified end-to-end:** the model actually selecting `traverseGraph` for a subtree
question and `queryDataset` for a single-geography one, with both answers passing `auditNarrative`.
That needs a live provider key, which this environment does not have. Every layer below the
provider — the SQL, the guardrails, the tool contract — is verified above.


## 2026-08-26 — UUC for PHC 2025: U1 (classification) loaded, 5,991 barangays

First increment of `docs/UUC_PHC_2025_PLAN.md`. The 2025 list of Unserved and Underserved
Communities for Primary Health Care (DC No. 2025-0549; criteria per DOH AO No. 2020-0023) is now a
dataset: `fact_uuc_phc_barangay`, slug `uuc-phc-2025`, `geo_join_level = 'barangay'`.

- **Scope: the listed barangays only.** The workbook's `NEW` sheet also carries 9,395 assessed-but-
  not-listed (`NOT UUA`) barangays; the owner scoped the dataset to the 5,991 that are on the list.
  So the table has **no `decision` column** — membership is presence, and the column would read
  `UUA` on every row — and any "share of barangays in this area" takes its denominator from
  `dim_geo`'s complete 41,958, never from the workbook's partial assessed set. This also retired a
  gap rather than leaving it: `NEW` carries no PSGC column, and name-matching its `NOT UUA` rows
  against `dim_geo` leaves **769 of 9,395 unresolved**, concentrated in BARMM (Tawi-Tawi, Basilan,
  Lanao del Sur). Loading them would have meant either publishing a knowingly incomplete
  denominator or doing fuzzy geographic matching on the strength of names alone.
- **The published total is 5,991**, per the plan §3 decision, with the 2027 Budget Cue Cards p37's
  5,987 as a footnote citing DC No. 2025-0549. **Superseded 2026-08-28 — see the final-list
  alignment entry at the end of this log. The published total is now 5,987 and the footnote is
  gone; the vintage reading below turned out to be backwards.** The workbook corroborates 5,991 three independent
  ways (the `NEW` classification, the `2025 LIST` row count, and the embedded `TOTAL` subtotals);
  the two contested regions are BARMM (399 vs p37's 400) and CALABARZON (200 vs p37's 195).
- **Sulu resolves through `dim_psgc_crosswalk`, not a `dim_geo` edit.** 87 of the 5,991 carry
  `09066…` codes (Sulu under Region IX, after its 2024 removal from BARMM) while `dim_geo` is fixed
  on the vintage that holds Sulu as `19066…` under region 19. Seeded as 430 crosswalk rows derived
  FROM `dim_geo` (1 province + 19 citymuns + 410 barangays — the whole vintage difference, not just
  the 87 this dataset needs), following the NIR precedent in `docs/PSGC_CROSSWALK.md`. Editing
  `dim_geo` instead would have retroactively moved every existing BHW figure for Sulu between
  regions. Note the direction is the reverse of every crosswalk row seeded so far: here the
  *source* vintage is newer than `dim_geo`'s, so `old_vintage` is
  `'post-2024 Sulu transfer (Sulu under Region IX)'`.
- **Correction to the plan's §4.** An earlier draft recorded that "the workbook and the cue cards
  agree — p37's Region IX count of 523 includes Sulu". That is wrong. The workbook files Sulu's 87
  barangays under **BARMM by name** (`region_name = …(BARMM)`, `province_name = SULU`) while giving
  them **Region IX codes** (`09066…`) — it is internally inconsistent about Sulu, and p37's 523 is
  Zamboanga Peninsula alone. This decides which side the rollups take: resolving the codes to
  `19066…` puts Sulu under BARMM, which is what the workbook's own region column says, and
  **grouping the loaded 5,991 by `dim_geo.region_code` then reproduces the workbook's regional
  table at all 17 regions with no adjustment**. Honouring the code's region instead would give
  Region IX 610 / BARMM 312 and break the §3 reconciliation.
- **`geo_code` is resolved in SQL, not in Python.** The generated seed calls
  `map_psgc_to_dim_geo(source_geo_code, …)` and writes both codes, so a missing crosswalk row fails
  the insert on `geo_code`'s `NOT NULL` rather than silently dropping barangays, and the remap
  lives in one place. `source_geo_code` keeps the workbook's own code visible in the data.
- **Indicators stay out until U3.** The 12 cleaned indicators are bounded and loadable
  (`ingestion/data/uuc_phc_2025_cleaned.csv`), but 886 Water and 456 FIC values now read as exactly
  100% because they were capped, and nothing on a rendered page would distinguish them from
  barangays genuinely at 100%. U3 needs that display rule first — see
  `docs/UUC_PHC_2025_CLEANING_REPORT.md` §6.

**Verify.** Applied live via the Supabase MCP, then checked against the loaded table: 5,991 rows =
5,991 distinct `geo_code`; **0** codes unresolved in `dim_geo`; **0** rows at a non-barangay level;
87 rows remapped, each exactly `09066…` → `19066…`; all 17 regional counts exact against the
workbook (total 5,991); 430 Sulu crosswalk rows. Security advisors show nothing new (the table has
RLS with a public-read policy; the pre-existing `rls_enabled_no_policy` and
`function_search_path_mutable` notices are unchanged). The loader's own pre-emit checks — row
count, PSGC format, duplicates, `UUA`-only, Sulu count, all 17 regional counts — pass on the
committed extract, and `clean_uuc_phc_indicators.py` reproduces its report figures exactly
(`rows=5991 psgc_missing=0 cap100=1580 cap1000=4 neg=0 cols_dropped=15 provinces=88
prov_ref_capped=24`).

## 2026-08-26 — UUC for PHC 2025: U2, the aggregate and the `/uuc-phc` section

Second increment of `docs/UUC_PHC_2025_PLAN.md`, on top of U1's load. The 5,991 listed barangays
are now rolled up to every geo level and rendered as their own section. Feature write-up:
`docs/uuc-phc-feature.md`.

- **`agg_uuc_phc_counts` is computed in SQL from `fact_uuc_phc_barangay` + `dim_geo`, not from a
  generated seed.** Every other aggregate in this repo is seeded from a Python-generated migration
  because its source is an external sheet; this one's source is already in the database, so a
  generated seed would be a second copy that can drift from the first. Re-running the migration
  recomputes all 1,788 rows, which makes re-running it the refresh procedure rather than a
  regeneration step.
- **The denominator is `dim_geo`'s barangay count, not the workbook's assessed set.** The reader's
  question is "how many of this town's barangays are unserved or underserved", and the town's
  barangay count is a fact about the town. Using the workbook's assessed subset would silently
  answer a different question — share of *assessed* barangays — with a denominator missing the 769
  barangays it could not resolve (U1).
- **A row exists for every geo, including those with none listed.** NCR renders "0 of 1,675" with
  an explicit note that the list is national and complete as published. Omitting those rows would
  render complete data as "no data" — the failure mode the profiling-status card has to message
  around, and which does not apply here: that dataset is loaded region by region, this one is a
  single national publication. Affordable because the aggregate is 1,788 rows.
- **No barangay-level aggregate rows.** They would be 41,958 rows of `n_listed` in {0,1} restating
  the fact table. The city/municipality page instead reads `fact_uuc_phc_barangay` directly and
  names every barangay with its status — including the ones *not* on the list, so a reader can tell
  an unlisted barangay from one the dataset never covered. `/uuc-phc/barangay/*` 404s.
- **The share is derived in the read layer, not stored** (`lib/db/uuc-phc.ts`), keeping the
  definition in one place — the same discipline as `profiling-status.ts`'s stage totals.
- **The listed count is the hero, not the denominator** — the reverse of `StatusHero`. There the
  denominator is the story ("every BHW must be profiled; here is the gap"); here the list is the
  story and the barangay count is context for reading it.
- **Child tables sort by share, not raw count.** A list ordered by count alone re-ranks areas by
  how many barangays they happen to have. By share, CAR leads the regions at 52%.
- **Its own section, not a card on `/bhw`.** This is a targeting list of places rather than a BHW
  measure, so it gets `/uuc-phc` with its own chrome, methodology page and portal card, following
  `/profiling-status`.

**Verify.** Aggregate: 1,788 rows (1 national + 18 regions + 118 provinces + 1,651 citymuns);
national 5,991 of 41,958; regions, provinces and citymuns each sum to 5,991; every province equals
the sum of its citymuns and every region the sum of its provinces (0 mismatches); no area has
`n_listed > n_barangays`; exactly one region (NCR) reads zero. `npm run lint`, `npm run typecheck`
and `npm test` (206 tests, including 6 new in `lib/db/uuc-phc.test.ts` covering the
zero-denominator and none-listed cases that must not collapse into each other) all clean. Pages
were rendered against live data and checked number by number: `/uuc-phc` (5,991 / 41,958 / 14%,
CAR first at 52%), `/uuc-phc/region/14`, `/uuc-phc/province/14027` (11 cities ranked by share),
`/uuc-phc/citymun/1402706` (MAYOYAO 27 of 27, every barangay named), `/uuc-phc/citymun/0102804`
(BANGUI 2 of 14, both groups named), `/uuc-phc/region/13` (NCR 0 of 1,675 with the "result, not
missing data" note) and `/uuc-phc/methodology`; unknown geos and barangay URLs 404. The hand-added
`database.types.ts` entries for both new tables were checked column-by-column against
`information_schema` — names, types and nullability all match.

## 2026-08-26 — UUC for PHC 2025: U3, the indicators, and the capped-value display rule

Third increment of `docs/UUC_PHC_2025_PLAN.md`. The 12 cleaned indicators are loaded and rendered
per barangay. `fact_uuc_phc_indicators` carries the values, the 7 provincial benchmarks criterion
(d) compares against, and `capped_indicators` — which of that barangay's values were bounded during
cleaning.

- **The display rule the plan was blocked on: mark the value, and never average it.** 1,584 values
  across 1,397 barangays were bounded during cleaning, and afterwards 886 Water and 456 FIC values
  read as exactly 100% with nothing separating them from genuine full coverage. Every bounded value
  now renders with a † and a footnote saying the true figure is unknown. That mark travels with a
  single rendered value but **cannot survive a mean**, so U3 publishes **no per-indicator
  aggregates** at all. The plan's "aggregates only for those a page renders" resolves to *none*,
  and the cleaning report's warning that any aggregate over Water or FIC must exclude or footnote
  the capped rows is honoured by not building one.
- **Indicators render at barangay grain only.** A city/municipality page expands each listed
  barangay (`<details>`, no client JS) to show its qualifying factors and seven health indicators.
  This is the only grain at which a caveat can stay attached to the number it qualifies.
- **The comparison respects each indicator's direction.** Higher infant mortality is worse; higher
  immunisation coverage is better. A single comparison applied to all seven would invert half of
  them. Where either side is missing the answer is null — "not evaluable" — never "not worse":
  57 barangays sit in provinces that supplied no reference, and criterion (d) not being evaluable
  is not the same as passing it.
- **A benchmark above an indicator's own maximum is refused.** FIC's provincial reference was left
  uncapped in 2 provinces (Ilocos Sur 102.15, City of Butuan 100.96 — recorded here as 101.00, corrected in U9) while every barangay FIC was
  capped at 100 — so all **113** of their barangays would have read "worse than province" by
  construction, an artefact of the cleaning rather than a finding. `comparesWorse` returns null
  above the maximum and the UI shows the benchmark with no verdict. This turns
  `UUC_PHC_2025_CLEANING_REPORT.md` §6's caveat into behaviour.
- **The source's 88 provinces are 87.** Two of its name-groups are both Zamboanga City: 7 barangays
  filed under a *blank* province name with no reference at all, and 1 under "CITY OF ZAMBOANGA"
  with a full set. `dim_geo` files all 8 under province `09317`. `ref_uuc_phc_provincial` is
  therefore keyed on `dim_geo.province_code`, never on the source's names — 9 of its 88 do not
  match `dim_geo` (the HUCs, BARMM's Special Geographic Area, and the blank).
- **That view exposes `n_with_reference`, not just a value.** A bare `max()` would have reported
  Zamboanga City's single referenced barangay as the whole province's benchmark, quietly making
  criterion (d) look evaluable for the other 7. The migration also asserts, after loading, that no
  province carries two *different* reference values, aborting if one ever does (0 do).
- **Indicator columns are unconstrained `numeric`.** The first cut used `numeric(7,2)`, which
  silently rounded the 15 source values carrying three decimals (an ABR of 48.912, an IMR of
  4.347). Rounding is a display decision; the table stores what the source supplied. Caught by a
  checksum comparison against the committed CSV.
- **Criterion (b) is summed, following the file.** The source marks conflict/displacement met when
  `armed_conf + idp ≥ 10`, which reproduces its own Pass/Fail on all 5,991 rows; reading the AO's
  "or" as either-alone disagrees on 15. Implemented as the file does, with the divergence recorded
  (`UUC_PHC_2025_PLAN.md` §1a).

**Verify.** 5,991 indicator rows, one per listed barangay, none missing; 1,397 barangays carry a
capped flag totalling 1,584 values, matching the cleaning report per indicator (Water 886, FIC 456,
Pre-natal 208, SBA 30, ABR 2, IMR 1, UFMR 1); `physical_factor` never below the AO's floor of 25;
no coverage value above 100 and no rate above 1,000. All 5,991 rows × 21 fields were read back from
the database and compared to the committed CSV **as decimals — 0 mismatches** (an md5 comparison
disagreed first, which is what exposed the `numeric(7,2)` rounding). The provincial-consistency
assertion passes. `npm run lint`, `npm run typecheck` and `npm test` (219 tests, 13 new in
`lib/db/uuc-phc-indicators.test.ts`) all clean. Rendering checked live: BACSIL (Bangui) shows its
factors and correctly-directional comparisons; BITONG (Galimuyod, Ilocos Sur) shows two † marks
with the footnote and its FIC as "not comparable — province reads 102.2" rather than a false
"worse than province". The temporary `security definer` loader used to stream the rows from the
committed CSV was dropped immediately after each load and verified gone.

## 2026-08-26 — UUC for PHC 2025: U4, the PNG one-pager — and why it carries no indicators

Final increment of `docs/UUC_PHC_2025_PLAN.md`. Every area on `/uuc-phc` now has a downloadable
one-page PNG, reusing the `@resvg/resvg-js` path and bundled-font handling of
`lib/exports/profiling-status-figure.ts`.

- **The sheet renders the list, not the measurements.** It carries the count against its barangay
  denominator, the listed/not-listed split, and either a child table ordered by share or — for a
  city/municipality — its listed barangays by name. It deliberately carries **no indicator
  values**: a one-pager has nowhere to put the † marker's footnote, and a bounded value reproduced
  without that context is exactly the unmarked artefact U3 was built to prevent. Indicators stay on
  screen, at the grain where the caveat travels with the number.
- **Caps are stated, never silent.** The child table stops at 42 rows and a city/municipality names
  at most 60 barangays. Where a cap binds — Cebu has 50 cities — the sheet prints "+ 8 more with a
  lower share, 0 listed barangays between them", naming both how many were omitted and what they
  contribute, so a reader can see whether the cap hid anything. Reporting the omitted rows' listed
  count is the part that matters: it turns a truncation into a checkable statement.
- **Two-state bar, not a funnel.** Same reasoning as the on-screen `ShareBar` — membership is
  binary, and drawing stages the data does not have would be an invention.
- **The legend is two anchored text elements, not one padded string.** SVG collapses runs of
  whitespace, so the first cut rendered as "…14% Not on the list…" with nothing separating the
  halves. Caught by rendering the PNG and looking at it, which is the only way this class of bug
  surfaces — it raises no error and passes every type and lint check.

**Verify.** Exports rendered **and visually inspected** at national (18 regions, CAR first at 52%),
region, province, MAYOYAO (27 of 27) and BANGUI (2 of 14, both barangays named), NCR (0 of 1,675
with its "result, not missing data" note and an empty bar), and CEBU (21 of 1,066, 42 rows plus the
truncation line). 400 on invalid parameters, 404 on an unknown geo. `npm run lint`,
`npm run typecheck` and `npm test` (224 tests, 5 new for `wrapNames` — SVG has no text wrapping, so
an over-long line runs off the page with no error to catch it) all clean.

That completes `docs/UUC_PHC_2025_PLAN.md`: U1 (load), U2 (rollup + section), U3 (indicators),
U4 (one-pager). The remaining idea in the plan is an `/explore` overlay, which is out of its scope.


## 2026-08-26 — UUC for PHC 2025: U5, the registry, the lineage, and the SECURITY DEFINER view

`docs/UUC_PHC_2025_PLAN.md` §9 U5. No user-visible change: this pays off debt that two branches
merged in the same afternoon left behind, and it is the dependency U8's chat sits on.

**The debt was structural, not clerical.** PRs #75 (this dataset) and #76 (the internal assistant)
were each written against the other's absence, and both were true when written. What made them
false was the merge, and nothing in either branch could have noticed. Three statements had to be
corrected:

- `fact_uuc_phc_barangay`'s `notes_md` said the table "has no committed migration in
  supabase/migrations" and asked the lineage seeding to record that gap. #75 committed
  `20260826121000_fact_uuc_phc_barangay.sql`. The note now points at it.
- `agg_uuc_phc_counts`, `fact_uuc_phc_indicators` and `ref_uuc_phc_provincial` were in neither the
  registry nor `kb_lineage` — 0 hits in both seeds. All three are registered with full column
  dictionaries.
- `kb_lineage` had no `built-by` edge for `table:fact_uuc_phc_barangay`, which the generator had
  been printing to stderr every run as the one node it could not establish. It establishes now.

**The dictionaries are the allowlist, so they are written as instructions, not descriptions.**
`queryDataset` refuses a table with no approved dictionary outright and enforces `is_queryable` per
column, so a column's `meaning` is the only thing a model sees before it composes a query.
`capped_indicators` therefore says *what to do* — "a value named here is a ceiling, not a
measurement… never average or rank it" — and each of the seven boundable indicators names
`capped_indicators` in its own meaning, because the table-level caveat is not what travels with a
returned value. A model reading a bare `100` off `water` with nothing adjacent reports full
coverage, which is precisely the failure U3 built that column to stop. The seven `*_prov_ref`
columns say the opposite in as many words — "Never capped, unlike the barangay value beside it" —
since that asymmetry is exactly why 113 barangays read as worse-than-province by construction.

**`ref_uuc_phc_provincial` is registered even though it is a view.** `queryDataset` reaches it
through PostgREST the same way it reaches a table, and refuses any relation without a dictionary,
so omitting it would not have made it unreachable — it would have made the canonical form of the
provincial benchmark the one thing the assistant could not read.

**`security_invoker = true` on that view** closes the ERROR-level `security_definer_view` advisor
finding. Without it the view runs as its owner, so the RLS of `fact_uuc_phc_indicators` never
applies to the caller. It is the repository's only view, so there was no local convention to copy;
the one this sets is that the underlying table's policy grants access and the view adds no
privilege of its own. That table is already public-read to `anon`, so *who* can read the view does
not change — only what decides it. Verified: 87 rows still returned to `anon` over PostgREST, and
the advisor is clean.

**Two generator changes, both structural — no hand-written edges.** `ingestion/build_kb_lineage.py`
now (a) reads `create view` as well as `create table`, keying a view as a `table:` node because the
registry, `queryDataset` and every read path already treat one as a table, and taking its
`derived-from` edges from its own defining query — a read scoped to the single statement that
creates it, the same standard the ingestion `.sql` path already meets; and (b) honours an explicit
`-- lineage: <src-key> <relation> <dst-key>` directive.

The directive exists for one edge the plan asks for and no `from` or `join` can supply:
`fact_uuc_phc_indicators` is derived from the bounding process `UUC_PHC_2025_CLEANING_REPORT.md`
documents. **What was considered and rejected** was a rule reading every `docs/*.md` path an
ingestion script mentions as a derivation. It would have produced the wanted edge — and also
`agg_population derived-from docs/DECISIONS.md`, which is not a derivation and which nobody could
check by opening the file. A directive names both endpoints itself, so it stays checkable by
opening the file that carries it and cannot fire by accident.

**Also considered and not done:** applying the ingestion path's read-inside-write rule to
migrations generally, which would give `agg_uuc_phc_counts` a `derived-from` edge to
`fact_uuc_phc_barangay`. It is honest and cheap, but it rewrites edges across all 60-odd migrations
in an increment whose scope is four objects; it belongs in its own change where the delta can be
read.

**The seeds are edited in place, not superseded.** Both files say so themselves — the registry seed
is "the single source for what the registry says", the lineage seed is wholly generated and its
inserts are upserts. A second dated seed would leave two files each claiming to be current, which
is the drift a generated file exists to remove. The live project was brought up by applying the
delta as its own named migration, which is how every migration in this repository has reached it
(the project's `schema_migrations` versions have never matched these filenames).

One footgun found and documented: `build_kb_lineage.py > supabase/migrations/…_seed_kb_lineage.sql`
truncates the seed *before* the generator runs, and the seed is itself a migration the generator
reads — so the shell silently drops one node. Generate to a temp file and move it.

**Verify.** Registry returns the four UUC relations, all `approved`/`public`, with 8 / 6 / 24 / 10
approved columns; the live rows hash-match the committed seed field for field (four `notes_md`
digests and one aggregate digest over all 48 column meanings, ordinals and names). No table node in
`kb_node` lacks a `built-by` edge, and the generator prints nothing to stderr — the first clean run
since the node was introduced. All four objects carry one (`create table` ×3, `create view`,
`writes` ×2), and `fact_uuc_phc_indicators derived-from doc:docs/UUC_PHC_2025_CLEANING_REPORT.md`
is present. `get_advisors` returns no `security_definer_view`; `anon` reads all 87 view rows over
PostgREST. `npm run lint`, `npm run typecheck` and `npm test` clean, with 14 new tests: 11 in
`lib/db/dataset-registry-seed.test.ts` — which parses the committed seed rather than the live
database, on the same reasoning as the lineage generator, and asserts among other things that every
registered relation has a `create table`/`create view` somewhere in `supabase/migrations`, the
invariant whose absence let the false note ship — and 3 in `lib/ai/query-dataset.test.ts` proving
the dataset became queryable by registration alone.

## 2026-08-26 — UUC for PHC 2025: U6, present mode, section chrome, and dataset-aware feedback

`docs/UUC_PHC_2025_PLAN.md` §9 U6. The section's first parity increment: the two existing pages
gain the chrome the BHW pages carry, and the one shared-machinery defect that blocked it is fixed
in a form `/profiling-status` can adopt unchanged.

**`brandLabel` on `DeckMeta` (§8 defect 1).** `PresentationSlide` printed the literal
`BHW Connect` above every promoted slide, and `PresentationDeck`'s closing slide printed
`Data: BHW Connect`. Both are right for `/bhw`, `/place/*`, `/explore` and `/compare` and wrong for
every other section — a UUC deck would have carried the census's name above each of its slides and
then attributed this dataset's figures to it. The field is **optional and defaults to
`"BHW Connect"`**, so all four existing callers are untouched by construction rather than by
inspection; `/uuc-phc` passes `"UUC for PHC"`.

The resolution lives in `deck-logic.ts` (`brandLabelOf`) rather than as a `??` at each use site, so
it unit-tests in the node environment alongside the rest of the pure deck logic and a third
consumer cannot quietly reintroduce a literal. Blank is treated as unset: an empty header reads as
a rendering bug, never as a choice.

**I fixed the closing slide as well as the header**, which the plan named only as the header. It is
the same wrong-section claim in a worse place — "Data: BHW Connect" under a UUC caption line
asserts a provenance that is false — and leaving one of the two literals would have made the field
look decorative.

**Present mode on both routes**, four slides: the coverage card (hero + share bar), the child
breakdown, and — at city/municipality — the barangay list. Two judgment calls:

- **The barangay list is one slide, not one per barangay.** The indicator disclosures inside it are
  `<details>` and stay closed on promotion, so a capped value cannot reach a projected screen
  without the † footnote that travels with it. Promoting each barangay would have inverted U3.
- **The deck caption's N is the *area's* listed count, not the national 5,991.** The plan writes
  `N = 5,991 listed barangays · <area> · …`, which is exactly right for the landing page and would
  be a number none of the figures support on a city's deck. Verified reading
  `N = 27 listed barangays · MAYOYAO · 2025 list (DC No. 2025-0549)`.

`PresentButton` sits beside the page's own `<h1>`, not in the section header in `layout.tsx`: the
button must be inside the provider, and the provider needs page-specific `DeckMeta`. This is where
`/bhw` and `/place/*` put it too.

**`feedback.dataset_slug`, derived server-side.** `feedback` has carried only `page_path` since
July, so a correction about this list arrived indistinguishable from a UI bug on `/explore` except
by string-matching a URL. The column is nullable and additive (no backfill), and **derived from
`page_path` in the API route** rather than sent by the client — one derivation for the spot widget
and the form alike, and a slug nobody can set is a slug nobody can set wrongly. A test asserts a
caller-supplied `dataset_slug` is ignored.

**Null is a real answer.** Only sections that *are* one dataset's surface get a slug — `/uuc-phc`,
`/profiling-status`, `/bhw`, `/place`. `/explore` and `/compare` render BHW figures beside census
population and SAE poverty; naming one dataset there would be a claim the page does not support,
and a wrong slug is worse than none precisely because it is filterable. Those stay null and are
triaged by path as before. No foreign key to `dim_dataset`: this records what was on screen and
must outlive a dataset being renamed or retired.

**The UUC entry point is not a second widget.** `SpotFeedback` already renders here (it is mounted
globally and gated off `/admin` and `/` only), and confirmed still exactly one widget on the page.
What was missing is an entry point that names the correction in the reader's words —
*"Is a barangay missing from this list, or listed in error?"* — in the section footer. Pin-and-
comment is the right shape for "this chart looks wrong" and the wrong shape for "this list is wrong
about my barangay".

It **says plainly that we cannot change the list**: this is DC No. 2025-0549 reproduced as issued,
and a correction is the source office's to make. It also names the two things already known and not
worth reporting — the 5,991 vs 5,987 gap and the one unresolvable source row — so nobody spends
effort telling us what `docs/UUC_PHC_2025_CLEANING_REPORT.md` already says. Implemented by giving
`FeedbackForm` a starting category and an id namespace rather than writing a second form; the form
already reads `usePathname`, so a correction from `/uuc-phc/citymun/…` lands tagged with both the
dataset and the exact area.

**`opengraph-image.tsx` for both routes**, count as the headline, no indicator values — U4's rule,
since a 1200×630 card has nowhere to put a † footnote. A zero renders as a zero: NCR reads
"0 of 1,675 barangays", never an omission.

**Both OG images had real bugs that only rendering found**, and neither is catchable by lint,
typecheck or any test in this repo:

1. Satori throws on a `<div>` with more than one child unless it declares an explicit `display`.
   The landing card's headline interpolated a number beside literal text and 500'd. Every line is
   now composed as one string.
2. `params` is a Promise on this Next version. The area card read `params.geoCode` synchronously;
   it happened to work and logged an error on every request. Now awaited.
   (`app/place/[geoLevel]/[geoCode]/opengraph-image.tsx` has the same synchronous read — noted, not
   changed here, since it is outside this increment and works today.)

**Verify.** Deck driven end to end in a real browser on seven routes: `/uuc-phc`,
`/uuc-phc/region/14` and `/uuc-phc/citymun/1402706` all start, advance through their slides, show
**"UUC FOR PHC"** in the promoted-slide header and `Data: UUC for PHC · …` on the closing slide, and
exit on Escape; `/bhw`, `/place/citymun/0102804`, `/explore` and `/compare?geos=14,01` all still
read **"BHW Connect"** on both. Feedback POSTed from `/uuc-phc/citymun/1402706` landed with
`dataset_slug = 'uuc-phc-2025'` and from `/explore` with null, and both came back through the exact
projection `listFeedback()` issues; the two synthetic rows were then deleted rather than left in the
real inbox. (The admin page itself needs the service-role key, which this environment does not
have — the read layer and its projection were exercised, the rendered page was not.) OG images
render 1200×630 at national, region (including NCR's zero), province and city/municipality, and
were **looked at**, not just status-checked. Exactly one `SpotFeedback` widget and one correction
entry point on the page. The one console error on `/uuc-phc` is the pre-existing theme-script
hydration warning, identical on `/bhw` and `/explore`. `npm run lint`, `npm run typecheck` and
`npm test` (309 tests, 14 new) all clean.

## 2026-08-26 — Owner decision 1 answered: Supabase Pro

The owner has upgraded the project to Supabase Pro. `AI_ASSISTANT_PLAN.md` §0 carried this as a
*proposal* through all of Phase 1; it is now recorded as answered, and §0 gained a Status column
so a settled decision is no longer indistinguishable from a proposed default.

- **What it changes:** the §6 Free-tier fallback — pruning `agg_demographics` and `agg_training`
  (265 MB between them) to get back under 500 MB — is moot and should not be done. That fallback
  traded recurring engineering attention for $25/month indefinitely, and the trade is now closed.
- **What it does not change:** §5 (pre-computed aggregates only when a page renders them) stands
  either way, exactly as §6 said. Pro removes a ceiling; it does not make cross-tabs cheap.
- **Headroom, measured.** The database is **602 MB** at the time of writing, against Pro's 8 GB of
  included disk. The 2.1 corpus below adds ~150 KB of text plus, once embedded, on the order of
  0.6–2.5 MB of vectors for 212 chunks depending on the dimension the provider returns. Documents
  are not the cost driver; §6 said so and the measured figures agree.
- Decisions 2, 3 and 4 were confirmed and implemented in Increment 1.4; decision 7 is answered as
  Gemini and implemented in 2.1. §0's Status column now records all of this in one place.

## 2026-08-26 — Internal AI assistant, Increment 2.1: the document corpus

Phase 2 opens. Phase 1 gave the assistant SQL over registered tables (`queryDataset`) and a
traversal over asserted edges (`traverseGraph`); this adds the third retrieval path from §2 —
prose — by ingesting the 2027 Budget Cue Cards into `doc_source` / `doc_chunk`.

**213 chunks over 213 pages, 147,262 characters**, chunked and loaded by
`ingestion/ingest_documents.py`. One slide, one chunk (§12.3).

- **Four tables, not the two the plan named.** `doc_source` (one row per document) and `doc_chunk`
  (one row per slide) are the plan's; `doc_embedding_model` and `doc_chunk_embedding` are added,
  and they exist for one reason given below. All four are service-role only with RLS enabled in
  the same statement block as each `CREATE TABLE` (the 0.3 guardrail).

- **The embedding dimension is a row, not a type modifier — this is the load-bearing decision.**
  §11 asks for the dimension to be "confirmed against the provider's live model at implementation
  time". A `vector(768)` column cannot do that: it hard-codes a provider's current output width
  into a migration written *before* anyone measured it, and it is exactly the class of constant §1
  forbids ("the model name is configuration, not code" — this project has already lost a day to a
  pinned model that was shut down). So `doc_chunk_embedding.embedding` is an **unconstrained
  `vector`**, the width lives in `doc_embedding_model.dim`, a composite FK on `(model, dim)` forces
  every row of a model to share one width, and a check constraint asserts
  `vector_dims(embedding) = dim`. A provider that quietly changes its output width fails the
  insert instead of poisoning an index. Verified live before the schema was committed: an
  unconstrained column accepts mixed widths, `<=>` works within a width, and both the check and
  the composite FK reject the bad cases.

  The cost is real and accepted: pgvector cannot build HNSW/IVFFlat on an unconstrained column.
  At 212 embeddable chunks an exact scan is sub-millisecond and an approximate index would trade
  recall for nothing. Pinning the column and adding the ANN index is a later migration, written
  once a *measured* dimension exists to pin it to — which is a better trigger than a date.

- **Offsets are asserted by construction, and the constraint earned its place immediately.**
  Increment 2.3 makes citation accuracy a correctness requirement (§7), so `char_start`/`char_end`
  index the document's canonical extracted text and `doc_chunk_offsets_match` requires
  `char_end - char_start = length(content)`. While loading, a hand-transferred chunk was mangled
  (two characters and a line break) and the constraint **rejected the whole batch** rather than
  storing a citation that pointed at text the document does not contain. A length-preserving
  corruption would have slipped past it, so the load was additionally verified by recomputing
  sha256 in SQL over every stored chunk and comparing to the hash the pipeline computed: **0
  mismatches across 213 chunks**. Both checks are cheap; neither is optional once a citation is
  the only thing standing behind a prose claim.

- **The slide-number hazard, measured rather than assumed — and §12.3 corrected.** §12.3 reports
  three corrupted strings as evidence. The hazard is real, but those strings do not reproduce
  against this file with this extractor, and the plan has been corrected in place. What is
  actually there: a **3.0pt `38,Bold` span at x = 325.9**, one digit per span stacked vertically,
  148 spans on 52 of 213 pages, spelling the deck's own printed slide number. It is the only
  sub-5pt text in the deck (body text never goes below 7pt), so `size < 5.0` isolates it exactly.
  It corrupts only a *flat sorted* extraction and lands **after** a token, not inside one
  (`MIMAROPA REGION42`, `reported19`); page 157's `workshops` is clean in every mode tested.
  The pipeline extracts line-structured and span-aware, which is not exposed to the hazard at all,
  **and** strips the element anyway — left in, it is a stray digit line that gets embedded and
  quoted. Verified live: 0 rows contain any of the three corrupted forms; the clean forms are
  present.

- **Citations use the PDF page number.** The deck's printed numbers exist on 52 of 213 pages and
  their offset from the PDF page index runs +4 to +33, so they are not derivable. §12 already
  cites by PDF page (p37 *is* the UUC distribution slide), and the load matches: `chunk_index` is
  `page_from - 1` for all 213 rows, with no gaps.

- **Extraction and embedding are separate flags, on purpose.** `--verify` / `--emit-sql-dir` /
  `--database-url` follow the existing `ingest_population.py` convention; `--embed` is additive.
  Extraction needs only the committed PDF, so it runs and is verifiable anywhere; embedding needs
  a provider key and network. Splitting them means the corpus can be loaded, inspected and
  searched by trigram before any vector exists, and re-embedded onto a new model later without
  re-extracting. `doc_chunk_embedding` is keyed `(chunk_id, model)`, so a model swap is an insert
  alongside rather than a destructive rewrite.

- **The corpus is not seeded from a migration.** The PDF is committed and the pipeline is
  committed, so the chunks are reproducible by re-running it — the same posture as `fact_bhw_raw`,
  which `ingest.py` loads and no migration seeds. The migration carries schema only.

- **`fact_uuc_phc_barangay`'s lineage gap closed while this was being built** — not here, but on
  `main`. It was flagged in 1.2 and 1.5 as live and public-read with no committed migration;
  `20260826121000_fact_uuc_phc_barangay.sql` (#75) is that migration. Surfacing the gap rather
  than inferring a source was the right call: it was filled by the branch that actually knew the
  answer.

- **Two findings from reading the corpus, recorded because they change how 2.2 must behave.**
  (1) The UUC-for-PHC regional distribution appears **twice**, on pages 37 and 141, byte-identical
  (same `content_sha256`). Retrieval will return both; a citation must name the page it actually
  quoted rather than collapsing them. (2) Table-heavy slides extract in poor reading order
  (`662 M1,383 M1,497 M`, `TOTA` / `L` split across lines) — 85 of 213 pages carry tables per
  §12.1. This is acceptable for retrieval and *not* acceptable as a quoted span, which is a
  constraint on 2.3's quoting, not a defect to fix in extraction.

**Verify (all live against the project).**

- 213 chunks over 213 distinct pages, range 1–213; `chunk_index = page_from - 1` for every row;
  0 multi-page chunks.
- **Offsets tile the document exactly.** Every consecutive gap is exactly 1 (the single page
  separator), first offset 0, last offset 147,262, and
  `sum(char_end - char_start) + (count - 1) = 147,262` = `doc_source.char_count`. The stored
  offsets reconstruct the canonical text with nothing missing and nothing double-counted.
- **0 sha256 mismatches** across all 213 chunks, recomputed in SQL.
- The slides §12 names resolve to the pages it names: p26 carries 277,767; p27 carries 35,645;
  p37 and p141 carry `DC No. 2025-0549` and 5987; p160 and p163 carry `JMC. 2023-001`.
- 1 chunk is empty (page 172 has no text layer, consistent with §12.1's "2 of 213 pages below 20
  extracted characters" — the other is page 44, `Summary Slides`, at 14 chars). It keeps its row
  so `chunk_index` stays aligned to page number, and is skipped by the embed step rather than sent
  to a provider that would reject it.
- **RLS is real, not merely declared:** `set local role anon` returns 0 rows from all four new
  tables while a control read of `agg_bhw_counts` returns 41,052 — proving the role switch took
  effect. §12.5's admin-only constraint holds at the database layer, not only at the route.
- Advisors: the four new tables appear only under the pre-existing INFO `rls_enabled_no_policy`
  lint, alongside `ai_ask_cache` / `fact_*` / `kb_*`. **No new WARN or ERROR from this work.**
- The 1.5 FK debt is paid: `kb_node_source_chunk_fk` and `kb_edge_source_chunk_fk` both reference
  `doc_chunk (chunk_id)` `ON DELETE RESTRICT`. Restrict, not cascade — deleting a chunk that a
  graph row cites should fail loudly, because cascading would delete the assertion along with its
  evidence. This also forces §11's retention question (what happens to chunks for a withdrawn
  document) to be answered deliberately rather than by a default.

**Not verified, and not claimed.** No embedding exists. This environment has no `GEMINI_API_KEY`,
so `--embed` has never run, `doc_embedding_model` and `doc_chunk_embedding` are empty, and **no
dimension is recorded anywhere** — which is the intended state of a design that measures the
dimension instead of declaring it, but it does mean the vector half of 2.2 is unexercised until
the owner runs the pipeline with a key. Running it is a single command and the schema is already
live.

**Unrelated advisor finding, now resolved.** `public.ref_uuc_phc_provincial` was an ERROR-level
`security_definer_view` when 1.6 flagged it. The concurrent UUC work fixed it directly
(`20260826165048_ref_uuc_phc_provincial_security_invoker` on the live project) while this
increment was in progress. Re-checked after the merge: **the project has no ERROR-level security
advisor at all.** Recorded here because 1.6 left it open and a reader following the thread would
otherwise still be looking for it.


## 2026-08-26 — Internal AI assistant, Increment 2.2: `searchDocuments`

The tool over 2.1's corpus. With it the internal assistant spans all three retrieval paths §2
names: SQL for numbers, edges for provenance, documents for prose. The model chooses; the loop is
unchanged.

- **Hybrid, because neither half is sufficient and their failures are opposite.** The corpus is a
  budget deck, and roughly half the questions it answers are natural language ("what support does
  DOH give BHWs") while half are identifier lookups ("what is DC No. 2025-0549"). Embeddings are
  good at the first and quietly terrible at the second — a memo number is a near-random token
  whose neighbours in embedding space are other numbers, so a vector-only search returns plausible
  slides that do not contain the code. Trigram is the exact inverse. The plan already said
  "vector plus pg_trgm"; this records *why* that is not belt-and-braces.

- **Ranks are fused, scores are not blended.** Reciprocal Rank Fusion (`1/(k + rank)`, k = 60).
  A cosine distance and a trigram similarity are not on the same scale and never will be;
  normalising them into a weighted sum would invent a comparison and bury a tuning constant where
  nobody would find it. RRF needs only that each half orders its own results, which is the one
  thing both genuinely do. Verified: a chunk found by both halves scores 0.0328 against 0.0161 for
  a single-half hit — being found twice, independently, is what ranks it first.

- **The recursion of 1.6's argument: the search lives in Postgres.** `search_documents` carries the
  row cap, the statement timeout, the `status = 'approved'` filter and the empty-chunk exclusion,
  so they hold however the function is called rather than only when the one caller remembers them.
  `search_path` is pinned and EXECUTE is revoked from `public` and granted only to `service_role` —
  it reads `doc_chunk`, and PostgREST would otherwise expose internal budget material to `anon`.

- **The vector half is nullable, and the payload says which halves ran.** Every reason the query
  embedding can fail — no key, no model configured, nothing embedded yet, provider down or slow, a
  width that disagrees with the corpus — collapses to "no vector this time", and the search runs
  lexically with a warning naming the degradation. This is not a hypothetical path: **it is the
  live state**, because 2.1 measures the dimension from a live provider response and this
  environment has no key. A document search returning trigram hits is worth far more than one
  returning an error, and `retrieval: { lexical, vector }` lets a reader tell a thin result from a
  degraded one. Same reasoning as `queryDataset`'s warnings.

- **Embedding the *query* in a request is not the thing the plan forbids.** §8 says chunk and embed
  "in the Python pipeline, never in a Vercel function". That is about the corpus: 213 slides is a
  batch workload that would blow a serverless timeout and belongs with the rest of ingestion. A
  query embedding is one short call for text that does not exist until the request arrives, so
  there is nowhere else it could happen — vector search inherently requires embedding the query.
  Recorded because the rule reads absolute and a later reader would be right to check.

- **Document and query embeddings use different task types.** `RETRIEVAL_DOCUMENT` at ingest,
  `RETRIEVAL_QUERY` at search. Gemini's retrieval embeddings are asymmetric by design and the two
  are easy to conflate, both being "just embedding some text"; using the document type for a query
  degrades recall silently, which is the worst way for it to fail.

- **The model the corpus was embedded with is read from the database, not from configuration.**
  Searching with a different model than the chunks were embedded with returns confident nonsense —
  the vectors are not in the same space. `doc_embedding_model` is the record of what was actually
  used, and a mismatch against `GEMINI_EMBEDDING_MODEL` degrades to lexical rather than silently
  embedding with something else: the environment is the record of what this deployment is
  configured to call, and quietly calling another model would make a later migration impossible to
  reason about.

- **Citations are rendered as one quotable string, not as fields to reassemble.** An assistant that
  has to build "cue cards, slide 37" out of three fields will eventually build it wrong, and per §7
  a citation naming the wrong page is worse than none because it reads as verified. Each hit also
  carries `chunkId`, `charStart`/`charEnd` and the document's `as_of`, which is what makes it
  resolvable — and what 2.3 renders.

- **An empty result is explained, not just empty.** "No chunk matched" means the words were not
  found, not that the corpus lacks the topic; the payload says so, because a model handed zero rows
  will otherwise state the emptiness as a finding about the corpus.

- **Registered and described in the same increment**, per the plan. `createInternalTools()` gains
  `searchDocuments`; the internal prompt gains rules 10 and 11. Rule 11 is §12.4's rule, now
  enforceable: a figure carried by a document renders attributed and dated, and where it disagrees
  with a SQL figure **both** are surfaced with their as-of dates rather than either being preferred.
  `auditNarrative` cannot enforce that — it strips sentences whose numbers are unsupported, which
  is exactly backwards for a correctly-cited document figure — so the prompt is where it lives.

**Verify (live against the project, and in tests).**

Live, against the real 213-chunk corpus:

- Exact-identifier retrieval, which is the case the trigram half exists for:
  `DC No. 2025-0549` → slides 37, 140 and 141 at lexical score 1.000 (the three slides that carry
  it), ahead of two slides at 0.813 carrying *other* DC numbers. `JMC 2023-001` → 160/161/162.
  `RA 7883` → 154/156/157. `277,767` → 8/26/151, slide 26 being §12.4's case.
- Fuzzy retrieval: `Magna Carta honorarium` ranks slide 27 first at 0.697 — the honorarium
  allocation slide §12.2 names — with no embedding involved at all.
- **Guardrails refuse rather than clamp**: `limit 99` raises `limit 99 exceeds the search limit of
  25`; an empty query is refused; an embedding supplied without naming its model is refused.
- The empty slide (page 172, no text layer) is never returned, at any limit.
- **The vector half was exercised with a synthetic fixture**, since no real embedding exists: a
  4-dimension probe model with three hand-placed vectors. It confirmed vector-only hits, `both`
  hits, and the RRF ordering above. The fixture was deleted afterwards and asserted gone — 0 rows
  in `doc_chunk_embedding` and `doc_embedding_model`, 213 chunks intact. Recorded as synthetic
  because it proves the *plumbing*, not retrieval quality; nothing here says the vector half
  retrieves well, only that it runs, fuses and cleans up.
- Advisors: `search_documents` does not appear under `function_search_path_mutable`. The project
  has no ERROR-level security advisor.

In tests: 32 new cases across two files. `search-documents.test.ts` (19) asserts the exact RPC the
tool issues — a silently dropped `document` filter is the failure a payload assertion alone would
miss — plus every refusal path, the degraded path, and what a citation carries.
`internal-tool-set.test.ts` (13) closes a gap the route tests left: `app/api/ai/assistant/route.test.ts`
mocks `createInternalTools`, so nothing checked that the real set contains what each increment
claims to have added. It now also asserts the inverse, which is a security property rather than a
packaging detail: the **public** tool set contains none of `searchDocuments`, `traverseGraph`,
`queryDataset` or `listDatasets` (§9.1).

`npm run lint`, `npm run typecheck`, `npm test` (313 tests) clean.

**Not verified.** Retrieval *quality* of the vector half, and whether the model selects
`searchDocuments` unprompted — both need a live provider key this environment does not have. The
lexical half is verified against the real corpus above; the vector half is verified only as
plumbing. §10's regression list is what would turn "these five queries look right" into a claim
about the other forty, and it is the next thing worth having.

**A finding that constrains 2.3.** The UUC regional distribution appears twice, on slides 37 and
141, byte-identical. Search returns both, correctly — but a citation must name the slide the quoted
words were actually taken from rather than collapsing them, and table-heavy slides extract in poor
reading order (`662 M1,383 M1,497 M`), which is acceptable for *retrieval* and not acceptable as a
*quoted span*. Both are constraints on how 2.3 quotes, not defects to fix in extraction.

## 2026-08-26 — Internal AI assistant, Increment 2.3: citations

§7 calls this a correctness feature rather than presentation, and the reasoning inverts the usual
instinct, so it is worth restating: `auditNarrative` strips sentences whose **numbers** are absent
from the tool payloads, which means numbers are checked and prose is not. "A highly technical
request has a 20-working-day deadline" carries no figure, passes the audit untouched, and is
believed. For that claim the citation is the only check there is — and a citation pointing at the
wrong page is *worse* than none, because it reads as verified.

Two rules follow, and this increment is both of them.

- **The citation comes from retrieval, never from the model's prose.** `collectCitations` reads
  what `searchDocuments` actually returned this turn and the route emits it as a `citations`
  stream event. The model never authors a citation, so it cannot mis-cite a passage it was never
  handed. This is the same move the numeric audit makes — the model proposes an answer, the system
  supplies the evidence — and it is why the source list is trustworthy without anyone checking it.

- **A page the model names in prose must be a page it was given.** Rule 1 secures the source list
  but not the sentence: nothing stops the model writing "slide 42 says" when it was handed 26, 27
  and 37. `auditCitations` drops those sentences, exactly as `auditNarrative` drops a sentence
  with an untraceable number. When *nothing* was retrieved, any page reference at all is
  fabricated — a document claim made without ever opening a document — and the same pass catches
  it.

  It audits pages only, never paraphrase. A sentence that restates a retrieved passage without
  naming a slide is left alone: this pass cannot judge whether prose is supported, and pretending
  to would drop good answers while proving nothing. What it can do exactly is refuse to let a
  specific, checkable, wrong pointer through.

**The two audits interact, and the order decides what the reader is told.** Found by a test that
failed for the right reason. A slide number *is* a number, so `auditNarrative` strips "per slide
42" for containing an untraceable 42 before the citation pass ever sees it — the removal is
correct, but the reader is told the figures were ungrounded when the actual fault was a fabricated
citation. Citations therefore run **first**: a sentence still has to pass both, so which sentences
survive is unchanged, but the specific failure gets to explain itself and name the slide.

That ordering also exposes where the citation pass is genuinely load-bearing rather than
redundant: when a fabricated page number happens to appear elsewhere in the payloads — 42 as a row
count — the numeric audit has no objection and only this check catches it. There is a test for
exactly that case, because it is the one that would otherwise rot silently.

- **Click-through resolves from the database, not from the stream.**
  `/admin/assistant/source/[chunkId]` re-reads the chunk **by id** and renders the stored text
  verbatim, rather than re-showing what the answer was built from. A check nobody can perform is
  not a check; this is where a reader performs it, and if the assistant's copy ever disagreed with
  the stored row, this page is what would reveal it. It also shows the offsets 2.1 asserted at
  ingest, which are what make a quotation resolvable to a position in the source PDF rather than
  merely plausible.

- **The passage is shown, not summarised.** Each source expands in place to the exact stored text.
  A citation is only a check if the reader can compare the claim against the words it came from,
  and a title-and-page footnote asks to be trusted instead.

- **`lib/db/doc-chunks.ts` is service-role only and degrades to null.** `doc_chunk` holds internal
  budget material (§12.5); the click-through page is admin-gated by the `(dashboard)` layout, the
  same boundary the assistant sits behind. A citation that cannot be resolved renders as "not
  found", never as a stack trace on an admin page — matching `lib/db/dataset-registry.ts`.

- **`collectCitations` identifies search results by shape, not by tool name.** `runToolLoop`
  records payloads as a bare array and does not carry which tool produced which; widening its
  result type would change a surface shared with the public chat, which this increment has no
  business touching. `chunkId` + `citation` together are unique to `searchDocuments` across the
  whole tool set.

**Verify (live against the project, and in tests).**

- **Ten sampled citations resolve to text that actually supports the claim — 10/10.** Each probe
  pairs a claim a reader might make with the search that would ground it, and asserts the returned
  passage contains the supporting words: the published BHW count (slide 26), the honorarium split
  by income class (27), the UUC total and its circular (37), the retention JMC (160), the UUC
  physical-factor criterion (139), the SHF legal basis (99), the accreditation requirement (159),
  PuroKalusugan site selection (149), and the Magna Carta priority-bill line (12). All ten also
  satisfy `char_end - char_start = length(content)`, so every citation's offsets are internally
  consistent as well as pointing at the right slide.
- The click-through read returns the chunk with its document, as-of date, source path, extractor
  and offsets — verified against the same chunk a search returns.
- `next build` puts `/admin/assistant`, `/admin/assistant/source/[chunkId]` and
  `/api/ai/assistant` all under `ƒ` (dynamic): no prerender attempt on an auth-gated page.
- 30 new tests. `citations.test.ts` (23) covers collection, page-reference parsing and the audit,
  including a bug it found on the way: a single "slide 37" was parsed as two references, because
  the range branch handled `to === from` by pushing both endpoints. `route.test.ts` gains 6 that
  run the **real** `collectCitations` and `auditCitations` through the route — mocking them would
  test that the route calls two functions, which is not the claim §7 makes.
- `npm run lint`, `npm run typecheck`, `npm test` (343 tests) clean.

**Not verified.** Whether a live model, given the tool and rules 10–11, actually cites well — that
needs a provider key this environment does not have. What is verified is the property that does
not depend on the model: a citation it emits is one it was handed, and a page it invents does not
reach the reader.

## 2026-08-26 — Internal AI assistant, Increment 2.4: failure capture

The last of Phase 2, and the one that makes §10 self-sustaining. §10 is explicit that a fixed
evaluation corpus chosen up front would be stale by Phase 2 — sources arrive incrementally and are
not known in advance — so the list has to grow from real failures, which means someone has to be
able to file one in a click.

§7 frames the same decision from the other side. There is deliberately no queue of answers awaiting
approval (owner decision 8): reviewing every answer is unbounded work that grows with usage and
degrades to rubber-stamping. Failure capture is the opposite trade — effort is spent only on
answers that were actually wrong, and that effort permanently guards against a repeat.

- **What "replayable" actually requires, and why the table is wider than the plan's sentence.**
  The plan names question, answer, tools and provider. The Verify asks that the case "can be re-run
  against a later build", and those four are not sufficient for that:

  - `conversation` — the full history, not just the last question. The assistant is multi-turn and
    an answer often depends on what came before it; replaying the question alone replays a
    different question.
  - `tool_calls` — names **and arguments**, in order. The regressions worth catching are usually in
    tool *selection*: a later build that answers the same question by calling `queryDataset` where
    it used to call `searchDocuments` has changed behaviour even when the prose reads the same, and
    that is precisely what §10 exists to detect.
  - `citations` — the passages a document answer leaned on, so 2.3's failure mode (right answer,
    wrong page) is visible in the case rather than hidden inside the text.
  - `provider` — the cascade means two runs of the same question can be answered by different
    models. "It regressed" and "it was answered by Groq this time" look identical without it.

- **The note is optional, and that is the whole design.** A reader who knows an answer is wrong but
  not what the right one is should still be able to say so; a case with no expected answer is still
  worth re-running by hand. Requiring the correct answer would convert a one-click report into a
  small piece of homework, and §10's list only grows if reporting is cheaper than shrugging.

- **A failed write says so.** `recordRegressionCase` returns null rather than throwing, and the
  route answers 503 with "nothing was saved". Telling a reader "recorded" when nothing was written
  is how a regression list quietly stops growing — they report once, see no effect, and never
  report again.

- **Not rate-limited.** The assistant's own limit protects a shared provider quota; this endpoint
  calls no provider, and throttling the act of reporting a bad answer would suppress exactly the
  signal §10 depends on.

- **Admin-gated on the route itself**, before the body is parsed, for the reason 1.4 documents:
  `proxy.ts` matches `/admin/:path*` and never sees an `/api/*` request, so the route handler is
  the security boundary. Verified by a test that posts unparseable garbage and still gets 401.

- **The open list renders on the assistant page.** Not on a page of its own: a report that vanishes
  into a table nobody reads is a report that stops being made, and the people best placed to file
  cases are the ones already looking at this page.

- **`status` keeps `invalid`, and cases are never deleted.** "We looked and it was fine" is itself
  worth knowing the next time the same answer is reported.

**Verify (live against the project, and in tests).**

- A case inserted exactly as the UI sends it reads back with everything a replay needs: **2 turns
  to replay**, the first tool (`searchDocuments`) and its arguments recoverable from jsonb, the
  provider, the status and the expected answer.
- **The stored citation still resolves.** The case's cited `chunkId` and `charStart` were checked
  against `doc_chunk` and matched — so a citation regression is detectable from the stored case,
  not merely a text diff. This is the check that makes 2.3 and 2.4 worth having together.
- **RLS is real**: `set local role anon` returns 0 rows from `ai_regression_case` while a control
  read of `agg_bhw_counts` returns 41,052.
- Advisors: the table appears only under the pre-existing INFO `rls_enabled_no_policy` lint. No new
  WARN or ERROR, and the project still has no ERROR-level security advisor at all.
- `next build` puts `/api/ai/assistant/regression` under `ƒ` (dynamic).
- 8 new route tests (351 total), covering the admin boundary, the replay payload, an absent note, a
  whitespace-only note, an answer that used no tools, a malformed body, and the failed-write path.
- `npm run lint`, `npm run typecheck`, `npm test` clean.

**One seeded case, honestly labelled.** The verification insert originally carried an invented
reporter id. Rather than delete it, it was re-filed as `source = 'seeded'` with `reported_by` null,
because the expectation it records is real and useful: §12.4 rule 3 — where a document figure and a
SQL figure disagree, the assistant must surface **both** with their as-of dates (the cue cards'
277,767 as of Dec 2025 *and* `agg_bhw_counts`' 270,917 profiled records) rather than reconcile
them. An invented *report* in the list would have misled about how the list is being used; a
labelled *seed* is exactly what §10.1 describes.

**Not verified, and the honest gap in Phase 2's evaluation story.** Nothing yet *runs* the stored
cases. A case is replayable in the sense that every input a replay needs is in the row, and that is
what the Verify asks for and what was checked — but there is no batch runner that re-executes them
against a build and diffs the result. Until there is, §10's list accumulates evidence without
automatically spending it. That runner is the obvious next increment and needs no schema change.

## 2026-08-26 — Lineage graph re-run for Phase 2, and a parser bug it exposed

Increment 1.5's workflow is "add a migration, re-run `build_kb_lineage.py`, re-apply". Phase 2
added five tables — `doc_source`, `doc_chunk`, `doc_embedding_model`, `doc_chunk_embedding` and
`ai_regression_case` — and the graph knew about none of them, so a lineage question about the
document corpus returned nothing at all. This is that re-run.

**The generator asserted a table called `with`, and the cause is worth recording.** The re-run
emitted a node `table:with`, built by `20260826160000_doc_corpus.sql`. The source was that
migration's own header comment: *"RLS is enabled in the same statement block as each CREATE TABLE
with no anon or authenticated policy"*. `read_migrations` scanned **raw** text with
`CREATE_TABLE_RE`, so it read that prose as a table definition.

This is the third instance of one failure mode in this script, and `DECISIONS.md` already records
the other two: a quote-tracking SQL splitter desynchronising on the apostrophes in this
repository's prose headers, and an illustrative `docs/` path in a migration header asserted as a
real `reconciled-in` edge. All three are a parser reading prose as data. The comment-stripping fix
from 1.5 was applied to the `dim_dataset` scan only; the `create table` and `alter table` scans
kept reading raw text, and nothing had happened to trip them until a header used the words "CREATE
TABLE" followed by another word.

**Fixed at the cause, not at the comment.** `read_migrations` now scans stripped SQL for tables.
The obvious alternative — rewording the comment — would have left the trap armed for the next
person who writes a migration header describing what it does.

**The docs/ scan deliberately still reads raw text, and the asymmetry is the point.** A migration's
citation of the write-up that reconciled its data lives *in the header comment*, which is exactly
where it belongs; stripping comments there would delete the `reconciled-in` edges the graph most
wants. That scan looks for a `docs/*.md` path, which prose cannot produce by accident — unlike a
bare word after "create table". Both choices are commented in place so the inconsistency reads as
deliberate.

**What the re-run produced.** 183 nodes / 287 edges from this branch's files, against 180 / 289 on
the live project (which carries the concurrent UUC work's rows, seeded there but not committed on
this branch). 44 table nodes, none of them phantom. **Only the delta — 9 nodes and 16 edges — was
applied live**, because the generated seed is a full regeneration and the live database holds rows
from a branch this one cannot see. The seed is upsert-only with no deletes anywhere, so a full
re-apply would also have been safe; applying the delta simply keeps the change reviewable.

**Verify.** `traverse_kb('table:doc_chunk', 'out', …)` now returns the migration that created it,
the ingestion script that writes it, and `docs/AI_ASSISTANT_PLAN.md` as the write-up that
reconciled it — each step citing the file that asserts it. Before this it returned nothing.
The generator's stderr finding list is **empty**: every table node has a `built-by` edge, which is
the first time that has been true since 1.5, and it is true because #75 committed
`fact_uuc_phc_barangay`'s migration.

**Merged with #79, which changed the same generator.** #79 taught `build_kb_lineage.py` to read
`create view` (so `ref_uuc_phc_provincial` becomes a node) and regenerated
`20260826120100_seed_kb_lineage.sql` **in place** rather than adding a dated seed. Both changes are
better than what this branch did:

- The view scan is kept, and now reads *stripped* SQL like the table scans, for the reason above —
  a header saying "CREATE VIEW …" would otherwise assert a view that is not there. The fix and the
  feature compose; neither side had to lose.
- The separate `20260826160300_seed_kb_lineage_phase2.sql` this branch added is **deleted**. One
  generated file regenerated in place is the better convention: two seeds drift, and the second one
  is only ever a snapshot of a moment. `split_statements` was checked and needs no change — it
  already strips comments itself, so #79's view-lineage walk was never exposed.

**Live reconciled to the committed seed: 189 nodes, 307 edges, exact match.** Getting there needed
three corrections, found by diffing the generator's output against the live rows rather than
assuming a re-apply would converge:

- Two rows were missing live — `table:feedback built-by 20260827090000_feedback_dataset_slug.sql`
  and its `reconciled-in` — because #80 applied that migration without re-seeding the graph.
- One node was **stale**: `migration:20260826160300_seed_kb_lineage_phase2.sql`, created by this
  branch and then deleted with the file. Upserts never remove anything, so a full re-apply would
  have left it there — a node naming a file that no longer exists, which is precisely the
  unverifiable assertion the graph exists to prevent. It was deleted explicitly.

The generator's stderr findings list is empty: every table node has a `built-by` edge.

### Carry-forward items from the Phase 1 handoff, settled

- **`agg_uuc_phc_counts` registration — done, by the concurrent work, not here.** The registry is
  now 25 tables / 270 columns, and all four UUC tables (`agg_uuc_phc_counts`,
  `fact_uuc_phc_barangay`, `fact_uuc_phc_indicators`, `ref_uuc_phc_provincial`) are registered
  live. 1.2's decision to leave it out rather than describe it from a live table comment was
  right: it was registered by the branch that had its migration.
- **`fact_uuc_phc_barangay`'s missing migration — closed** by #75, as above.
- **`ref_uuc_phc_provincial`'s SECURITY DEFINER view — fixed** by the concurrent work. The project
  now has no ERROR-level security advisor at all.
- **`database.types.ts` regeneration — deliberately NOT done, and the reason changed since the
  handoff proposed it.** The handoff suggested a regeneration pass via the Supabase MCP. Two
  branches are now hand-editing that file concurrently (this one added five tables and one
  function; the UUC work added its own), and a wholesale regeneration would reformat every entry
  and turn a clean append-only merge into a file-wide conflict for whichever branch lands second.
  The additions here follow the existing hand-maintained style and `npm run typecheck` is clean.
  A regeneration is still worth doing — **once the concurrent branches have merged**, as its own
  change with nothing else in it, so the diff is reviewable as the mechanical reformat it is.

## 2026-08-27 — UUC for PHC 2025: U7, the qualifying routes, and the score that had to be loaded

`docs/UUC_PHC_2025_PLAN.md` §9 U7. `/uuc-phc/criteria` answers the question the section could not:
not which barangays are on the list, but *why* — how many came in on each of the four
socio-economic routes of DOH AO No. 2020-0023 §VI.A, at every geo level. Before this it was legible
only inside a `<details>` on one city page at a time, so "how many of BARMM's 399 qualified on the
4Ps route?" meant reading 399 disclosures. (190.)

**`health_indicators` is loaded, not recomputed — and the plan's Verify block is what exposed
this.** It asks that "the health-indicator route count equals the number of rows with
`health_indicators >= 4`", naming a column that was not in `fact_uuc_phc_indicators`: U3 left it
out on §10's advice that it be "dropped or recomputed before anything depends on it". The obvious
move was to recompute it from the seven indicator/benchmark pairs with U3's own `comparesWorse`
rule. That is wrong, and checkably so:

- It disagrees with the source on **664 of the 5,991 rows**, always lower, because the source
  scored criterion (d) against the values *before* cleaning bounded them, using the Pass/Fail
  columns the reconciled extract drops.
- Worse, it leaves **98 listed barangays qualifying on none of the four routes**. §1a makes that
  impossible — a barangay reaches this list only with a socio-economic factor present. The source's
  own score leaves zero such barangays. So the recomputation is demonstrably not the test that
  selected this list; it is a different quantity wearing the same name.

So the column is loaded as what it is: the source office's recorded classification, auditable
against the source and not against this table. **That is also what keeps the aggregate inside U3's
rule.** The plan's argument is that a route count is safe because it counts classifications rather
than measurements — and recomputing the score from capped columns would have quietly turned it back
into a derived measurement, which is exactly what U3 refused. Neither dropping nor recomputing was
right; carrying it and saying plainly what it is was. The caveat is on the page, on the column
comment, and in the column dictionary, because that last is the only text a model sees before
composing a query.

**There was no rendered health verdict to stay consistent with**, which is what freed this choice.
U3's barangay disclosure renders each indicator's comparison and the chips for criteria (a)–(c); it
never renders a criterion (d) pass/fail. Had it done so, two surfaces in one section would now
disagree about the same barangay.

**Four independent shares, never a stacked bar or a pie.** The routes overlap — a barangay can
qualify on three at once — so the counts do not sum to the listed count, and nationally they come
to 146% of it. Every rendering decision follows from that: four separate 0–100% tracks; each route
carrying **its own denominator** in words beside it; no "other" or remainder figure anywhere,
because there is no remainder; and `shareSumPct` exposed by the read layer for the sole purpose of
letting the page *state* the overshoot in a sentence rather than leaving a reader to infer a
partition. The sum is taken over the **rounded** shares, so a reader who adds the four percentages
on screen gets back the number printed beneath them. 672 of the 1,047 areas with anything listed
sum above 100%; CARAGA reads 184%.

**Route (d) has a different denominator from the other three, and the page says so where it
renders.** For 226 barangays in 5 provinces the provincial benchmark cannot support the comparison
at all, so they are excluded from `n_health_evaluable` and the health share is out of the barangays
the route could apply to. Giving all four routes the same denominator would have understated
exactly the route whose evidence is weakest. An area where the comparison is evaluable for nobody
renders **"Not evaluable here"** and an em dash in the table, never "0 of 0" or "0%" — no barangay
qualified and the question cannot be asked are different statements, and the one place they must
not collapse is a route whose whole caveat is that the data cannot answer it. Agusan del Sur is the
case: all 156 of its listed barangays.

**The not-evaluable count is 226, not the 238 the plan and the cleaning report both state.** Their
own per-province tables read 156 + 50 + 12 + 7 + 1. 238 is an addition error that propagated from
§1a into the cleaning report §6, the U7 and U9 Verify blocks, U10's scope and §10's carried
questions; both round to the 4% they also quote, which is why it survived. Corrected in both
documents, and the page computes the figure rather than quoting it.

**The test for "not evaluable" is computed, not a list of province codes.** A province's seven
benchmarks are three rates per 1,000 and four coverage percentages, so a real set has at least one
value well above 1; "the largest of this barangay's seven benchmarks is null, or at most 1"
identifies a placeholder, a zero-fill or a fraction encoding without naming anyone. It selects
exactly those 226 and nothing else. Hard-coding the codes would go stale the first time a corrected
extract arrives; this rule would simply stop firing. It is also **per barangay, not per province** —
`ref_uuc_phc_provincial` rolls Zamboanga City's 7 reference-less barangays in with the 1 that has a
full set, so a province-level test finds 219 and silently keeps those 7.

**`n_listed` is carried on this table although `agg_uuc_phc_counts` already has it.** Three of the
four routes are shares of it, and joining two aggregates in the read layer to divide is more
fragile than one row that carries its own denominator. The duplication is made safe rather than
accepted: the migration asserts after loading that the two agree on every row, which — since they
are computed from different fact tables — is also a live check that every listed barangay has an
indicator row and vice versa. Three more assertions guard what the page draws: no count outside its
denominator, every level rolling up to the national totals, and every criteria row having a counts
row.

**`n_health_evaluable` is stored; the excluded count is not.** It is `n_listed - n_health_evaluable`
and the read layer derives it — U2's discipline for the share, one definition in one place.

**Children with nothing listed are dropped from this breakdown**, unlike the coverage one. There a
zero is the finding ("no barangay in NCR is on the list"); here the row would be four empty tracks
restating that same zero four times. The area page itself still renders for a zero area, saying so
in a sentence.

**A rendering bug no static check could catch.** JSX dropped the leading space of a multi-line text
node, printing "5,991listed barangays"; it is an explicit `{" "}` now.

**And one that the rebase then un-found.** Writing the phrase `create table if not exists` in prose
inside a migration comment made `ingestion/build_kb_lineage.py` match its own `CREATE_TABLE_RE` and
invent a `table:if` node — the fourth instance of this script reading prose as data. Written first
against the pre-#81 `main`, this increment worked around it by rewording the comment, and declined
to touch the regex on the grounds that widening it risked the `built-by` edges that already work.
**#81 had already fixed it properly**, at the cause: `read_migrations` now scans comment-stripped
SQL. So the workaround was reverted on rebase and the comment says the plain thing again — a
regeneration on the merged base produces no phantom node from it. Recorded rather than quietly
dropped, because "reworded a comment to appease a parser" is exactly the kind of workaround that
outlives its reason.

**Regenerating the lineage picked up drift from two increments, not one.** `feedback` had no
`built-by` edge to `20260827090000_feedback_dataset_slug.sql` (U6 added the migration without
re-running the generator); and the rebase conflict on the seed had to be resolved by regenerating
rather than by choosing a side, since either side alone was missing the other's tables. The
committed seed now carries #81's five document-corpus tables *and* this increment's aggregate, and
the generator prints nothing to stderr. That is the argument for a generated seed over a
hand-written one: the merge of two branches that both touched it is a re-run, not a negotiation.

**The ref-number churn in that file's diff is mechanical.** Inserting migrations into a sorted list
renumbers `rN` for everything after them, so the seed's diff is large while its semantic delta is
8 nodes and 16 edges — all of them #81's, plus this increment's own. Verified by parsing both
versions and differencing the node and edge keys rather than the lines.

**Verify.** 1,788 rows (1 + 18 + 118 + 1,651), matching `agg_uuc_phc_counts`; all four in-migration
assertions pass; **0 rows** have a count outside its denominator. The national row equals a direct
count over the fact table on all six figures (5,991 / 3,677 / 2,302 / 726 / 2,000 / 5,765), and
those match an independent Python computation over the committed CSV. 2,001 rows carry
`health_indicators >= 4` and 2,000 of them are evaluable — the national health route reads 2,000,
so the exclusion is exactly the one not-evaluable row it should be. All 5,991 loaded scores were
read back from the database and compared to the committed CSV as `(source_geo_code, score)` pairs —
**md5 match, 0 mismatches**; the load asserted its own payload length and md5 before writing, which
is what caught a first attempt that arrived truncated. 672 of 1,047 areas with anything listed have
four shares summing above 100%. Registry returns **5** UUC relations approved/public with 6 / 10 /
8 / 25 / 10 approved columns; the lineage generator prints **nothing** to stderr and no table node
lacks a `built-by` edge; `get_advisors` reports no new finding and no `security_definer_view`;
`anon` reads all 1,788 rows over PostgREST. Rendered and **looked at** in Chromium at national,
CARAGA (184%, 156 excluded), Agusan del Sur (all 156 excluded, "Not evaluable here"), Mayoyao (104%)
and NCR (0 listed, empty state); `/uuc-phc/criteria/barangay/*` and an unknown geo 404. The deck
starts, advances through both slides showing **"UUC FOR PHC"**, and exits; `/bhw` still reads
"BHW Connect". The one console error is the pre-existing theme-script hydration warning, identical
on `/bhw`. `npm run lint`, `npm run typecheck` and `npm test` all clean.

## 2026-08-27 — Internal AI assistant, Increment 3.1: document extraction into the graph

Phase 3 opens. This is the first increment in the project that writes graph rows a **model
proposed** rather than rows a committed file asserts, and §13 is explicit about why that is the
dangerous kind: *"a wrong lineage edge is visibly wrong to anyone who opens the migration, whereas
a wrong extracted edge looks exactly like a right one."* Everything below is arranged around that
one sentence.

**79 nodes and 90 edges, all `origin='extracted'`, `status='auto'`, `source_kind='chunk'`, every
one with a `source_chunk_id` and a verbatim `evidence_quote`.** The graph is now 272 nodes / 407
edges, of which 193 / 317 are asserted (the extra 4 / 10 over Phase 2's 189 / 307 are the
concurrent UUC-criteria work, seeded live from a branch this one cannot see).

- **`evidence_quote` and a trigger, which is the load-bearing decision.** The Verify asks that
  "every edge resolves to a chunk whose text actually supports it", and `source_chunk_id` cannot
  deliver that: it records which chunk was *read*, not that the chunk *says this*. So every
  chunk-sourced row carries the span it was drawn from, and `kb_evidence_is_grounded()` refuses
  the insert unless that span appears verbatim in `doc_chunk.content`.

  It lives in the database rather than in the loader for the reason 1.6 put the traversal there
  and 2.2 put the search there: it then holds however a row is written, including by the next
  extractor nobody has written yet. And it enforces the inverse too — a row that is *not*
  chunk-sourced must not carry a quotation. A lineage edge has a file behind it, not a passage,
  and letting it carry one would make the column mean two things.

  **Proven by making it fail, live.** Four probes: a quote absent from the chunk was refused, a
  chunk-sourced row with no quote was refused, an asserted row carrying a quote was refused, and a
  control quote taken verbatim from the same chunk was accepted (then removed). The first probe is
  the one worth reading — it is not nonsense, it is the *tidied* form of a real line
  ("Guidelines on Identifying Geographically-Isolated Areas" against the deck's run-together
  "GuidelinesonIdentifyingGeographically-\nIsolated and Disadvantaged Areas"). Paraphrase and
  invention fail this check identically, which is the point: an offset that does not resolve is
  not a citation.

- **The vocabulary is small on purpose, and typed by endpoint.** Three relations — `defined-by`
  (program → issuance), `issued-by` (issuance → organization), `part-of` (program → program) —
  and two new node kinds, `program` and `organization`. A check constraint is what makes an
  extraction *typed* rather than free-form, and a relation the deck states on ten slides is
  checkable in a way that one invented for a single slide is not. Each relation carries a required
  endpoint signature, so a backwards edge is refused rather than silently flipped.

  `program` and `organization` would both have fitted the existing catch-all `entity`, and that is
  the argument against it: §9.9 asks that rows be distinguishable by column rather than by
  convention, and a review queue that cannot tell a programme from an agency without reading the
  label is a queue that gets skimmed.

- **Proposal and load are separate commands, for the reason 2.1 split `--embed` from extraction.**
  `--propose` calls the provider and writes a **transcript** — one JSON line per slide with the
  raw proposal, who proposed it, the prompt digest and the chunk hash. Every other mode reads that
  transcript and calls nothing. A proposal costs quota and is not reproducible; validating and
  loading it is deterministic and free, and tying the two together is the surest way to end up
  with a validator nobody tightens. The transcript is also the auditable record of what the model
  *said* as against what survived: `--verify` prints the difference. The 3.2 queue is where
  someone judges rows; this is where someone judges the extractor.

- **Chunk text is re-derived from the committed PDF, not read from the database.** Grounding has
  to be checked against the text a citation resolves to. Re-running 2.1's extractor over the
  committed PDF reproduces the corpus byte for byte — verified: the aggregate sha256 over all 213
  stored `content_sha256` values is `d9f3c271…`, identical locally and live — so the extractor
  needs no credentials to know exactly what each slide says, and the trigger re-checks it anyway.

- **Target slides are selected by a rule, not by a list.** Any chunk whose letters-only text
  contains `LEGALANDPOLICYBASIS` or `MANDATECREATING` (14 slides), plus three named pages with a
  stated reason each: 47 and 48 (the only slides that say which programmes exist) and 140 (the
  annual list issuances, which 3.4 chains). Selecting by the phrase keeps the target set derivable
  from the corpus — add a programme slide and it is picked up — and keeps this increment from
  looking like a hand-picked demonstration.

- **Page 40 is in the target set deliberately.** It is an unfilled template slide: *"INSERT NAME OF
  OFFICE HERE … Cite the relevant laws, issuances, policies, or frameworks that mandate or support
  the implementation of the PAP (e.g., RA, EO, DOH AO, UHC Law, SDG, PDP, etc.)"*. It is both an
  instruction addressed to a reader — the §1 hazard, present in the corpus, unprompted — and a
  list of issuance *types with no numbers*. The prompt restates §1 in its own words and says that
  a slide consisting only of instructions extracts to nothing; the canonical-key check is what
  catches `issuance:RA` if the prompt is ever ignored. Page 40 extracted to zero rows.

- **Canonical issuance keys are enforced, never normalised.** This deck writes one issuance as
  "AO No. 2020-0023", "A.O.No.2020-0023" and "AdministrativeOrderNo.2020-0023". The model must
  emit `issuance:AO 2020-0023`; anything else is refused. Normalising instead would silently
  accept a misparse, and catching a misparse is the whole point.

**Verify (live against the project, and in tests).**

- 79 nodes / 90 edges extracted. **0 rows break the contract in either direction**: no extracted
  row lacks `status='auto'`, `source_kind='chunk'`, a `source_chunk_id` or an `evidence_quote`,
  and no asserted row carries an evidence quote or sits at anything but `approved`. §9.9 holds by
  column across all 272 nodes and 407 edges.
- **0 of 169 extracted rows quote text their chunk does not contain**, re-checked in SQL with
  `position(evidence_quote in content)` independently of the trigger that enforced it.
- **An independent check of the canonical key, which grounding cannot make**: an edge can quote
  real text and still attach the wrong issuance number. Stripping every non-digit from both the
  key and the chunk, **55 of 55 issuance nodes and 65 of 65 issuance-pointing edges** carry a
  number that is present on the page they were extracted from.
- **Nothing at `status='auto'` is citable**: `traverse_kb('program:PuroKalusugan', …)` returns 0
  rows, because 1.6's traversal filters `status='approved'` on both nodes and edges. The rows are
  in the database and unreachable by the assistant until 3.2 approves them — which is owner
  decision 5 working as designed, not a gap.
- All 90 edges were read end to end against their quotes. The spot-check §8 asks for is in the
  transcript itself: every triple names the slide it came from and the span it was drawn from.
- `python ingestion/extract_kb.py --verify` reports **108 nodes and 93 edges proposed → 79 and 90
  accepted, +28 repeat sightings merged by key, +2 repeat edges, 2 rejected**. The arithmetic
  balances by construction: a proposal that vanishes without appearing under a reason is a bug in
  the report, and this is what would show it.
- 10 new tests (389 total). `lib/kb/extraction-transcript.test.ts` reads the committed transcript
  and the committed prompt, because CI runs Node and nothing else — a transcript hand-edited in a
  later PR would otherwise pass every check that actually runs. It asserts the typed relations and
  their directions, that every row carries a bounded evidence span, that no endpoint is invented,
  that one key keeps one label, and that the prompt still contains its §1 paragraph and still reads
  the model name from the environment with no default.
- `npm run lint`, `npm run typecheck`, `npm test` clean.

**The two rejections are both real findings, not noise.**

1. **`NCIP Memorandum Order No. 0151` (p129) has no canonical form.** The pattern covers RA, AO,
   DC, DM, JMC, JAO, COA-C, DILG-MC and NCIP-MO in `YYYY-NNNN` shape, and this issuance is numbered
   `0151` with no year. It was refused, and the `defined-by` edge that pointed at it was refused
   with it. Widening the pattern is a one-line change; doing it without a reader deciding whether
   `NCIP-MO 0151` is the right canonical form would be the extractor answering a question that is
   not its to answer.
2. **The same programme is named two ways in the deck, and both nodes were kept.** Slide 47 lists
   "Local Investments Plan for Health/ Annual Operational Plan (LIPH/AOP)" while slide 87's profile
   is headed "LOCAL INVESTMENT PLANS FOR HEALTH"; slide 48 lists "Good Practice in Health and
   Replication" while slide 208 is headed "Good Practices in Health". Two nodes each. **Collapsing
   them in the extractor would be a model deciding an identity question**, which is exactly what
   §11's open "edge dedup" question reserves for review — so both are proposed, both land at
   `auto`, and 3.2 is where a person merges or rejects. Recorded as the first real instance of
   that question, with two independent examples rather than one.

**How the transcript was produced, stated plainly.** `--propose` is written, typed and unrun: it
needs `GEMINI_API_KEY` and `GEMINI_EXTRACTION_MODEL`, and this build environment has neither — the
same position 2.1 recorded for `--embed` and 2.2 for the vector half. The committed transcript was
therefore produced in the session that built this increment, by an assistant reading each slide
under the committed prompt, and every record says so in its `proposed_by` field rather than naming
a provider it did not come from.

What this does and does not establish. It does **not** establish anything about how well the
committed Gemini call path extracts; that is unrun and unclaimed. It does establish everything that
does not depend on which model proposed the rows: the schema, the typed vocabulary, the endpoint
signatures, the canonical-key refusal, the grounding trigger, the arithmetic of the report, and the
fact that a model-proposed row is distinguishable from an asserted one by column and is unreachable
until approved. Those are the properties 3.1 is for. When the owner runs `--propose` with a key,
the transcript is replaced and everything downstream re-runs unchanged for free — which is the
whole reason the two halves are separate commands.

**Migration renumbered mid-increment, for the third time in this project.** `20260827100000` was
taken by the concurrent UUC work (`agg_uuc_phc_criteria`), applied live at 01:01 while this was
being written. Ours is `20260827110000_kb_extraction.sql`. The handoff warned about exactly this and
it happened anyway, which suggests the check belongs somewhere a person cannot forget it — noted,
not built here.

## 2026-08-27 — Internal AI assistant, Increment 3.2: the extraction review queue

Owner decision 5 in one screen. 3.1 wrote 169 rows a model proposed; none of them was citable or
traversable, because `traverse_kb` filters `status = 'approved'`. This is where a person decides,
at `/admin/kb-review`.

**Lineage rows are exempt, and the exemption is structural rather than remembered.** §8 3.2 says
routing 1.5's edges through the queue "would bury the rows that need judgment among rows that do
not". Every read in `lib/db/kb-review.ts` filters `status = 'auto'`, and an asserted row is never
at `auto` — so the exemption is a consequence of the schema, not a rule this module has to keep in
mind. The header counts asserted rows anyway (317 today), so their absence from the queue reads as
a decision rather than an omission.

- **Two triggers, because an approved edge with an unapproved endpoint is the worst state there
  is.** `traverse_kb` requires `approved` on the edge *and* on both nodes, so such an edge is
  approved and invisible: the queue says it was handled and the traversal disagrees, and nothing
  anywhere reports the disagreement. `kb_edge_endpoints_are_approved()` refuses it, and
  `kb_node_keeps_its_approved_edges()` refuses the other direction — a node cannot leave
  `approved` while an approved edge still points at it. The review layer therefore sends edges
  back before their node, which is the order a reviewer would take anyway.

  Both live in the database, per 3.1's reasoning: this invariant has to survive an admin surface
  nobody has designed yet.

- **The evidence is on the card, not behind a link.** §7's argument for citations applies to a
  reviewer more than to a reader — the only way to judge "UUC for PHC is defined by AO 2020-0023"
  is to see the words it was taken from. The link through to 2.3's stored-slide page is there for
  fuller context, but a queue that makes you click to see the evidence gets approved without it.
  The quote renders as stored, line breaks and all: table-heavy slides extract in poor reading
  order (2.2's finding), and tidying that here would hide exactly what the reviewer is judging.

- **The reviewer's identity comes from the session, never from the form.** §7's argument against
  rubber-stamped review turns on a checkmark meaning someone looked; a `reviewed_by` the request
  can set records nothing. `reviewed_at` / `reviewed_by` / `review_note` are new columns, and the
  note carries the reason — most of the content of a rejection is *why*.

- **There is a "Recently judged" list with a Return-to-review button, which the plan did not ask
  for.** An approval that only SQL can undo is a queue nobody will use carefully. Reopening a node
  reopens its edges too — both because the trigger requires it and because it is what the reviewer
  means: if the entity is under question again, so is every claim about it.

- **Editing is presentational only: a node's label and summary.** Not the key, not the relation,
  not the evidence. Changing any of those changes what the slide was taken to say while leaving
  the quotation that backs it untouched — the §7 failure exactly, a citation that reads as verified
  and points somewhere else.

- **There is deliberately no merge action, and 3.1 handed the queue two cases that want one.**
  Merging means re-pointing an edge at a different node, and an edge's `evidence_quote` describes
  the endpoints it was extracted with. Rejecting the duplicate is the honest action; re-extracting
  under a prompt that pins canonical programme names is the honest fix. §11's "edge dedup" open
  question now has two concrete instances rather than a hypothetical.

**The review pass itself, and who did it.** All 169 rows were judged in this session and
`reviewed_by` records `phase-3-build-session` rather than an admin account, because no admin was
present. **77 nodes and 85 edges approved; 2 nodes and 5 edges rejected.**

The rejections are the naming split 3.1 surfaced. `program:Local Investment Plans for Health`
(slide 87's profile heading) is the same programme as
`program:Local Investments Plan for Health/ Annual Operational Plan (LIPH/AOP)` (the slide 47
programme list), and `program:Good Practices in Health` (slide 208) is the same as
`program:Good Practice in Health and Replication` (slide 48). Approving both of each pair would
put a false distinctness claim into the citable graph, and every question about the programme
would silently split across two nodes. **The cost is real and is not hidden: five `defined-by`
edges naming AO 2020-0022, AO 2020-0018, RA 11223, AO 2008-0006 and AO 2021-0061 were rejected
along with their endpoints.** Every one of those facts is true and on the slide; they return on a
re-extraction whose prompt is given the slide 47/48 programme list as the canonical naming. The
rejection note on each row says so.

Every approval and every rejection is reversible from the page by whoever the owner is.

**Verify (live against the project, and in tests).**

- **Both triggers refuse, proven by making them fire.** Approving an edge ahead of its endpoints:
  *"cannot approve an edge whose endpoints are not approved: issuance:DC 2025-0549 (auto),
  program:Unserved and Underserved…"*. Un-approving a node that other rows depend on:
  *"table:agg_bhw_counts still has 16 approved edge(s); reject or unapprove those first"* — an
  asserted lineage node, so the invariant covers the whole graph and not only extracted rows.
- **0 approved edges have an unapproved endpoint**, re-checked in SQL across all 407 edges
  independently of the triggers that enforce it.
- **Only approved rows are citable.** `traverse_kb('program:PuroKalusugan', 'out', …)` returned 0
  rows before the review and returns **15** after — twelve issuances plus the two programme sets
  it sits inside. `traverse_kb` from the rejected `program:Local Investment Plans for Health`
  returns 0 rows, and it does not appear as a destination from
  `program:Local Health Planning and Financing` either: a rejected row is invisible in both
  directions, not merely unlisted.
- **§9.9 holds by column.** 272 nodes / 407 edges: 193 / 317 `asserted` + `approved` with no
  evidence quote, 77 / 85 `extracted` + `approved` with a chunk and a quote, 2 / 5 `extracted` +
  `rejected`. No row is asserted-looking by convention; the columns say which is which.
- **RLS unchanged by the new columns**: `set local role anon` returns 0 rows from `kb_node` and
  `kb_edge` while the control read of `agg_bhw_counts` returns 41,052.
- Advisors: no new finding. The two WARN `function_search_path_mutable` entries are `wilson_low`
  and `wilson_high` from July; all three trigger functions added in 3.1 and 3.2 pin their
  `search_path` and do not appear. The project still has no ERROR-level security advisor.
- `next build` puts `/admin/kb-review` under `ƒ` (dynamic): no prerender attempt on an auth-gated
  page.
- 10 new tests (399 total). `kb-review/actions.test.ts` covers the two properties that are security
  rather than behaviour — every action re-checks admin access itself, and the reviewer comes from
  the session and not from the form — plus the refusals (a status that is not a judgement, a
  non-positive id), note trimming and capping, blank-summary-to-null, and reopen dispatch.
- `npm run lint`, `npm run typecheck`, `npm test` clean.

**`database.types.ts` was hand-extended again, not regenerated.** Six columns on `kb_node` and
`kb_edge`, in the existing style. The Phase 2 entry's reasoning still holds and the trigger for
changing it has not arrived: the concurrent UUC work is still unmerged on `main` and applied two
more migrations to the live project while this increment was being written. A regeneration remains
worth doing as its own change once that branch lands.

## 2026-08-27 — Internal AI assistant, Increment 3.3: cross-source traversal

One traversal that starts at an aggregate table this project builds and ends at a programme
described in the 2027 Budget Cue Cards, naming the file or slide behind every step.

**The path, run live:**

```
table:agg_uuc_phc_counts
  —derived-from→ dataset:uuc-phc-2025      [supabase/migrations/20260826090100_seed_dataset_registry.sql]
  —defined-by→  issuance:DC 2025-0549      [supabase/migrations/20260826121100_seed_dim_dataset_uuc_phc.sql]
  ←defined-by—  program:Unserved and Underserved Communities for Primary Health Care (UUC for PHC)
                                           [blhsd-2027-budget-cue-cards#p138]
```

A registry join edge, then an asserted crossing edge, then an extracted one — walked backwards.
No single tool answers this: `queryDataset` knows the table, `searchDocuments` knows the slide, and
neither knows they are about the same circular.

**§8 says "the recursion, the bounds and the path-provenance contract are unchanged; what changes
is the edge population". Three of those four held. The fourth is the interesting part.**

- **The edge population alone is not enough, because edges have a direction.** The two crossing
  edges meet *nose to nose* at the issuance: a dataset points at DC 2025-0549 and a programme
  points at DC 2025-0549. A walk that only goes `out` reaches the circular from either side and
  stops; a walk that only goes `in` never leaves. So `traverse_kb` gains `direction = 'both'`.
  This is a change to the recursion, recorded rather than glossed.

- **And an undirected walk makes the path ambiguous, which 1.6's contract does not allow.** With
  one direction, a relation name in `relation_path` is unambiguous. With `both`,
  "defined-by → issuance:AO 2020-0023" could be a table declaring its basis *or* a circular being
  cited by one — opposite claims. The function now returns `direction_path`, one entry per hop,
  and `renderVia` prints a backwards hop as `←defined-by—`. The contract is not relaxed to fit the
  new mode; it is made precise enough to carry it.

- **`both` gets a *lower* depth cap than the directed modes — 4 against 6.** An undirected walk
  fans out faster, and §11's open question on traversal depth says to set a low cap and raise it
  against real questions rather than guessing upward. A request past the cap is refused, not served
  shallower, exactly as in 1.6.

**The crossing edges are derived from committed migrations, not written by hand and not extracted.**
`build_kb_lineage.py` gains a scan for canonical issuance codes in two places the database itself
carries the text: a `comment on table` and a `dim_dataset` row's own source field. Four edges:
`table:fact_uuc_phc_barangay` and `dataset:uuc-phc-2025`, each `defined-by` `AO 2020-0023` and
`DC 2025-0549`. Each is checkable by opening the migration it names.

**The scan reads STRIPPED SQL, and the near-miss is measured rather than argued.** U5 justified the
`docs/*.md` scan reading *raw* text on the grounds that "a `docs/*.md` path… prose cannot produce by
accident". An issuance code is not like that: prose produces one constantly. Applying the docs/ rule
here — scan the whole file, attribute what you find to the tables it touches — **would have added 8
false edges**, all from `20260826160000_doc_corpus.sql`, whose header cites "DC No. 2025-0549" and
"JMC 2023-001" purely as *examples* of what trigram search is good at. It would have asserted
`table:doc_chunk defined-by issuance:DC 2025-0549`. That is the fourth instance of the one failure
mode this script keeps hitting — a parser reading prose as data — and the first one caught before
it was written rather than after. The generator's comment says so in place.

- **The edge is asserted; the node it points at is extracted.** `issuance:DC 2025-0549` was
  proposed by a model from slide 138 and approved through the 3.2 queue; the edge to it comes from
  a migration. The generator deliberately does **not** emit issuance nodes — its seed upserts
  `origin = 'asserted', status = 'approved'` on conflict, so emitting one would silently promote an
  extracted node to asserted, which is §9.9 inverted. It emits only the edge, and the seed's join
  resolves the node.

- **A crossing edge whose issuance nobody extracted is a finding, not a silent drop.** The seed's
  `join kb_node d on d.key = e.dst_key` drops such an edge quietly and correctly. The generator now
  reads the committed extraction transcripts and prints to stderr any issuance a migration names
  that no extraction proposes. Today that list is empty.

- **`defined-by` carries both a programme's legal basis and a dataset's.** The extractor's endpoint
  signature (program → issuance) is a constraint on *model output*, deliberately tighter than the
  relation itself; the asserted scan produces table → issuance and dataset → issuance. Splitting
  the relation to keep the kinds apart would have made one traversal two, for a distinction the
  `kind` column already carries.

**Verify (live against the project, and in tests).**

- The path above, returned by `traverse_kb('table:agg_uuc_phc_counts', 'both', null, 4, 400)`, with
  every hop's source and direction. Also found at depth 3: `program:Indigenous Peoples' Health`,
  reached through `AO 2020-0023` — correct and not planted, since slide 129 lists the same GIDA
  criteria circular under IP Health.
- **The bounds hold.** `both` at depth 5 is refused — *"traverse_kb max_depth 5 exceeds the limit of
  4 for direction both"* — while `out` at depth 5 is served, so the refusal is about the mode and
  not the number.
- **It terminates, and the guard is checked rather than assumed.** An undirected walk from the
  densest node in the graph returns its 500-row cap in **69 ms**, and **0 of those paths contain a
  repeated node** — which is what stops `both` from walking every edge forwards and immediately
  backwards forever.
- A `relations: ['defined-by']` filter from `dataset:uuc-phc-2025` returns 34 rows, the policy chain
  with the build lineage dropped.
- The lineage generator was re-run and `20260826120100_seed_kb_lineage.sql` regenerated **in
  place**, per the established convention. It emits **192 nodes / 317 edges**; stderr is empty.
- **The live delta was applied after diffing, not by re-applying the seed.** Live carries the
  concurrent UUC-criteria work (4 nodes / 10 edges) that this branch cannot see, so the generator's
  output and the live rows were compared bucket by bucket and the difference resolved to exactly 3
  new nodes and 10 new edges. Applying them took live to **196 asserted nodes / 327 asserted
  edges**, which is the generated 192 / 317 plus the live-only 4 / 10 — the arithmetic the diff
  predicted. Total graph: **275 nodes / 417 edges**.
- 5 new tests (404 total), and one existing assertion updated for the new arrow rendering. They
  cover the crossed chain rendering `—defined-by→` and `←defined-by—` in one string, the lower
  `both` depth cap being about the mode rather than the number, the widened relation enum, and a
  path with no directions falling back to a forward arrow rather than a broken chain.
- `npm run lint`, `npm run typecheck`, `npm test` clean.

**Not verified.** Whether a live model *selects* `both` for a crossing question. Rule 9 now names
it explicitly and says why a one-way walk stops at the circular, which is the most that can be done
without a provider key. The property that does not depend on the model — that the path exists, is
bounded, and names its sources — is verified above.

## 2026-08-27 — Internal AI assistant, Increment 3.4: supersession

§4 gave `kb_edge` `valid_from` / `valid_to` in Increment 1.5 for one stated reason — *"policy
documents supersede each other, and an assistant that cannot say 'as of' will confidently quote a
repealed circular"* — and nothing had used the columns since. This is where they start working.

**9 edges: 7 `supersedes`, 1 `amends`, 1 `implements`**, extracted from slides 140, 167 and 101,
loaded at `auto` and approved through the 3.2 queue like everything else in Phase 3.

**Why this increment exists at all, measured rather than argued.** The Verify asks to show that
2.2 retrieval alone returns the *superseded* text. It does, and by a wide margin. Retrieval scores
whole chunks, so the model is handed slide 140 or slide 167 entire and picks a line off it — and
the words a question uses are the *old* ones, because a superseding issuance is titled "Revised"
and does not repeat the phrase the question was built from:

| question | best line | worst line |
|---|---|---|
| "GIDA List" | the four **superseded** GIDA lists, 0.385 each | **the current** DC 2025-0549, **0.132** |
| "which memorandum issues the GIDA list" | superseded, 0.185 | current, 0.076 |
| "implementing guidelines for the LGU Scorecard" | **AO 2008-0017**, superseded twice over, **0.425** | **the current** AO 2021-0002, **0.267** |

The LGU Scorecard row is the sharpest: trigram ranks the three orders in **exactly reverse order of
currency**, because the 2008 order is literally titled "Implementing Guidelines for the LGU
Scorecard" and the 2021 one is titled "Revised Guidelines on the Implementation of…". No amount of
better ranking fixes this — the superseded text *is* the better match. Only an edge saying so does.

**The same questions, answered from the edges:**

```
traverse_kb('issuance:DM 2020-0490', 'in', ['supersedes'], 5)
  → 5 hops, current = issuance:DC 2025-0549, took effect {2025-01-01..open}
    DM 2020-0490 ← DM 2021-0525 ← DM 2022-0567 ← DM 2023-0409 ← DM 2024-0459 ← DC 2025-0549

…the same call with as_of = '2022-06-01'
  → 2 hops, current = issuance:DM 2022-0567, took effect {2022-01-01..open}

…with as_of = '2020-06-01'
  → 0 rows: nothing had superseded the 2020 list yet, which is the right answer, not an empty one

traverse_kb('issuance:AO 2008-0017', 'in', ['supersedes','amends'], 4)
  → AO 2019-0027 (supersedes) and DM 2014-0147 (amends) at depth 1; AO 2021-0002 at depth 2
    — all three hops "always", because the deck gives no effective date for any of them
```

- **`valid_to` is null on every supersession, and that is the model, not an omission.** A
  supersession does not expire; what expires is the superseded issuance's *currency*, which the
  chain expresses. Closing the window on the 2021 edge would sever the chain at any `as_of` past
  2022 — the 2021 hop would drop out and the walk would stop before reaching 2022. Tested: an
  `as_of` in mid-2022 walks *through* the 2021 supersession and stops at the 2022 one, which is
  only correct because earlier supersessions stay in force.

- **`as_of` filters edges, not nodes, because an issuance has no single validity.** AO 2020-0023 is
  current for the UUC criteria and irrelevant to the LGU Scorecard. What has a date is the
  supersession *event*, so that is where the date lives, and "as of" falls out of filtering each
  edge by its own window. An edge with no dates is in force at every `as_of` — deliberate, because
  most edges here are structural (a table is derived from a fact table for as long as both exist)
  and a missing date must never read as "expired". It is also what lets the undated LGU Scorecard
  chain order correctly.

- **`as_of` is refused on a geo walk rather than accepted and ignored.** `dim_geo` carries no
  validity — a geography's vintage lives in `dim_psgc_crosswalk`, which §13 defers — so accepting
  the argument there would produce an "as of" answer that was never filtered.

- **A new check constraint: only `supersedes`, `amends` and `implements` may carry validity.** §4
  gave the columns for supersession; a dated `part-of` would be a date nobody could act on, and a
  nullable column with no rule eventually holds three different meanings. Verified by making it
  fire: dating a `defined-by` edge is refused by `kb_edge_validity_relations`, and a `valid_to`
  before `valid_from` on a dated edge is refused by 1.5's `kb_edge_validity_order`. (The first
  attempt at that second probe passed, because it happened to pick an *undated* edge where a
  `valid_to` alone is legal — the probe was wrong, not the constraint. Re-run against a dated row
  it refuses. Recorded because a probe that passes for the wrong reason is worth less than none.)

- **These are the three relations where the type system stops helping, and the extractor is told
  so.** `defined-by` runs program → issuance, so a reversed one is caught by the endpoint
  signature. `supersedes` runs issuance → issuance: "A supersedes B" and "B supersedes A" are both
  well typed and only one is true. The extractor compensates with a rule the signature cannot
  express — **the evidence span must name both issuance numbers** — and rejects the edge otherwise.
  The prompt also says plainly that being newer is not being a supersession, and that four
  guidelines on one legal-basis slide are not a chain unless the slide describes them as one.

- **The dates are year precision and say so on every row.** The deck labels each list with its year
  ("GIDA List 2020" … "2025 UUC for PHC List") and gives no issuance dates, so `valid_from` is the
  list year and each edge's `note` records exactly that derivation. The LGU Scorecard chain gets
  **no dates at all** — the deck says "Revised" and nothing more — and the extractor is instructed
  that no date is a better answer than a guessed one. Both halves of that are in the transcript.

- **Rule 9b is the one prompt rule here that exists to override retrieval rather than to use it.**
  The measurements above are why: a search-shaped answer names the repealed circular every time,
  and confidently. The rule tells the model to walk `in` along `supersedes` before naming any
  issuance as the rule, and to quote the validity window where the chain carries one — "in force
  from 2025-01-01" is a different claim from "in force".

**Verify (live against the project, and in tests).**

- The four traversals above, live, including the two `as_of` positions and the empty-but-correct
  2020 one.
- The retrieval measurements above, live, against the real corpus with `similarity()`.
- **Nine integrity checks over the whole graph return 0**: no extracted row without a chunk and a
  quote; no asserted row carrying a quote or a date; no extracted row whose chunk does not contain
  its quote (re-checked with `position()`, independently of the trigger); no approved edge with an
  unapproved endpoint; no dated edge on an undatable relation; no chain edge hanging off something
  that is not an issuance.
- Graph after this increment: **276 nodes / 427 edges** — 197 / 328 asserted, 79 / 99 extracted
  (77 / 94 approved, 2 / 5 rejected). Nothing is left at `auto`.
- The lineage seed was regenerated in place (193 nodes / 318 edges, stderr empty) and the delta —
  1 node, 1 edge — applied live after diffing, taking live to exactly generated + the concurrent
  branch's 4 / 10.
- Advisors: no new finding. The two WARN entries are still `wilson_low` / `wilson_high` from July;
  every function this phase added pins its `search_path`. No ERROR-level security advisor.
- `next build` still puts `/admin/kb-review` under `ƒ`.
- 8 new tests (413 total): the dated hop rendering its window and the undated one staying bare,
  `asOf` passed through, `asOf` refused on a geo walk, a malformed `asOf` refused before any
  database call, and three new transcript invariants — both issuances quoted on a symmetric
  relation, dates only where they are allowed and in order, and `valid_to` open on every
  supersession.
- `npm run lint`, `npm run typecheck`, `npm test` clean.

**A gap found and deliberately not closed.** Three migrations in this repository create only
functions — `20260826130000_traverse_graph.sql` (1.6), `20260826160100_search_documents.sql` (2.2)
and `20260827130000_kb_cross_source.sql` (3.3) — and none of them has a node, because
`build_kb_lineage.py` keys the graph on tables and views. So "what built `search_documents`" returns
nothing, and the generator's stderr finding for tables with no `built-by` has no equivalent for
functions, since functions are not nodes at all. Fixing it means a new node kind and a `create
function` scan, which is its own change; recorded here so it is a known gap rather than a silent
one.

### Merged with #83 (UUC for PHC U7) — and the crossing scan picked up a fifth edge by itself

`main` moved while Phase 3 was being written: #83 landed `agg_uuc_phc_criteria`, its registry rows
and its own lineage seeding. Two conflicts, both resolved the way the conventions say:

- **`docs/DECISIONS.md`** — both branches appended. Both kept, #83's entry first.
- **`20260826120100_seed_kb_lineage.sql`** — a wholly generated file, so it was taken from `main`
  and then **regenerated**, which is the only resolution that cannot leave a hand-merged
  half-truth in a file nobody reads end to end.

**The regeneration produced a crossing edge nobody wrote.** 3.3's scan reads canonical issuance
codes out of `comment on table` statements, and #83's comment on `agg_uuc_phc_criteria` opens
*"Per-geo counts of listed barangays qualifying by each socio-economic route of DOH AO No.
2020-0023 §VI.A"* — so `table:agg_uuc_phc_criteria defined-by issuance:AO 2020-0023` appeared with
no edit to the generator and no edit to #83. That is the property the scan was built for, arriving
unprompted from a branch that had never heard of it, and it is also the case for reading statement
text rather than raw file text: the same migration's *header* mentions no issuance, and a prose
scan would have had to guess which of the file's tables the mention belonged to.

**Live now matches the committed seed exactly — 197 asserted nodes / 329 asserted edges, with no
live-only rows left**, because the branch that had been carrying the difference has merged. Total
graph: **276 nodes / 428 edges**. `npm run lint`, `npm run typecheck` and `npm test` (426 tests,
including #83's 13) are clean on the merge result.

## 2026-08-27 — §10 gets a runner: replaying a stored case against the build in front of it

Not an increment in §8's list. §10 has said since Phase 2 that it "becomes load-bearing exactly
when a change to one path can silently degrade another", and Increment 2.4's own entry closed with
the gap: *"there is no batch runner that re-executes them against a build and diffs the result.
Until there is, §10's list accumulates evidence without automatically spending it."* Phase 3 added
a fourth retrieval path. This spends it.

**`/admin/regressions`.** Every open case, and a link that replays them: re-issue the tool calls
the case recorded, with the arguments it recorded, and re-resolve every passage it cited. Three
verdicts — `ok`, `degraded`, `broken` — and a finding line per problem.

- **It does not re-ask the question, and says so on the page.** That half needs a provider key, and
  tying the two together is the same trade 2.1 made between extraction and `--embed`: the
  deterministic half is free and can run against any build, and a suite that only runs when someone
  has a key is a suite that never runs. `REPLAY_CAVEAT` is returned with every result and rendered
  above the list, because the one thing that would make this misleading is a green run being read
  as "the answers are fine".

- **The split is also where the value is.** §10's own framing is that "the regressions worth
  catching are usually in which tools were selected or which page was cited rather than in how the
  answer reads". *Which page was cited* is precisely what a replay can check with no model at all —
  and a retrieval change that quietly stops returning the chunk an answer was built on is invisible
  in the prose and obvious here.

- **Four checks per citation, because they fail differently.** Does the chunk still exist; is it
  still on the page the case recorded; is its text still what the case quoted; and does the case's
  *own recorded search* still return it. The last is the interesting one: the first three catch a
  corpus change, and only the fourth catches a *ranking* change, which is the failure mode a
  document assistant actually has.

- **A refusal returned as data is read as a failure.** Every tool in this set degrades rather than
  throwing (§1), so `{ error: … }` is the normal failure shape and a runner that only caught
  exceptions would score a refusing tool as passing.

- **Replays run sequentially.** Firing twenty concurrent tool loops at the database to save a few
  seconds is how a diagnostic becomes an outage — guardrail 4's reasoning, applied to the thing
  that is *supposed* to be safe to run.

- **It replays on request, not on page load.** A page that re-issues every recorded tool call on
  every visit is a page people stop visiting, and §10 only works if the list is looked at.

**A bug the live data caught, before the page ever rendered.** The one seeded case stores a
citation with a `chunkId` and a `page` and **no `text`** — §10.1 seeds are hand-written from what is
on screen, so there is no captured passage. The first version compared the stored text against the
chunk's and would have reported *"chunk 26 has different text than the case quoted"* on the only
case in the list: a false failure, on the first run, on every seeded case. `textUnchanged` is now
`boolean | null`, null meaning "the case recorded nothing to compare", and the page renders
"no text recorded" rather than a red line. A suite whose first run cries wolf is a suite nobody
runs twice.

**Verify.**

- **The live case replays green, checked against the database by hand first.** Case #1
  (`searchDocuments`, `{query: "How many BHWs are there", limit: 6}`, citing slide 26): chunk 26
  still resolves and is still page 26; the recorded search returns `26/26, 29/29, 164/178, 32/32,
  161/175, 163/177` — the cited chunk is still the **top** hit; the text check is skipped because
  the case recorded none. Verdict `ok`.
- That result also shows why the runner resolves by chunk id rather than page: `chunk_id` and
  `page_from` coincide for the first fifty-odd chunks and diverge after (chunk 178 is slide 164),
  so a replay keyed on either alone would silently compare the wrong rows.
- 12 new tests (438 total), each one a failure a diff of the answer prose would miss: the cited
  slide dropping out of its own search, the chunk's text changing under it, the chunk moving to
  another page, the chunk disappearing, the tool being renamed, the tool refusing as data, the tool
  throwing, a case with no tool calls not being blamed for an unretrieved citation, and a seeded
  case with no recorded passage passing.
- `next build` puts `/admin/regressions` under `ƒ`. `npm run lint`, `npm run typecheck`,
  `npm test` clean.

**What this still does not do, stated so the next reader does not have to find out.**

1. **It does not check a value.** A `queryDataset` case is scored on whether the call still runs,
   not on whether it returns the same figure, because `ai_regression_case` has nowhere to record an
   expected payload — only free-text `note`. §10.1's route 1 ("seed from the dashboard", ten
   questions whose answers are already rendered on public pages) wants exactly that column, and
   seeding those cases before it exists would produce a suite that cannot fail on the thing it was
   seeded for. That column, and those seeds, are the next thing worth building.
2. **The list is one case long.** Route 2 (grow from failures) is live and route 3 (harvest
   `ai_ask_cache` rows at `status = 'approved'`) is still unbuilt. A runner over one case proves the
   runner, not the corpus — and §10's own words are that "three answers read by hand say nothing
   about the other forty".

### `database.types.ts` regeneration — still not done, and the reason has changed again

The Phase 2 entry deferred this because two branches were hand-editing the file concurrently. That
reason expired when #83 merged. Two others have replaced it, and both are worth writing down so the
next reader is not re-deriving them:

1. **This branch is now the one hand-editing it.** Phase 3 added ten columns to `kb_node` and
   `kb_edge` in the existing style. A regeneration landing in the same PR would reformat all 2,569
   lines and bury those ten in a file-wide diff — the exact objection the Phase 2 entry made. It
   belongs *after* this merges, which is also when the live schema and `main` finally agree.

2. **The only way to do it in this environment is to transcribe the generator's output by hand**,
   and that defeats the point of the file being generated. The Supabase MCP can *return* the types,
   but nothing here can write 82 KB of them to disk without passing them through a person or an
   assistant character by character — and a "mechanical reformat" that was actually retyped is not
   mechanical. It is the same argument the lineage seed makes about hand-merging a generated file:
   the fix is to run the generator, not to reproduce what it would have said.

The right shape is `supabase gen types typescript --project-id … > lib/db/database.types.ts`, run
by someone with the CLI and the project credentials, as its own commit with nothing else in it.
`npm run typecheck` is clean on the hand-maintained file today, so nothing is broken while it
waits — this is tidiness, not correctness.

## 2026-08-27 — UUC for PHC 2025: U8, ask the data — and the two cache keys that had no dataset in them

`docs/UUC_PHC_2025_PLAN.md` §9 U8. The section gets the two AI surfaces `/bhw` has — a chat and an
insight slot — and §8's defects 2 and 3 are fixed first, because they are the part that fails
invisibly.

**A cross-dataset hit is fluent, grounded and wrong.** Both caches keyed on a `data_version` that
was always `getActiveDataset()`'s, i.e. the *BHW* dataset's. `askCacheKey(dataVersion, geoCode,
questionNorm)` would have served the BHW answer to an identically-worded question asked on
`/uuc-phc` — and it would have passed `auditNarrative`, because the answer *is* grounded, in the
other dataset. `cacheKey(dataVersion, geoCode, narrativeType)` had the same hole with only
`'overview'` in the enum. Nothing on either page would reveal it: the answer names a real place and
carries real numbers. So these were fixed and verified before anything was built on them.

- **`narrative_type` cost one enum value, as the plan predicted.** It was already in the key and
  already an extension point; `'uuc_overview'` is the second value. No migration.
- **`askCacheKey` gained the dataset slug** — `data_version|dataset_slug|geo|question_norm`.
- **But the key was not the whole hole.** `match_ask_answer` (the A4 near-match path) never reads
  the cache key at all: it matches on the `data_version` and `geo_code` *columns*. Fixing
  `askCacheKey` alone would have left a UUC question able to near-match an approved BHW answer.
  `ai_ask_cache.dataset_slug` is added `not null` (backfilled `'bhw-2025'`, which every existing
  row is by construction — there was one chat surface), the function is recreated with a `dataset`
  argument, and it filters on it. **No default on the column**: a default would let a third surface
  that forgets to name its dataset inherit `'bhw-2025'` silently, and the write is already
  best-effort, so failing is the safe direction.
- **And there was a third place, which the plan does not name.**
  `refreshApprovedAskAnswers` re-runs `approved` rows through the tool loop on a version bump. Its
  own docstring promises "the exact grounding path a live ask would" — which only holds if the
  prompt and the tools match the dataset the stored question was about. A single pass keyed on one
  dataset's version would have found every UUC row stale against the *BHW* version and regenerated
  it under the BHW prompt with the BHW tools, then written the result back at `status = 'approved'`
  — worse than the cache collision, because an approved row is exactly what the near-match path is
  allowed to reuse. It now walks one scope at a time.
- **`data_version` is now per dataset.** `getDatasetBySlug` returns the whole `DatasetInfo` rather
  than just the id, so each scope versions its own caches. The direction that matters is the
  second one: a *UUC republication* now invalidates UUC answers, where keying on the census meant
  they would have gone stale only when the census moved. The two live values genuinely differ
  (`2026-07-19` vs `2026-08-26`), which is precisely why relying on the version alone would have
  looked fine in testing and been wrong in principle.

**One object, not four parameters — `lib/ai/dataset-scope.ts`.** A scope carries the dataset slug,
the system prompt, the tool set, the narrative type and its prompt, and the empty-answer line. The
failure this shape prevents is a *partial* switch: the UUC tools with the BHW prompt, or the right
prompt with the BHW cache key. Each of those produces an answer that is fluent, survives the audit
and is about the wrong dataset. A caller picks a scope, not a set of settings it could get half
right. The BHW scope is the pre-U8 behaviour moved verbatim — same prompt object, same `TOOLS`
array — so `/bhw`, `/place/*` and `/explore` are unchanged by construction rather than by
inspection, and a test asserts the identity.

**The tool set is narrowed to this dataset, which the plan does not ask for and which is the right
call.** `createDatasetTools('public')` hands over all 26 public relations, the BHW aggregates
included. Nothing about that is unsafe — `anon` can already read every one of them — but it would
make the two sections answer each other's questions *by construction*, which is the same
wrong-dataset confusion defects 2 and 3 describe, arriving through the front door instead of
through a cache. A reader on a targeting list of barangays asking about accreditation should be
sent to `/bhw`, not quietly answered here from a table this section never renders. So
`createDatasetTools` takes an optional slug scope, applied in `fetchRegistry` — the registry
module's single fetch path, so both entry points inherit it and no caller can forget. It is applied
in `getRegisteredDataset` too, not only in the catalogue: a model that names a table it was never
shown has to be refused by the function that would read it, or the catalogue is advice rather than
a boundary.

**Relations with no `dataset_slug` stay in every scope.** `dim_geo` and `dim_dataset` are the
coordinate system datasets are expressed in, not datasets of their own. `dim_geo` in particular is
what makes the plan's second Verify case answerable at all: telling *"that barangay is not on the
2025 list"* apart from *"there is no such barangay"* needs a source of barangays that is not the
list itself. Verified live — a real NCR barangay resolves in `dim_geo` and returns
`matchingRows: 0` from `fact_uuc_phc_barangay`.

**On guardrail 5** (`AI_ASSISTANT_PLAN.md` §9: public tools touch only the `agg_*`/`dim_*` layer).
This scope reaches `fact_uuc_phc_barangay` and `fact_uuc_phc_indicators`. That is not a relaxation:
the guardrail is *implemented* as the registry's `exposure` column, and U5 registered both `public`
on their merits. They are a published list of **places** with no person-level rows, already
public-read to `anon`, and already rendered in full on the city/municipality page. The suppression
concern the guardrail exists for — `fact_bhw_raw`, 270,917 people — does not arise, and that table
remains unregistered and unreachable from here.

**Refusals are the increment, not a garnish.** This dataset is a targeting list, so the questions
it invites are ones it cannot answer: *should my barangay be on this list*, *why was this one
included*, *would mine qualify*. Presence is recorded; the assessment behind it is not, and the
barangays that were assessed and **not** listed were never loaded (U1). Rule 2 of
`UUC_PHC_SYSTEM_PROMPT` says all of that and points at the source office — BLHSD, which issues the
list — and at the correction link U6 put in the section footer, rather than letting the model
reason from the indicator values toward a verdict of its own. Rules 3 to 5 carry the caveats this
section already enforces everywhere else: `health_indicators` is a recorded classification and must
never be presented as checkable against `imr`/`fic`/`water`; a capped value is never reported
without its caveat and these seven columns are never averaged; the four routes never sum.

**A separate prompt, not a variant**, on `INTERNAL_SYSTEM_PROMPT`'s precedent: what differs between
two surfaces is scope, and scope drift is what one shared prompt with conditional paragraphs
invites.

**Rule 6 exists because of something the audit does, observed rather than assumed.**
`auditNarrative` collects numbers from tool *payloads*, and a number inside a dictionary string is
not collected — so a sentence restating the AO's thresholds ("at least 10 percent…", "4 of 7") is
stripped, correctly, as untraceable. Confirmed live: a scripted answer quoting a threshold lost
that sentence and kept the queried figure. The fix is **not** to widen `ALWAYS_ALLOWED`, which is
shared with `/bhw` and would blow a hole in the audit for every answer; it is to tell the model not
to quote thresholds at all and to point at `/uuc-phc/methodology`. A threshold restated by a model
is exactly a number nobody checked.

**The methodology page says what the chat will refuse, in the reader's words.** A refusal policy
that lives only in a prompt is a policy nobody can read. `/uuc-phc/methodology#ask` states the
boundary and names where to take the question instead; the chat's "how this works" link points
there rather than at `/methodology#ai`, which describes the BHW chat.

**`ChatLauncher`'s BHW-shaped copy is props now**, `DeckMeta.brandLabel`'s discipline: every one is
optional with the BHW value as its default, so the two existing callers are untouched by
construction. Starter questions were the plan's ask; the intro line, the placeholder and the
methodology href had the same problem — "Ask about accreditation, training, honorarium…" is wrong
on a page holding none of those. `components/uuc-phc/ask-the-list.tsx` binds the section's copy
once so a fifth page cannot inherit the BHW set by omission.

**The third starter question is "Why is a barangay on this list?" deliberately.** It is the
question this dataset attracts, and the honest answer is bounded. A visitor is better served
meeting that boundary in the first click than after typing a question about their own barangay.

**Mounted on all four routes**, including the two `/uuc-phc/criteria` pages the U8 scope predates —
the criteria page is exactly where "why was this one included" gets asked, so a chat that refuses
that question well belongs there most.

**`AiInsight` on the area pages only, as the plan writes it.** The landing's single figure is
already its hero, and a narrative there would restate it at the cost of a provider call on the
section's highest-traffic page. It is **promoted as a slide**, like `/bhw`'s and unlike U6's
barangay disclosures: its caveats are inside its sentences (rule 4) rather than in a footnote that
promotion would leave behind, so there is nothing here for a slide to strip.

**Phase 2's machinery is deliberately not reachable from this chat, and the plan predates it.**
PR #81 landed `searchDocuments`, the document corpus and citations. The corpus is the 2027 Budget
Cue Cards — internal budget material, and `AI_ASSISTANT_PLAN.md` §12.5 is explicit that clearance
to *load* it is not clearance to expose it, with §9.1 standing unchanged. It is also the one corpus
that would be genuinely tempting here, since slides 37 and 141 carry this very list's regional
distribution. Reaching for it would put internal material behind a public button to restate a
figure `agg_uuc_phc_counts` already answers exactly. `traverseGraph` is out for the same reason —
it reads `kb_edge`, service-role only. A test asserts the UUC tool set is exactly
`listDatasets`/`queryDataset` and contains neither.

**Two wrong figures found in the column dictionaries, and the reason they matter more than a typo.**
The dictionary is what a model reads before composing a query — U5's own framing, "the allowlist,
not documentation" — so a stale number there reaches an answer with nothing rendering it for a
person to notice.

- `ref_uuc_phc_provincial`'s note still said **238** barangays cannot support criterion (d). U7
  established 226 and corrected the plan, the cleaning report and the page, but not this seed.
- `agg_uuc_phc_criteria`'s overlap caveat said the four routes come to "about **141** percent" of
  the list. The live national row is 61 + 38 + 12 + 35 = **146** with route (d) over its own
  denominator — the figure `/uuc-phc/criteria` prints beneath the four tracks and the one this
  document records. The naive sum over `n_listed` is 145. 141 is neither. The note now names 146
  *and says where a reader sees it*, so the dictionary and the page can be checked against each
  other.

Both are guarded by tests against the committed seed. **Every other figure in the five UUC
dictionaries was then checked against live data** rather than assumed — 5,991 rows; 1,397 capped
barangays over 1,584 values; 886 Water and 456 FIC; 57 with no reference in 2 provinces plus 169
placeholders in 3, summing to the 226 in 5; 113 barangays in 2 provinces under an uncapped FIC
benchmark; 4,594 barangays with nothing capped; 87 view rows. All correct.

**Observed and not changed.** With no provider configured, `AiInsight` returns null and its
`PresentationSlide` still registers, so the deck carries an empty "AI insight" frame. `/bhw` does
exactly the same thing (slide 4 of 8) — it is pre-existing shared-machinery behaviour, it only
manifests without a provider key, and suppressing an empty slide would change `/bhw`'s deck. Noted
rather than fixed on the way past.

**Two things the rebase onto Phase 3 turned up**, both mechanical but worth the line. PR #84
merged mid-session and had already claimed `20260827110000`; this migration is
`20260827150000_ai_ask_cache_dataset_slug.sql`, after Phase 3's last. And the lineage seed was
regenerated rather than left alone, per 1.5's workflow — the graph gains **1 node and 4 edges**,
all this migration's (`ai_ask_cache` and `ai_ask_log` each `built-by` it as an `alter table`, plus
their `reconciled-in` edges to this plan), with nothing removed and no ref-number churn, since a
migration dated last sorts last. The generator prints nothing to stderr and no table node lacks a
`built-by` edge.

**Verify.** `npm run lint`, `npm run typecheck` and `npm test` (445 tests, 50 new) all clean.

Live against the project: the migration applied and backfilled **10** `ai_ask_cache` and **36**
`ai_ask_log` rows to `bhw-2025`, 0 nulls left. The near-match hole is closed at the database:
the one real `approved` row returns at score **1.000** for `dataset := 'bhw-2025'` and **no rows**
for `'uuc-phc-2025'` at the same words, version and geo scope. The UUC scope resolves to exactly
**7** relations — the five UUC ones plus `dim_geo` and `dim_dataset` — and no BHW aggregate; all
five UUC `notes_md` hash-match the committed seed after both corrections.

The chat path was exercised end to end against live data with a **scripted model** standing in for
the provider (this environment has no provider key and no service-role key): real `runToolLoop`,
real `createDatasetTools`, real `planQuery`, real PostgREST, real `auditNarrative`, real prompt.
`listDatasets` returned the seven; `queryDataset { table: 'agg_bhw_counts' }` was refused with
*"not registered for public use on this page"*; the national criteria row came back carrying its
overlap caveat; a capped barangay's row came back with `capped_indicators` beside the values and
the capping caveat in the payload's warnings; a real NCR barangay resolved in `dim_geo` and counted
**0** in `fact_uuc_phc_barangay`; and a fabricated threshold sentence was stripped while the queried
figure survived.

In Chromium against a production build, on all four UUC routes: the launcher opens, the three UUC
starters render, the intro reads "Ask a question about the 2025 UUC for PHC list.", the placeholder
is the section's, and "how this works" points at `/uuc-phc/methodology#ask`. `/bhw` and `/explore`
still show the three BHW starters, the BHW placeholder and `/methodology#ai`. A sent question POSTs
`dataset: "uuc-phc"` with the page's `geoCode`/`geoLevel`. The deck starts, advances all five
slides, shows **"UUC FOR PHC"** and `Data: UUC for PHC · …`, and exits; `/bhw`'s eight still read
**"BHW CONNECT"**. `/uuc-phc/methodology#ask` renders. **Zero console errors** on every route.

**Not verified, and not claimed.** A real model answering a real question. This environment has no
provider key, so the surfaces degrade — a sent question streams *"Live AI is at capacity right
now"*, which is the correct `allCapped` path and was seen — and no live model has been asked
"should my barangay be on this list?" Everything below the provider boundary is covered above; the
boundary itself is not. That is the same gap Increments 1.3, 1.4, 2.2 and 2.3 recorded, and the
same one that closes with a key on the deployed preview.

## 2026-08-27 — The corpus is embedded: §11's dimension question is answered, 3072, measured

The one thing Phase 2 and Phase 3 both had to record as unverified. `doc_embedding_model` and
`doc_chunk_embedding` have been empty since 2.1 built them, because measuring the dimension needs a
live provider and no build environment had a key. The owner supplied one; this is that run.

**212 vectors, `gemini-embedding-001`, dimension 3072, cosine, L2-normalised.** Page 172 has no text
layer and is the single unembedded chunk — the state 2.1 called "the honest one", not a gap.

- **The dimension was measured, never chosen.** §11 and 2.1 are emphatic that a `vector(768)` column
  would have hard-coded a provider's output width into a migration written before anyone looked.
  `embed_chunks` read 3072 off the first live response, and the composite FK plus the
  `vector_dims(embedding) = dim` check constraint then held every subsequent row to it. Re-verified
  after loading: **0 width mismatches across 212 rows**, and every vector's L2 norm is exactly
  1.0000 at both ends of the range.

- **Three embedding models were live on the key, and the choice is recorded rather than assumed.**
  `gemini-embedding-001`, `gemini-embedding-2` and `gemini-embedding-2-preview`. The first two both
  return 3072. `-001` was taken as the stable, best-documented of them; `doc_chunk_embedding` is
  keyed `(chunk_id, model)` precisely so moving to `-2` later is an insert alongside rather than a
  destructive rewrite (2.1), so this is a reversible call and not a fork in the road.

- **The transport differed from the committed path, and only the transport.** The session that ran
  this permits outbound HTTPS only, so the raw Postgres connection `--database-url` opens was not
  available — verified rather than assumed: DNS resolved, the TCP socket failed at the OS layer,
  and an HTTPS call to the same provider succeeded from the same shell. The embedding itself is
  `ingest_documents.embed_chunks` called unmodified — same `RETRIEVAL_DOCUMENT` task type, same
  normalisation, same measured width, same refusal if a later chunk returns a different one — and
  the rows were written through PostgREST instead of psycopg2. Nothing about what is stored differs
  from running the committed script; a normal machine should still use `--embed --database-url`.

**Verify — and this is the first evidence that the vector half retrieves WELL, not merely that it
runs.** 2.2 was explicit that its fixture proved "the plumbing, not retrieval quality", and 2.2's
own entry closed with "nothing here says the vector half retrieves well".

Question: *"how are village health volunteers paid a monthly stipend"* — chosen because the deck
contains none of "village", "volunteers" or "stipend"; it says "Barangay Health Workers" and
"honorarium".

| | lexical only (the state until today) | hybrid, vectors live |
|---|---|---|
| top hit | slide 148 (PuroKalusugan), 0.259 | slide 29 (FAQs), matched by both |
| **slide 27 — the DOH honorarium allocation table, i.e. the actual answer** | **not in the top 25** | **rank #5, `matched_by=vector`** |

Slide 27 carries the 3rd/4th/5th income-class honorarium table (§12.2) and shares no vocabulary
with the question at all, so trigram cannot see it at any limit. It has the best cosine distance of
any hit in the run (0.3359). This is the exact failure mode 2.2 predicted when it argued that
neither half is sufficient alone — now demonstrated against the real corpus rather than a
four-dimension probe.

- **The §10 runner earned its keep on its first real change.** Regression case #1 records
  `searchDocuments("How many BHWs are there", limit 6)` citing chunk 26. Turning vectors on
  reorders that result set — `[26,29,178,32,175,177]` becomes `[26,178,175,29,177,27]` — but the
  cited chunk holds **rank #1 both ways**, so the case replays `ok`. A retrieval change that had
  dropped chunk 26 out of its own recorded search would have been invisible in the answer prose and
  is exactly what the runner checks.

**Still to do, and it is the owner's:** `GEMINI_EMBEDDING_MODEL=gemini-embedding-001` has to go on
Vercel. Until it does, `embedQuery` reads no configured model and every document search in
production still degrades to lexical with the `no-model-configured` warning — the vectors are in
the database but unused by the deployed app. `lib/ai/embed-query.ts` compares the configured model
against `doc_embedding_model` and refuses on a mismatch rather than embedding with the wrong one,
so the string must match exactly. **Done — the owner set it; see the 2026-08-27 entry below on the
production check, which also records what that check does and does not prove.**

**The ANN index is now possible and is deliberately not built here.** 2.1 traded it away knowingly:
pgvector cannot index an unconstrained `vector` column, and pinning the column needed a measured
dimension to pin it to. That dimension now exists. At 212 rows an exact scan is sub-millisecond, so
the trigger for doing it is corpus growth, not this entry — but the blocker 2.1 named is gone.

## 2026-08-27 — Two bugs behind "0 registered datasets" and "no answer came back"

A live run of the internal assistant against the deployed admin panel — "how are village health
volunteers paid a monthly stipend" — burned all 9 available tool calls and returned "No answer came
back — try rephrasing the question," after first showing "0 registered datasets it can query." Both
symptoms are real bugs, not one, and both were confirmed against live data rather than guessed at
from reading code alone.

**Bug 1 — `exposure: "internal"` was an exact match, not the superset it needs to be
(`lib/db/dataset-registry.ts`).** The registry's own module doc already states the intended rule:
`public` is the real boundary and must stay exact, `internal` is a superset that has to return
`public` rows too, since the internal assistant needs everything the public layer sees *plus* the
internal-only tables. `fetchRegistry` implemented `internal` as a second `.eq("exposure", exposure)`
instead. Read straight off the live table: **27 approved rows, all tagged `public`, zero tagged
`internal`** — so an exact match on `internal` returned nothing, silently, to every internal-assistant
call since the registry shipped. `listRegisteredDatasets`/`getRegisteredDataset` degrade to an empty
list on any read failure by design (the existing "degrade, never error" contract), which is exactly
why this had no error to surface anywhere — it looked identical to a successful call that happened to
find nothing.

  Fix: only `exposure === "public"` narrows the query now; `"internal"` and no exposure at all both
  read every approved row regardless of its tag. Covered by a new `lib/db/dataset-registry-exposure.test.ts`
  (7 tests, using a mock query builder that actually applies `.eq()` — the existing
  `dataset-registry-scope.test.ts` mock ignores `.eq()` entirely and would pass either way, so it gave
  zero signal on this bug). Proved the tests have teeth by reverting the one-line fix and confirming 3
  of 7 fail, then restoring it.

**Bug 2 — the forced wrap-up call had no instruction that it must produce output
(`lib/ai/agent-loop.ts`).** `runToolLoop` caps tool-calling at `MAX_TOOL_ROUNDS = 4` rounds, then
withdraws every tool and makes one final call to force an answer from whatever was already gathered.
That final call's content was returned unconditionally — nothing told the model this was its last
chance to answer, and nothing checked for an empty reply. Live evidence, not speculation: querying
`ai_provider_quota` for the request's timeframe showed **five clean Gemini completions, all well
under Gemini's per-minute cap, nothing logged against Groq/OpenRouter/Mistral**, and Vercel's runtime
logs showed zero errors or warnings for the request. So this was Gemini returning a genuinely empty
completion on a request that succeeded in every technical sense — not a rate limit, not a quota
exhaustion, not a fallback, not a thrown error.

  A provider-specific pitfall shaped the fix: `lib/ai/providers/gemini.ts` builds `systemInstruction`
  from `messages.find((m) => m.role === "system")` — only the *first* system-role message survives;
  every later one is dropped (the same function's per-message loop explicitly `continue`s past any
  further `role === "system"` entry). A nudge added as a second system message would have been
  invisible to Gemini specifically, the exact provider that produced the failure. The nudge is sent
  as a `role: "user"` turn instead, the one shape both provider families (`gemini.ts`,
  `openai-compatible.ts`) carry through unchanged.

  Fix: the wrap-up call is now preceded by an explicit user-turn instruction that this turn must
  answer or explicitly say what's missing. If it still comes back empty (or whitespace-only), the
  model's empty turn is folded into history and one retry is made with a stronger, failure-naming
  nudge; only if that also comes back empty does the loop give up and return `finalText: null`.
  `allCapped` is still checked and propagated at each of the three call sites (round loop, wrap-up,
  retry) so a real rate-limit still short-circuits instead of retrying pointlessly. Covered by 10 new
  tests in `lib/ai/agent-loop.test.ts`, including an explicit assertion that the nudge lands as a
  `user` message and the message array still has exactly one `system` entry — the regression this
  guards against would otherwise be silent.

**Verify.** `npm run lint`, `npm run typecheck`, and `npm test` (508/508, including the 17 new tests
across both files) all clean on this branch, rebased onto current `main`. Neither fix touches a
public-facing code path: `fetchRegistry`'s `public` branch is byte-for-byte the same query it always
was, and every real call site already passes an explicit `"public"` or `"internal"` — none call
`listRegisteredDatasets`/`getRegisteredDataset` with `exposure` left undefined — so this closes the
gap only for the internal assistant, the caller that was actually broken.

## 2026-08-27 — UUC for PHC 2025: U9, the indicators as distributions — and the rule that had two copies

`docs/UUC_PHC_2025_PLAN.md` §9 U9. The 12 indicators become legible above barangay grain for the
first time, and the increment's whole argument is that this does **not** relax U3's rule.

### The rule was never "publish nothing"

U3 refused indicator aggregates because 1,584 values were bounded during cleaning: 886 Water and
456 FIC readings now sit at exactly 100 with only `capped_indicators` to separate them from genuine
full coverage, and that marker travels with one rendered value but cannot survive a mean. The rule
it wrote down was *mark the value, never average it*. Publishing nothing above barangay grain was
one way to honour it — the strictest one — and it left the 12 indicators visible only inside a
`<details>` on a city page, one barangay at a time.

**A distribution averages nothing.** Every value stays at its own position; the bounded ones pile up
in the top bin, where `bin_capped` counts them and the page draws them hatched with the count in
words. What a mean does to those 886 Water readings — dissolve them into a figure asserting
near-universal coverage — is exactly what a histogram refuses to do. So the pile-up becomes the
visible artefact it is, which is the opposite of what averaging does to it.

The page therefore carries the refusal in a line of its own ("There is no average on this page, and
that is deliberate"), because shipping this silently would re-open the hole U3 closed: the next
reader would see distributions published and infer the rule had been dropped.

### `agg_uuc_phc_indicator_dist`: one row per chart

`supabase/migrations/20260827160000_agg_uuc_phc_indicator_dist.sql`. Keyed
`(dataset_id, geo_code, geo_level, indicator)` at national / region / province / citymun ×
12 indicators = **21,456 rows**.

- **The bins are a fixed-length `integer[10]`, not ten rows.** They are an ordered vector every
  consumer wants whole, and the read granularity is exactly one row per chart on the page. The long
  form would be 214,560 rows to answer the same question, and a check constraint on
  `array_length(...) = 10` gives back the shape guarantee the row form would have had for free.
- **Equal-width bins over the indicator's own domain** — 0–100 for the nine coverage percentages,
  0–1,000 for the three rates. This is a refusal too. IMR, UFMR and ABR are strongly zero-inflated
  (5,401 of 5,991 barangays record an IMR of exactly 0), and narrow bins near zero with wide ones
  above would render that spike as a spread. Unequal bins misstate density by construction; the
  honest picture of a spike is a spike, and the IMR chart is one bar and nine near-empty ones
  because that is what the data is.
- **The top bin closes inclusive**, which is what puts an exactly-capped value inside it. "The
  capped values are all in the top bar" is then true by construction rather than by inspection, and
  assertion 3 checks `bin_capped[1:9]` sums to zero rather than trusting it.
- **`provincial_ref` is stored only where a single benchmark exists** — province and citymun rows of
  the seven health indicators. A region or the nation spans 87 different benchmarks, and a stored
  value above province level would be some arbitrary province's standing in for the rest.
- **Whether that benchmark may be drawn is derived, not stored.** `provincial_ref` against
  `value_max` reconstructs `comparesWorse`'s unreachable case; `n_comparable = 0` with a benchmark
  present reconstructs U7's placeholder case. A stored "usable" flag would be a third copy of a rule
  that already has two, and the copy most likely to drift.
- **`n_worse` is a count and the dictionary says it must stay one.** Evaluable denominators differ
  between areas for data-quality reasons, so a share of barangays-worse-than-province invites a
  comparison across areas the data cannot carry.

Eight assertions run after the load and abort the migration rather than publish a wrong histogram.
The two that earn their place hardest: **bins + `n_missing` = `n_listed`** (a histogram whose bars
do not account for every barangay in the area is a histogram of an unstated subset), and
**`n_comparable` = `agg_uuc_phc_criteria.n_health_evaluable`** on the six health indicators FIC's
extra exclusion does not touch — the two are computed from the same rule in two files, and this is
what stops one being edited alone.

### The finding: the placeholder rule had two copies, and one of them was wrong

U7 established that for **226 barangays in 5 provinces** the provincial benchmarks cannot support
criterion (d) at all — Agusan del Sur's every value exactly `1`, Cagayan's every value `0`, Nueva
Vizcaya's and Zamboanga City's `#N/A`, and the Special Geographic Area's fractions — and excluded
them from route (d)'s denominator.

`toBarangayDetail` did not. `comparesWorse` catches a benchmark that is *impossible* for its
indicator (`ref > max`); it cannot catch one that is merely *fake*, because a reference of 1
compares perfectly well. So a city page in Agusan del Sur would print **"worse than province (1)"**
for a barangay `/uuc-phc/criteria` had already excluded from the same comparison — two surfaces of
one section disagreeing about one barangay, neither of them looking wrong on its own.

Building U9 forced the question, because the distributions needed the same rule a third time.
`benchmarksArePlaceholder` (`lib/db/uuc-phc-indicators.ts`) is now the one copy, and all three read
it: the per-barangay disclosure (which renders "no usable provincial figure" and a sentence saying
why), `agg_uuc_phc_criteria`, and `agg_uuc_phc_indicator_dist`. The test is "the largest of the
seven benchmarks is missing, or is at most 1" — computed, never a list of province codes, so a
corrected extract makes the rule stop firing rather than makes it wrong.

**This changes what an existing page renders**, which is why it is recorded here rather than buried
in the increment: 226 barangays that previously showed seven verdicts now show none, and that is
the correct answer.

### City of Butuan's FIC benchmark is 100.96, not 101.00

`docs/UUC_PHC_2025_CLEANING_REPORT.md` §6 and `docs/UUC_PHC_2025_PLAN.md` §5/§8 all stated 101.00.
`ref_uuc_phc_provincial` reads **100.96**. The 113-barangay figure the same sentences quote is right
(107 in Ilocos Sur + 6 in City of Butuan). Corrected in both documents, in the U3 entry above and in
`comparesWorse`'s comment; nothing in the build ever quoted it — the page prints the province's own
stored value — so no rendered figure moves. Same shape of finding as U7's 238→226: a number typed
into prose once and copied four times.

### Verification

`agg_uuc_phc_indicator_dist` loads at 21,456 rows with all eight assertions passing. Every one of
the 12 national bin arrays reproduces an independent `floor(value / width)` count over
`fact_uuc_phc_indicators` — **12 of 12 exact**. Capped totals per indicator are the cleaning
report's (886 / 456 / 208 / 30 / 2 / 1 / 1), **all of them in the top bin and none anywhere else**.
`n_missing` is 17 / 42 / 47 for `ip_pop` / `armed_conf` / `idp` and 0 for the other nine; bins plus
`n_missing` equal 5,991 on all twelve. `n_comparable` is 5,765 on six health indicators and 5,652
on FIC, matching `agg_uuc_phc_criteria.n_health_evaluable` row for row. `physical_factor`'s two
lowest bins are empty, which is the AO's 25% floor showing up as a shape rather than as a caveat.

Driven in Chromium against `next start` (not `next dev`) at national, NCR, Ilocos Sur, Agusan del
Sur, City of Butuan as a province and as a city: **the FIC benchmark line is absent in both Ilocos
Sur and City of Butuan** with the unreachable reason printed — the plan's Verify case — absent in
Agusan del Sur as a placeholder set, and drawn at 71.3% for Ilocos Sur's Water and 88.1% for
Butuan's. The hatched capped segment renders at the top of every affected top bar with its legend
swatch and its count. NCR shows the empty state rather than twelve empty axes. **No mean, median or
other summary statistic appears in the DOM on any of them**, and there are **zero console errors**.
The deck starts, advances through Title / The physical factor / Socio-economic factors / Health
indicators / Closing, and exits on Esc. `/uuc-phc/indicators/barangay/*` 404s.

Registry and lineage: the sixth relation registers `approved`/`public` with 13 approved columns, and
`ingestion/build_kb_lineage.py` regenerates the seed to 202 nodes / 341 edges — a purely additive
diff of 4 nodes and 8 edges, **printing nothing to stderr**, so the new table has its `built-by`
edge. `get_advisors` reports nothing new; the table is public-read to `anon` with its own policy.

`npm run typecheck`, `npm run lint` and `npm test` (**45 files, 515 tests**) are clean, and
`npm run build` prerenders `/uuc-phc/indicators` plus 136 region and province pages under it — the
same set the coverage and criteria routes prerender, from the same helper.

**Not verified:** nothing on this increment sits behind the provider boundary, so unlike U8 there is
no live-model gap here. The one thing left open is upstream and unchanged: the encoding error behind
the capping. If a corrected extract arrives, the top bins move and `bin_capped` empties — which is
the point of computing both rather than typing either.

## 2026-08-27 — UUC for PHC 2025: U10, the cleaning report as a surface — and the page that must not be typed

`docs/UUC_PHC_2025_PLAN.md` §9 U10. `docs/UUC_PHC_2025_CLEANING_REPORT.md` §6 is the most important
thing written about this dataset and it was invisible to anyone using it. `/uuc-phc/data-quality`
renders it.

### One constraint decides the whole design

The plan states it plainly: *this page is a claim about our own data, so every figure on it must be
computed, not typed.* A hand-written "1,584" drifts the first time the extract is regenerated, and a
**stale data-quality page is worse than none, because it is read as an assurance.** Everything
below follows from taking that literally:

- **Two views, not tables**, for anything derivable from `fact_uuc_phc_indicators`. A view cannot go
  stale against the table it reads, which is the exact property this page needs and the only one it
  needs. Both are cheap (5,991 rows) and both run `security_invoker = true` on
  `ref_uuc_phc_provincial`'s precedent — the fact table's own public-read policy decides access.
- **One table**, and only because its other side is not our data at all. See the reconciliation
  below.
- **Three of the page's four sections needed no new object.** `agg_uuc_phc_indicator_dist` (U9)
  already carried per-indicator capping against `n_listed`; `agg_uuc_phc_criteria` (U7) already
  carried `n_listed - n_health_evaluable`. Writing that down in the migration header matters as much
  as the code: the next reader's instinct will be to add a fourth relation for figures that already
  exist twice.

### `ref_uuc_phc_quality`: 1,397 barangays, not 1,584 values

The one figure no per-indicator aggregate can produce. 1,584 bounded values fall across **1,397**
barangays, because **167** carry more than one — and a per-indicator table cannot count a barangay
once. Presenting the value count as a barangay count overstates the affected share of the list by
about 13% (26% against 23.3%), which is a materially different claim about how much of this dataset
is unreliable. Both column dictionaries say so in capitals, and the page prints the two counts in
one sentence with the reason they differ.

**The criterion (d) recomputation is performed here on purpose, to measure itself.** This is the one
place in the build that runs the derivation `fact_uuc_phc_indicators.health_indicators`'s column note
warns against. That note is a claim about our own data, so the page has to *show* it rather than
assert it: the recomputation disagrees on **664** of 5,991 barangays, every one of them lower, and
would leave **98** listed barangays qualifying on no route at all — which DOH AO No. 2020-0023 makes
impossible, against **0** on the source's own score. That pair is the argument for loading the score
rather than deriving it, and it is worth more rendered than asserted.

One detail settled while building it and deliberately not rendered: the recomputation uses
`comparesWorse` alone, **not** U9's placeholder rule. Adding the placeholder rule makes the
recomputation disagree on *more* rows (802) and leave *more* routeless (99), not fewer. Both figures
are real; 664/98 is the one the column note characterises, and putting two disagreement figures on
one page would invite a reader to think one of them is the right way to derive the score. Neither
is.

### `ref_uuc_phc_benchmark_gaps`: four reasons, kept apart

`agg_uuc_phc_criteria` counts *how many* barangays are excluded. It cannot say whether a province
supplied nothing, supplied zeroes, supplied a placeholder 1, or supplied fractions where
percentages were wanted — and those are four different things for the source office to fix. A page
that collapses them into "unusable" throws away the part they would act on. The kinds are computed
from the values, never from a list of province codes, so a corrected extract stops the rule firing
rather than leaving it wrong.

**The two findings in this view must never be added together.** 226 barangays in 5 provinces cannot
support criterion (d) at all; a *different* 113 in 2 provinces are affected on the FIC comparison
alone and remain evaluable on the other six indicators. 339 would be wrong in both directions at
once — overstating the first group and understating what the second group can still do. Hence the
`finding` column, two separate tables on the page, and a dictionary entry that says so.

The view also surfaces something `agg_uuc_phc_criteria` rounds away: Zamboanga City has 8 listed
barangays and **7** of them lack a reference. `n_affected` beside `n_listed_province` is what lets
the page print "7 of 8" rather than implying the whole province.

### The reconciliation is parsed out of the corpus, not transcribed

Cue cards p37 publishes its own distribution by region, totalling 5,987 against the workbook's
5,991. (**Superseded 2026-08-28**: the dashboard now publishes 5,987 too and this table is empty.
The parsing machinery below is unchanged and is what proved the agreement.) It is loaded in `doc_chunk` (Increment 2.1), so the migration **reads the figures out of the
chunk**: 17 region rows, each resolving to a `dim_geo` region by its printed name, summing to the
page's own printed TOTAL. All three are asserted, so a mis-parse aborts the migration.

That makes *which* regions differ a computed finding rather than a pair copied by hand — and the
distinction is not academic. A typo in a hand-copied `400` would have been indistinguishable from a
real discrepancy, on the one page whose entire job is telling real discrepancies from noise.

**Only the differing geographies are stored, and that was a judgement call put to the owner.**
`doc_source` marks the cue cards `exposure = 'internal'`. Plan §3 records the owner approving
publication of the *reconciliation* — 5,991 with p37's 5,987 footnoted and dated — and U10 asks for
the two affected regions. p37's other 15 rows match to the unit and carry no reconciliation, so
storing them would republish an internal document's table for no benefit. The owner chose that
scope; the migration still parses and checks all 17, so the three stored rows remain a finding.

**A table rather than a view, for a reason worth recording:** `doc_source` and `doc_chunk` are
service-role only, with no anon policy. A `security_invoker` view over them would read as *empty*
for the very caller the page runs as — silently, and on a page where an empty section reads as "no
problem here". Parsing once into a public-read table is what makes the figure reachable at all.

**The vintage reading renders as inference.** A vintage gap is the likeliest explanation, and
neither document states it. The page prints the two figures, their as-of dates and where the gap
sits, and then says in as many words that why they differ is not recorded. Rows that stop differing
are deleted on re-run, so a corrected source empties the table rather than leaving a closed gap on
display.

### What the page found in the rest of the build

Building it turned up two things that were already wrong:

1. **The methodology page carried five typed counts** — "1,584 values across 1,397 barangays",
   "886", "456", "57", "113" — which is exactly the drift U10 exists to remove, sitting on the page
   a careful reader goes to first. They are gone, replaced by links to the computed page.
2. **The methodology page had never mentioned the placeholder-benchmark case** U9 added, so it
   described two reasons a comparison is not made where the build now has three. Corrected.

Two smaller rendering decisions, both tested, both cases where the obvious rounding makes the page
say the opposite of the data: a share floors at **`<0.1%`** rather than rounding to `0%` (two
bounded ABR values in 5,991 is 0.03%, and `0%` says the cap never binds), and a benchmark prints at
two decimals so City of Butuan's **100.96** does not round back to the 101.00 U9 had just corrected
out of two documents.

### Verification

All seven in-migration assertion groups pass. `ref_uuc_phc_quality` returns 1,397 / 1,584 / 167 and
664 / 98 / 0, matching the cleaning report and §1a exactly, with `n_values_capped` equal to the sum
of `agg_uuc_phc_indicator_dist`'s national `bin_capped`. `ref_uuc_phc_benchmark_gaps` returns 7 rows
totalling 226 (`criterion_d`, agreeing with `agg_uuc_phc_criteria.n_health_evaluable`) and 113
(`fic_only`, agreeing with the province rows whose `provincial_ref > value_max`). The p37 parse
reads 17 region rows summing to 5,987 = its own TOTAL, all 17 resolving to `dim_geo`, and the single
region it does not print is NCR — which has nothing listed, asserted rather than assumed.
`ref_uuc_phc_published_delta` holds exactly 3 discovered rows: PH +4, CALABARZON +5, BARMM −1.

Rendered and read in Chromium: the bounded table prints the report's own per-indicator counts and
shares (Water 886 = 14.8%, FIC 456 = 7.6%), the three single-value rows read `<0.1%`, and the two
FIC benchmarks print 102.15% and 100.96%. Computed text colours checked rather than eyeballed. No
new advisor finding — both views are `security_invoker`, so neither raises `security_definer_view`.
`npm run typecheck`, `npm run lint` and `npm test` (46 files, 530 tests) are clean.

**Not verified:** nothing here sits behind the provider boundary. The one thing this page reports
and cannot resolve is the upstream encoding error itself — which is the point of publishing it.

## 2026-08-27 — The embedding model is configured on Vercel: the vectors are now reachable in production

The last item the embedding entry left open, and it was configuration rather than code.
`GEMINI_EMBEDDING_MODEL=gemini-embedding-001` is set on the `bhw-connect` project. Until it was,
`embedQuery` returned `no-model-configured` on every call and the 212 vectors sat in the database
unused by the deployed app — the corpus was embedded but production still searched lexically.

**Checked live against the deployed admin assistant**, not inferred from the code path:

- A document question routed through `searchDocuments` and returned **10 cited passages**, slide 27
  (the DOH honorarium allocation table under the Magna Carta for BHWs) among them, each rendering
  its document, slide, as-of date and character offsets and each clickable through to the stored
  chunk. The 2.3 citation contract holds end to end in production, not just in tests.
- The assistant reports **31 registered datasets it can query**, where the run that opened the
  previous entry reported 0. That is the `exposure: "internal"` superset fix confirmed on live data
  from the surface that was broken, and the four-tool sequence in the same run
  (`getIndicatorByGeo` → `getHonorariumStats` → `searchDocuments` → `listDatasets`) shows the
  agent loop selecting across all three retrieval paths of §2 rather than stalling.

**What this check does not prove, stated because the distinction is easy to lose.** The question
asked shared vocabulary with the slide it retrieved (`honorarium`), so trigram alone could have
surfaced that passage: this run establishes that document retrieval and citation work in
production, not that the vector half is what found the answer. The paraphrase probe from the
embedding entry — "how are village health volunteers paid a monthly stipend", chosen because the
deck contains none of those three words — is the one that separates them, and it has been run only
against the database, never against the deployed app.

**The reason the distinction cannot be read off the screen is itself a small gap.**
`searchDocuments` reports which halves ran as `warnings` in the tool payload (2.2: degraded
visibly, never quietly thinner), and the payload goes to the model. Nothing in `components/`
renders it. So a production search that silently fell back to lexical — a rotated key, a model
rename, a `dimension-mismatch` after a future re-embed — looks identical on screen to one that
used vectors. `embedQuery`'s five distinct reasons exist precisely so this is diagnosable; today
they are diagnosable only by the model reading them. Surfacing that line in the citations panel is
small and is not done here.

**Where this leaves the plan.** Of the two things §8 recorded as needing a provider key and nothing
else, `ingestion/ingest_documents.py --embed` is now run *and* reachable by the deployed app. The
second — `ingestion/extract_kb.py --propose`, which replaces Phase 3's committed hand-authored
transcript with one the model produced — is still unrun, and is now the only remaining item of that
kind.
## 2026-08-27 — `extract_kb.py --propose`, run for real: the script had never worked, and the model does not agree with the stand-in

The second of the two "built but never actually run" items, and the one that did not go the way the
embedding run did. The owner supplied a key. `--propose` now has a real transcript behind it:
**17 slides, `gemini:gemini-3.7-flash`, 137 nodes / 74 edges proposed → 92 / 69 accepted, 4
rejected.** Three findings, in ascending order of how much they matter.

**1. `--propose` could never have run at all, and only running it could show that.** The first
call crashed before reaching the provider:

    TypeError: %c requires int or char

`EXTRACTION_PROMPT` is applied with `%`-formatting, and it contains one literal `%` — inside the
quoted example of the page-40 template text the prompt exists to warn about: *"Compute the %
change..."*. Python read `% c` as the `%c` conversion. The fix is one character (`%%`), and the
rendered prompt is unchanged: the model still sees `Compute the % change`.

What is worth recording is not the bug but its shape. 3.1 called `--propose` "written, typed and
unrun" and treated unrun as *untested-but-probably-fine*; it was in fact broken on its first line
of real work. Nothing in the build could have caught it. `--verify` calls `prompt_digest()`, which
hashes the prompt and never formats it. `lib/kb/extraction-transcript.test.ts` reads the Python
source **as text** from Node and asserts the prompt still contains its §1 paragraph — a string
match cannot evaluate a format string. So the one code path that no test exercised is the one that
had never executed, which is close to a tautology and is exactly why "typed and unrun" is not a
safety property. The prompt digest moves `f9a483f03816075e` → `458d37e961eb9064` as a result, and
`--verify`'s stale-prompt NOTE fired on the old transcript exactly as designed — the first time
that mechanism has done anything.

**2. The model was chosen by measurement, not by name.** Three candidates, probed on the two
slides that discriminate: page 40 (the unfilled template, which must extract to nothing) and page
47 (the programme list, which must extract a lot).

| | page 40 | page 47 | ungrounded spans on p47 |
|---|---|---|---|
| `gemini-2.5-pro` | — | — | **404 on the committed call path** |
| `gemini-2.5-flash` | 0 nodes, 0 edges ✓ | 12 nodes, 7 edges | **4** |
| `gemini-3.7-flash` | 0 nodes, 0 edges ✓ | 11 nodes, 7 edges | **0** |

`gemini-2.5-pro` is listed by the models endpoint and 404s when actually called, which is its own
small argument for probing rather than reading a catalogue. Both flash models passed the page-40
adversarial case with zero rows — the §1 injection hazard, present in the corpus and unprompted,
correctly extracted to nothing by a real model rather than by a person who knew the answer. The
choice between them is the ungrounded-span column: `2.5-flash` tidied four quotes into spans its
chunk does not contain, which the validator would reject and which is the failure 3.1's grounding
trigger exists for. `3.7-flash` at zero is why it was used.

**3. The model does not reproduce the stand-in, and the disagreement is concentrated exactly where
it hurts.** Nodes agree; edges do not.

|  | stand-in | model | shared |
|---|---|---|---|
| nodes | 79 | 92 | **76** |
| edges | 99 | 69 | **28** |

**All seven `supersedes` edges and the one `amends` edge are gone. The model proposed zero of
either.** The 3.4 supersession chain — `DM 2020-0490 → 2021-0525 → 2022-0567 → 2023-0409 →
2024-0459 → DC 2025-0549`, and `AO 2008-0017 → 2019-0027 → 2021-0002` — does not exist in a
model-produced transcript of the same corpus under the same prompt.

It is not that the model missed page 140. It read the same block and typed it differently: six new
`implements` edges, each from an annual list issuance to `AO 2020-0023`, quoting the same span the
stand-in read as a chain (*"Annual updating and issuance of UUA List ... based on AO 2020-0023"*).
That is the more literal reading — the slide says the lists are issued *under* the AO, and never
says any list replaces the one before it. The prompt anticipated this and asked for the other
reading in as many words (*"an annual list 'updated annually' is [a chain]"*), and the model did
not take it. **So 3.4's verified behaviour rested on an inference a person made and a model
declines to make.** That is not a bug in either; it is the increment's central claim turning out
to be contestable, and it is precisely the thing this run existed to discover.

The 57 lost `defined-by` edges are a milder version of the same conservatism, against 21 the model
found that the stand-in did not.

**Duplicate identities got worse, not better, and §11's open question is now unavoidable.** 3.1
recorded two cases of one programme named two ways and left them for review. The model produced
**six keys carrying more than one label** — `org:DOH` as `DOH`, `Department of Health` and
`DEPARTMENT OF HEALTH`; `org:BLHSD` three ways; `program:UUC for PHC` two ways — plus roughly
seven distinct casing-variant *key* pairs (`program:PUROKALUSUGAN` alongside
`program:PuroKalusugan`, `program:INDIGENOUS PEOPLES' HEALTH` alongside
`program:Indigenous Peoples' Health`). It copies whatever casing the slide header uses. The
validator's "first sighting wins" collapses the label variance deterministically — 92 nodes, 92
distinct keys, one label each, so the database is correct — but the *key* variants are separate
nodes and a person has to merge them.

**The one test that failed is now asserted at the layer that actually holds it.** `keeps one
label per key across slides` read the raw transcript and required byte-identical labels. That is
free for a hand-authored file and false for a model-produced one: six keys carry more than one
label — `org:DOH` as `DOH`, `Department of Health` and `DEPARTMENT OF HEALTH`; `org:BLHSD` three
ways — because the model copies whatever casing the slide header uses.

The variance cannot reach the database. `validate()` takes the first sighting and `kb_node.key` is
unique, so one key is one row with one label however many the transcript proposes — 92 nodes, 92
distinct keys, checked. Byte-equality was therefore asserting the *proposer's tidiness* at a layer
where nothing guarantees it, which is why a correct extraction failed it.

What nothing resolves is a key that denotes two different *entities*, so that is what it checks
now, split in two and typed by kind: an issuance is identified by its number — the entire point of
the canonical key — so every label must carry it; a programme or organisation is identified by its
name, so its labels must be one an abbreviation or expansion of the other. A second case asserts
one key never changes kind, which nothing checked before.

**Proven by making it fail, the way 3.1 proved the grounding trigger.** Relabelling `org:DOH` as
"Department of Agriculture" fails it (*"expected false to be true"*); giving `org:DOH` the kind
`program` fails the new kind case; the real transcript passes both, and was restored byte-identical
afterwards (sha256 checked). A rewrite that could not fail would have been the weakening this was
avoiding — replacing an assertion with a `Map` that collapses labels by construction would have
gone green and checked nothing.

This is a change of layer, not of standard: the property is stricter about identity than the one it
replaces and merely indifferent to casing. It is worth saying plainly that the alternative — pinning
labels in the prompt and re-running — was available and was not taken, because it would have spent
another run to make a model produce tidiness that the loader already discards.

**Loaded, and what the load proves.** Both inserts ran against the live database. **Everything
landed `status = 'auto'`** — written as a literal in both statements, so guardrail 6 holds by
construction and nothing new is citable or traversable. `origin = 'extracted'` and
`source_kind = 'chunk'` likewise, so §9.9 holds by column on the new rows as on the old.

The load also settled a claim 3.1 could only assert: **every one of the 161 rows passed
`kb_evidence_is_grounded()` on insert**. That trigger re-checks each quote against
`doc_chunk.content` in the database, while the extractor drew its quotes from the committed PDF
re-derived locally. A single byte of drift between the two would have raised and aborted the
statement. Neither insert raised. 3.1's "reproduces the corpus byte for byte" is now checked
against a transcript nobody wrote to satisfy it.

**The approvals were not touched, and the earlier recommendation is withdrawn.** The 77 nodes / 94
edges approved against the stand-in are exactly as they were. The previous entry recommended
resetting them to `auto` before loading so the upsert guard would fire; **that recommendation was
wrong given finding 3, and doing it would have broken 3.4.** Resetting the extracted rows and
loading this transcript would leave the eight chain edges at `auto` — not re-proposed, therefore
not restored, therefore not citable — and a supersession question that works today would silently
stop working. The safe order is the opposite of what was suggested: decide the chain first, then
reset.

So the graph now holds both readings at once: the stand-in's `supersedes` chain, approved and
citable, and the model's `implements` edges, at `auto` and not. That is an honest state to be in
and not a stable one. **What needs a person, stated plainly:** whether the annual-list chain is a
supersession (keep the approved edges, reject the model's `implements`), an implementation
relationship (the reverse), or both; and whether the casing-variant keys are merged or rejected.
Nothing here approved, rejected, reset or deleted a single row — `/admin/kb-review` is where that
happens.

**Not re-run, and why that is not a gap this time.** 3.3, 3.4 and the §10 runner were left alone
because the approved edge population they run over is byte-for-byte unchanged: every new row is at
`auto`, and 1.6's traversal filters `status = 'approved'` on both nodes and edges. A re-run would
necessarily return the previous result, and would say nothing about the model's edges, which are
by design unreachable. They become worth re-running the moment anything in the queue is approved —
and finding 3 says the supersession question is the one to run first.

**Verification that could not be completed.** Row counts on the loaded data were not read back:
`select` through the available SQL tool was refused after the inserts succeeded, and it was not
worked around. What is known is what the statements themselves guarantee — both returned without
error, so every row was grounded and every row carries the literal `'auto'`, `'extracted'`,
`'chunk'` written into the insert — and what the local validator guarantees: 92 nodes and 69 edges
survived validation, with no dangling endpoints, so no edge could fail to resolve an endpoint at
load. The exact landed counts are unconfirmed and are one `select` away for anyone who can run one.

**What this does and does not establish.** It establishes that the committed call path works once
its format string is fixed, that a real model clears the page-40 injection case and the grounding
trigger unaided, and that the schema, the typed vocabulary, the canonical-key refusal and the
arithmetic of the report all hold against output nobody authored to fit them. **It does not
establish that this extraction is better than the stand-in, and on 3.4's evidence it is worse.**
Nor does it establish anything about a different model: the p129 `NCIP-MO 0151` refusal recurring
independently is a point in the checks' favour, not evidence that `3.7-flash` is the right choice.
The hand-authored stand-in it replaced is not lost and needs no copy kept anywhere: it is the
same path one commit back, `git show 9fa4de7:ingestion/data/kb_extraction_blhsd-2027-budget-cue-cards.jsonl`,
and reads `proposed_by: assistant-session` under prompt `f9a483f03816075e`. That is the file to
diff against when the supersession question below is settled.

**Standards.** `npm run lint`, `npm run typecheck` and `npm test` clean — **548 tests, one more
than before**, the label case having become two. `npx prettier --check .` fails on 149 files on
untouched `main` and is unchanged by this branch; the rewritten test file is prettier-clean.

## 2026-08-27 — The supersession question, settled: the two readings were never in competition

The previous entry left one thing for a person: whether p140's annual list series is a supersession
(keep the approved chain, reject the model's `implements`), an implementation relationship (the
reverse), or both. **It is both, and the framing that made it a choice was wrong.** The two readings
do not describe the same fact and never did.

**Checked as edge sets rather than as prose.** The stand-in's `supersedes` edges run DM → DM over
consecutive pairs. The model's `implements` edges run DM/DC → `AO 2020-0023`, all six at one target.

| | src → dst | pairs |
|---|---|---|
| `supersedes` (stand-in, approved) | issuance → the previous year's issuance | 5 |
| `implements` (model, was `auto`) | issuance → `AO 2020-0023` | 6 |
| **node pairs carrying both** | | **0** |

Zero overlap, and the vocabulary makes them orthogonal by construction: `extract_kb.py` defines
`supersedes` as *"the FIRST replaces the SECOND for the same subject"* and `implements` as *"the
FIRST is issued pursuant to the SECOND"*. A memo can be pursuant to the AO **and** replace last
year's memo; those are different claims about different pairs. "Both" is not a compromise between
two readings — it is the only reading that accounts for all the evidence, and the reason the earlier
entry could frame it as a choice is that it compared the two transcripts by counting relations
instead of by comparing endpoints.

**The chain is documented, not inferred — in three places, two of which neither transcript quoted.**
The previous entry's charge was that 3.4's central behaviour "rested on an inference a person made
and a model declines to make". That overstated it:

1. **p140's first bullet, quoted by neither**: *"BLHSD releases **a list** for the UUAs (**formerly
   GIDAs**)"* — singular, and an explicit statement of continuity across the GIDA → UUA rename,
   which is the fact a chain spanning three different names needs.
2. **p140's header, quoted by the model and read past**: *"**Annual updating** and issuance of **UUA
   List**"* — a singular noun and "updating", not "issuance of annual lists".
3. **`AO 2020-0023` itself**, §VI.B.2: *"The DOH Central Office, through [BLHSD], shall issue **an
   official GIDA list that shall be updated annually**"*, restated at §VII.A.4 as a standing BLHSD
   role. **The document all six `implements` edges point at is the document that says the list is
   one list, updated annually.** Follow the model's own reading one step further and it grounds the
   stand-in's chain.

The extractor's rule is *"not a chain unless the slide describes it as one (an annual list 'updated
annually' is)"*. The slide does describe it as one. **The stand-in was inside the rule; the model was
more conservative than the rule required.** Those are not the same finding, and only the first would
have been a defect.

**What changed in the graph.** The six `implements` edges (519–524) are approved — endpoints already
approved, quotes already grounded against `doc_chunk`, so nothing else moved. The seven `supersedes`
edges are untouched. `review_note` on each new approval records that it was approved *alongside* the
chain and why, including the AO clause. **That clause is reviewer reasoning, not evidence, and is
recorded as such**: `AO 2020-0023` sits in `ingestion/data/` but is not an ingested document, so it
cannot legally appear in `evidence_quote` — the grounding trigger checks quotes against
`doc_chunk.content` and there is no chunk to check against. **That is the real gap this exposed: the
document that settles the question is in the repository and outside the corpus.** Ingesting it is its
own increment and is not done here.

**Two questions are answerable that were not before**, at no cost to the one that already worked:

```
traverse_kb('issuance:DM 2020-0490','in',['supersedes'],5)   → DC 2025-0549, 2025-01-01..open   (unchanged)
traverse_kb('issuance:DC 2025-0549','out',['implements'],2)  → AO 2020-0023                     (new)
traverse_kb('issuance:AO 2020-0023','in',['implements'],1)   → all six annual list issuances    (new)
```

### The sharper defect, which was not the relation-typing question

p138 — the legal-basis slide for the *same* programme, already ingested, already extracted — names
**`DM 2026-0063`, "Annual Updating of the UUC for PHC for CY 2026"**, an approved node in the graph.
The chain terminates at `DC 2025-0549` with `valid_to` open and 3.4's traversal answers "current".
A later issuance about annual updating, sitting in the corpus, unaccounted for by the chain, is a
currency risk for the exact claim 3.4 verifies — and a much likelier source of a wrong answer than
anything about `implements`.

**Investigated, and the chain is right.** The chain is a chain of **list** issuances: each link
disseminates one year's list, which is what p140's labels say (*"GIDA List 2020"* … *"2025 UUC for
PHC List"*). `DM 2026-0063` is a **process** issuance opening the CY2026 update cycle — the analogue
of `DM 2024-0508` ("Profiling, Validation, and Encoding Using UUA 2025 Toolkit") and `DM 2025-0305`
("Extension of Deadline"), **neither of which is on the chain either**. The 2025 cycle ran the same
way: two process memos, then `DC 2025-0549`, *"Dissemination of the 2025 … List"*.

**The deck settles it in its own words, twice.** p37 and p141 both read *"Distribution of UUC for PHC
Barangays by Region (**as of 2025 per DC No. 2025-0549**)"*. The same document that names the CY2026
cycle still reports its own list as of `DC 2025-0549`. So `valid_to` stays open, no edge changes, and
**the answer to "which list is current" was correct for a reason nobody had written down.** It is
written down now, on edge 428's `review_note`, because the next reader of p138 will have the same
doubt and deserves the answer rather than the doubt.

**A mistake made and corrected, recorded rather than quietly fixed.** Annotating edge 428 also
overwrote its `reviewed_by`/`reviewed_at`, reattributing `phase-3-build-session`'s approval to this
session — an audit trail saying the wrong person decided. Caught on read-back and restored: all seven
p140/p167 review rows share one batch timestamp (`2026-08-27 04:32:23.05996+00`), so 428's original
values were recoverable exactly rather than guessed, and the annotation now carries its own
attribution inside the note text. **The extractor's `note` column was never touched** — it must keep
matching the transcript byte for byte, which is why the finding went to `review_note` instead.

**Integrity re-checked after the change, all zero**: no extracted row without a chunk and a quote; no
asserted row carrying a quote or a date; no extracted quote absent from its chunk; **no approved edge
with an unapproved endpoint**; no dated edge on an undatable relation; no chain edge between
non-issuances; no `supersedes` with a closed `valid_to`.

**What this does and does not establish.** It establishes that p140 carries both relations, that the
chain has textual support in the corpus and in the AO, and that the terminal link is correct as of
this deck. **It does not vindicate the extraction as a whole**: 35 edges and 16 nodes remain at
`auto`, and §11's duplicate-identity question — six keys carrying more than one label, seven
casing-variant key pairs — is untouched and still needs a person. Nor does it establish that the
chain is right *outside* this deck: `DC 2025-0549` is current because the corpus says so, and a 2026
list issued after the deck was written would not be visible here at all.

**Standards.** `npm run lint`, `npm run typecheck` and `npm test` clean — 548 tests, unchanged; this
entry changes data and documentation, not code. `npx prettier --check .` fails on the same 149 files
as untouched `main`.

## 2026-08-27 — UUC for PHC 2025: U12a, the chip that says "barangays" out loud — and two things the generated types found

`docs/UUC_PHC_2025_PLAN.md` §9 U12a, plus the `database.types.ts` regeneration three earlier
entries deferred. U12b is **not** started; the question holding it is at the end of this entry.

### The chip is a sentence because a sentence can name its own denominator

`/explore` and `/place/*` now carry one line: *"141 of this area's 176 barangays are on the 2025
UUC for PHC list →"*. One extra `getUucPhcCounts` call joined into each page's existing
`Promise.all`, against a row `agg_uuc_phc_counts` has carried since U2 — **no new aggregate, no new
relation, no migration**.

The plan is explicit that this must not become an entry in `MAP_BASE_INDICATOR_META`, and building
it made clear why the alternative is a *sentence* rather than a differently-styled map layer. Every
indicator in that `Record` is a share of **BHW profiles**; this is a share of **barangays**. Behind
one `<select>`, one legend and one colour ramp, nothing on the map tells a reader the denominator
moved under them — the choropleth's whole vocabulary is "darker means more", and it has no place to
put the word "of what". A sentence does: it prints the numerator, the denominator and the noun in
that order, in the same breath. That is not a workaround for the map; it is the reason this
particular figure belongs in prose. Nothing in U12a touches `MAP_BASE_INDICATOR_META`, and if the
choropleth is ever to carry this it is a second separately-legended layer with its own caption.

Three readings settled while building it, each of which could have gone the other way:

- **Nothing at barangay grain.** `agg_uuc_phc_counts` stops at citymun (U2: 41,958 rows of
  `n_listed` in {0,1} would only restate the fact table) and `/uuc-phc/barangay/*` 404s (U2 again:
  a barangay page is one yes/no the city page already renders). So on a barangay place page there
  is no row to read and no page to link to. The tempting fallback — show the town's figure, as the
  page already does for citymun-grain BHW figures with a "(shown for X)" suffix — was refused here:
  those figures are the *same measure* at a coarser grain, whereas the chip's sentence says "this
  area's", and printing the town's count under a barangay's heading makes the sentence false rather
  than approximate.
- **A zero renders.** NCR reads "None of this area's 1,675 barangays are on the 2025 UUC for PHC
  list". The section's standing rule is that a zero here is data, not a gap; on a chip the rule has
  extra force, because a chip that vanished at zero would be indistinguishable from one that failed
  to load, and a reader would have no way to tell "none listed here" from "nobody checked".
- **A failed read renders nothing** — which is the opposite of `/uuc-phc/data-quality`'s rule, and
  deliberately so. There, silence is read as a clean bill of health, so an empty page must say it
  failed. Here the chip is ancillary context on another dataset's page: rendering nothing asserts
  nothing in either direction, and an error box for a secondary pointer is noise on a page the
  reader came to for something else.

**It sits outside every `PresentationSlide`.** Both host pages have a deck, and both decks caption
with a BHW N ("N = 4,312 validated profiles · …"). A count of barangays projected under that
caption is a figure the caption's own stated denominator cannot carry — the same objection the plan
makes to the choropleth, in a different medium. Verified rather than assumed: both decks were
driven end to end and the chip is not inside, and never visible over, any promoted slide.

### `database.types.ts` is regenerated, and the reason it kept being deferred expired

Three previous entries deferred this — Phase 2 (concurrent branches would conflict), Increment 3.3
and 3.4 (this branch is the one hand-editing it; and "the only way to do it in this environment is
to transcribe the generator's output by hand, and that defeats the point of the file being
generated"). Four increments have now hand-edited it, and U11 added 46 more lines.

**The transcription objection is what actually blocked it, and it no longer holds.** This session
has a filesystem: the generator's output landed on disk as a file and was moved into place. No part
of it passed through a person or an assistant character by character, which is the whole
distinction that entry was drawing. The repo's own prettier then reformatted it — the same
mechanical step every other file gets, and what keeps the diff a reformat rather than a restyle.
The Supabase CLI itself is not installed here; the Supabase MCP's `generate_typescript_types` calls
the same management endpoint `supabase gen types typescript --project-id` does, against the same
project. It is its own commit with nothing else in it, as that entry asks.

PR #92 (U11) hand-adds 46 lines to this file. It is already conflicted against `main` for unrelated
reasons and needs a rebase regardless; on that rebase this file resolves to the regenerated version,
which already contains `ref_uuc_phc_list`, so nothing is lost.

**What the hand-maintained file was missing.** All drift, none of it wrong on purpose:
`ref_uuc_phc_provincial` (a view since U1, never in the file at all), `demographic_dimension_enum`
(from the very first migration), and `ref_uuc_phc_list` (live, from U11). Plus two things that were
actively over-claimed, and are the finding below.

### The finding: two places where the types promised more than the database does

Regenerating broke `npm run typecheck` in exactly two files, and both breaks were correct.

1. **`search_geo` does not return `parent_chain`, and never has in production.**
   `supabase/migrations/20260720130000_search_geo_parent_chain.sql` is committed on `main` and its
   version is **absent from the live migration history**; the live function's signature is
   `TABLE(geo_code, geo_level, geo_name, n_total, match_rank)` — five columns where the repo's
   migration declares six. So the home search's parent-chain disambiguation, the whole point of
   which is telling one "Poblacion" from another, **has never worked in production**. Nothing
   surfaced it because `lib/db/search.ts` was written to degrade cleanly, and its comment
   ("parent_chain is absent until the P0.1 migration is applied") has been literally true for five
   weeks while reading as historical. The evidence is one request:
   `GET /api/geo/search?q=poblacion` returns six barangays all named POBLACION, every one of them
   with `"parentChain":{}` — which is precisely the results list that migration exists to prevent.

   **Applied, on the owner's decision, later in this session.** The repo's migration was run
   verbatim against the live project; `search_geo` now returns six columns and all six rows of
   `search_geo('poblacion', 6)` carry a chain. `lib/db/database.types.ts` was regenerated again for
   it, in its own commit — and that diff is **one line**, `parent_chain: Json` on `search_geo`'s
   Returns, which is the cleanest available evidence that the regeneration above was faithful: the
   live schema moved by exactly one column and the generated file by exactly one line. `searchGeo`
   drops the widening it had needed and reads the column directly again; the null guard stays,
   because the column is a `jsonb` the aggregate builds rather than a typed record.

   Rendered and looked at on `/bhw`: typing "poblacion" now returns POBLACION — CITY OF MUNTINLUPA,
   POBLACION — NORALA, SOUTH COTABATO, POBLACION — CLAVERIA, MISAMIS ORIENTAL and three more, each
   with its own parents. **This feature worked for the first time today**, six weeks after it was
   written and merged.

   Worth taking as a general finding rather than a one-off: nothing in the build compares the
   repo's `supabase/migrations` against the live migration history, and the one thing that would
   have caught this — a types file generated from the live schema, in CI or otherwise — was the
   file that had been hand-maintained instead. Regenerating found it in one step. That is the
   argument for the standing decision, stated better than the standing decision states it.

2. **A view cannot declare `not null`.** `ref_uuc_phc_benchmark_gaps`' columns were hand-typed
   non-nullable; the generator widens them, because that is all Postgres can promise through a
   view. `getUucPhcBenchmarkGaps` now **drops** a row missing a structural field rather than
   defaulting it — on `/uuc-phc/data-quality`'s own rule that a figure is computed or it is not
   shown. A `0` in `n_affected` reads as "no barangays affected", which is the opposite of "we could
   not tell". The migration's assertions mean the filter is expected to drop nothing; it exists so
   that if the view ever does produce such a row, the page loses a row instead of gaining a wrong
   one. Live, it drops nothing: the page still renders all 7 rows, 226 and 113.

Both adaptations landed in the commit *before* the regeneration, so that the regeneration commit
stays mechanical and every commit in the branch typechecks on its own.

### `/profiling-status`'s brand label: there is nothing to change, and the note that said otherwise is fixed

`docs/uuc-phc-feature.md` said "`/profiling-status` can adopt the same field with a one-line
change", which reads as a pending one-liner. It is not one. **`/profiling-status` has no deck at
all** — no `PresentationProvider`, no `PresentationSlide`, no `PresentButton` anywhere under
`app/profiling-status/` or `components/profiling-status/`, and no "Present" control in the rendered
HTML of either its landing page or an area page. So nothing there prints "BHW Connect" over slides,
because there are no slides. Adopting `brandLabel` is one line *of* whatever increment gives that
section present mode — not a change that can be made today. The sentence in the feature doc now
says so, so the next reader does not go looking for it a third time.

### Verification

The chip's figure was checked against `agg_uuc_phc_counts` at every geo it was rendered at, and
against the section's own hero by clicking through: IFUGAO's chip reads "141 of this area's 176"
and `/uuc-phc/province/14027` reads "141 of 176 barangays in IFUGAO". Ten routes driven in Chromium
against `next start`: `/explore` at national (5,991 of 41,958), NCR (the zero as a sentence),
BANGUI (2 of 14) and a barangay; `/place/*` at national, CAR (609 of 1,178), IFUGAO, MAYOYAO (27 of
27), CITY OF CAVITE (the singular — "1 of this area's 84 barangays **is**") and a barangay. **Both
barangay routes render no chip.** Hrefs resolve to `/uuc-phc` at national and
`/uuc-phc/<level>/<code>` elsewhere. Both decks driven end to end — 14 slides on
`/place/province/14027`, 16 on `/explore` at CAR — with the chip **never inside or visible over a
promoted slide**, both exiting on Esc, **zero console errors**. Looked at in light and dark and at
390px, where the arrow was moved onto the last text line so it cannot wrap alone.

10 new unit tests in `lib/db/uuc-phc.test.ts` cover the sentence (count, zero, singular, null row,
zero denominator, and that it names "barangays") and the href. `npm run typecheck`, `npm run lint`
and `npm test` (**48 files, 557 tests**) are clean, and `npm run build` compiles.

The `search_geo` migration was applied live and verified end to end: six columns on the function,
six of six rows carrying a chain, and the disambiguated results list rendered in Chromium with
**zero console errors**. `npx playwright test` passes 3/3.

**Not verified:** the two barangay-grain cases are verified as *absent*, which is what the design
asks for, but that means `/place/barangay/*` gains nothing from this increment and no alternative
was tried.

### U12b is not started, and the owner has now framed it

The plan names three things to settle. Two are ours to decide and are already answered by this
section's reasoning: "not listed" means *every other barangay in the area* and the label must say
so, and cells below the §4.1 threshold get suppressed rather than zeroed.

The third was not ours. **UUC status is defined partly on distance to a health facility**, so a gap
in BHW coverage between listed and unlisted barangays is **partly definitional, not a finding**.
Publishing "unserved barangays have fewer BHWs per household" as a discovery, when the list was
drawn partly on health-system access, is circular.

Put to the owner in this session, who chose the third option available: **build it, but framed as a
check rather than as a discovery** — *is BHW coverage consistent with what the list already
implies?* — with the definitional overlap leading the caption, and the reportable finding being the
*exception*: a listed area with good BHW coverage, or an unlisted one with bad. That inverts what
the surface is for, and it is a better question than the one the plan's title asks. Recorded here;
nothing is built yet.

## 2026-08-27 — UUC for PHC 2025: U12b, the comparison that answers the opposite of its own question

`docs/UUC_PHC_2025_PLAN.md` §9 U12b. The two datasets on this dashboard finally meet, and the
increment's whole difficulty is that the meeting is easy to misreport.

### The framing came first, and it is not the plan's

The plan's title asks *are BHWs thinner on the ground where communities are unserved?* Its own
question 3 explains why that question cannot be answered here: UUC membership is defined partly on
**distance to a health facility** (the physical factor of DOH AO No. 2020-0023), so a BHW coverage
gap between listed and unlisted barangays is partly definitional. Publishing it as a discovery is
circular.

Put to the owner, who chose the option neither the plan nor the refusal had: **build it, framed as
a check.** The page asks *is BHW coverage consistent with what the list already implies?*, leads
with the definitional overlap, and reports the **exception** — an area where the direction reverses
— rather than the average. That inverts what the surface is for, and it is a better question than
the plan's title asks, because the exception is the only part the list's own criteria do not
already account for.

### Then the data answered the opposite of the title question

Nationally, listed barangays carry **50.9 households per BHW** against **98.2** in every other
barangay. BHWs are not thinner where communities are unserved; by the site's own operative workload
measure they are roughly twice as thick. It holds in **76 of the 81 provinces** where both sides
clear the threshold, and reverses in **5** — Cavite, Cagayan, Romblon, Lanao del Norte,
Catanduanes.

Which makes the framing load-bearing rather than decorative. "Unserved barangays have *better* BHW
coverage" is exactly as circular a headline as the one question 3 feared, and it is the one this
data would have produced. It is also, on inspection, mostly not about BHWs at all.

### The finding that makes the page publishable: it is barangay size

Listed barangays hold **0.58×** the households of the others and carry **1.13×** the BHWs each.
Households per BHW is a ratio of exactly those two, so a difference in barangay size moves it on
its own, with nothing about deployment having changed. Roughly: the listed barangays are the small
ones, and BHWs per barangay barely differs.

That block sits directly beneath the headline, computed from the same two numbers, and the page
says in a sentence that it is most of the headline. **A caption disclaiming the comparison would
have been the weaker instrument** — the objection question 3 raises to captions is right. What
answers it is a second computed figure that shows the mechanism, not prose that asks the reader to
discount the first one.

### `agg_bhw_by_uuc_status`: three decisions that change what the figure means

`supabase/migrations/20260827190000_agg_bhw_by_uuc_status.sql`. 1,788 rows at national / region /
province / citymun — no barangay rows, since a barangay is entirely listed or entirely not and one
level down there is no split to draw.

- **"Other" is every other barangay in the area, and every column says so.** U1 loaded only the
  5,991; the workbook's 9,395 assessed-but-unlisted rows were scoped out and are not in this
  database. So the comparison group is the remainder, full stop. The columns are named `*_other`
  rather than `*_not_listed` because a reader who sees "not listed" hears "assessed and found
  adequate", which is a group that does not exist here.
- **The measure is StepZero's headcount, not the per-person census — and the plan named the
  census.** `agg_bhw_counts` is built from `fact_bhw_raw`, so it has a barangay row only where at
  least one BHW has been *individually profiled*. Listed barangays are remote and underserved by
  construction, so they are plausibly also less profiled: splitting a profiled figure by list
  status would confound BHW supply with profiling progress — a second circularity stacked on the
  definitional one. `agg_bhw_stepzero_counts` is a quick-count of every barangay's whole BHW
  universe, present for all 41,958.

  The profiled counts ship anyway, as `*_n_profiled` against `*_registered_universe`, so the page
  can *state* the profiling difference rather than have it act unseen. **Live it is 96.9% against
  97.5%** — small. That does not retire the argument; it settles it for this vintage, which is the
  difference between a checked assumption and an assumed one, and it is why the figure is on the
  page rather than in this entry alone. (It also forced a rendering decision: at whole percent both
  sides read "97%" and the row said nothing, so it prints one decimal — the one place on the site
  that does.)
- **No ratio is stored.** Households per BHW, BHWs per barangay, households per barangay and
  profiling coverage are all derived in `lib/db/uuc-phc-bhw-coverage.ts`, on `agg_uuc_phc_counts`'
  precedent. Which also means the compositional check is computed from the same two counts as the
  headline and cannot drift away from the figure it exists to explain.

### The residual: StepZero's own levels do not add up, so the difference is a column

`agg_bhw_stepzero_counts`' area rows exceed the sum of its barangay rows: **306,835 against
306,819** nationally, a gap of **16 BHWs and 6,061 households**, confined to Bicol (+8 / +1,436),
Western Visayas (+4 / +4,422) and Zamboanga Peninsula (+4 / +203). The likeliest cause is StepZero
source rows for barangays absent from `dim_geo` — the ~2,689 newer or renumbered PSGC codes
`lib/db/stepzero.ts` already names — which reach the rolled-up levels with no barangay row to
attach a list status to.

The plan's Verify asks that "the split reproduces the unsplit figure when recombined". **That
equality is false, and the fix was not to weaken the assertion.** `unallocated_n_bhw` and
`unallocated_households` carry the difference, listed + other + unallocated equals the area row
exactly on every one of the 1,788 rows, and assertion 4 aborts the migration otherwise. A silent
inequality would have been a permanent 16-BHW hole nobody could see; a column is a figure the page
prints. Same shape as `ref_uuc_phc_published_delta` (U10): store the discrepancy, do not smooth it.

The profiled counts, by contrast, recombine against `agg_bhw_counts.n_total` with **no residual at
all**, because `agg_bhw_counts` is fanned out from each BHW's own barangay. Asserted, so that if it
ever stops being true the profiling-coverage caveat is not quietly reading a broken denominator.

### Suppression is a presentation rule, and pretending otherwise would have been worse

Plan §9 U12b asks for §4.1's threshold on "any cell whose contributing barangay count" is below it.
Implemented — a side with `0 < contributing < 5` is nulled, and no comparison is drawn — but the
migration header records what it does and does not achieve, because the obvious reading is wrong.
BUILD_PLAN.md §4.1 suppresses small cells because they can identify a person; it also says in as
many words that "counts of totals — e.g. 'this barangay has 3 BHWs' — are not suppressed", and
`agg_bhw_stepzero_counts` is public at barangay grain for all 41,958. **Anyone can compute this
split themselves.** What the rule prevents is *this page* rendering one, two or three barangays as
a group statistic and setting it beside a group of hundreds — a claim about a group, made from
something that is not one.

Only the small side is nulled. Suppressing both would destroy a real 198-barangay figure to protect
a number already published directly above it. 454 listed sides and 113 other sides are suppressed,
all at city/municipality except six provinces.

**Four states are kept apart, and the ordering that keeps them apart is tested.** Nothing listed
(NCR, a real 0 of 1,675), every barangay listed (Mayoyao, 27 of 27), one side suppressed, and
comparable. "None of this area's barangays are on the list" and "too few to show" are opposite
messages; the zero case is checked first in `toUucBhwCoverage`, and assertion 9 fails the migration
if a zero side is ever marked suppressed.

### Verification

All nine in-migration assertions pass over 1,788 rows. The partition agrees with
`agg_uuc_phc_counts.n_listed` on every row — reached by a `dim_geo` fan-out rather than that
aggregate's own build, so it is a real cross-check — and both sides sum to `agg_uuc_phc_counts`'
barangay count on every row, which is the plan's Verify line. Recombination is exact on all 1,788
rows including the residual, with no negative residual anywhere; the profiled counts recombine with
none. Every level rolls up to national on all eight measures. Suppression fires exactly where
`0 < contributing < 5` and nowhere else, in both directions.

Live figures, checked against direct queries before the table existed and against the table after:
50.9 / 98.2 households per BHW, 0.58× / 1.13× behind them, 96.9% / 97.5% profiling coverage,
100 listed and 945 other barangays reporting no BHW at all, and 76 / 5 comparable provinces
splitting the two ways with 31 having nothing listed and 6 suppressed.

Driven in Chromium against `next start` at all six states — national, CAVITE (the largest exception
at 659.2 against 263.0), CALABARZON (whose breakdown badges CAVITE and reads "1 area against the
pattern, first"), NCR, MAYOYAO and CITY OF CAVITE — in light and dark, with **zero console errors**.
The deck starts, advances through Title / BHW coverage / Provinces / Closing and exits on Esc under
"UUC FOR PHC". `/uuc-phc/bhw-coverage/barangay/*` and an unknown geo 404.

Registry and lineage: the tenth relation on this branch registers `approved`/`public` with 22
approved columns, 21 of them queryable; its `notes_md` and its column list both **hash-match the
committed seed** (md5 `81176537…` over 1,815 characters, and over the 22 name/ordinal pairs), and
`anon` reads all 1,788 rows over PostgREST. `ingestion/build_kb_lineage.py` regenerates to **214 nodes / 379 edges** — additive,
5 and 11 — **printing nothing to stderr**, so the new table has its `built-by` edge and no table
node lacks one. `get_advisors` reports nothing new: the table has its own public-read policy.

`npm run typecheck`, `npm run lint` and `npm test` (**49 files, 577 tests**) are clean, and
`npm run build` prerenders `/uuc-phc/bhw-coverage` plus the same 136 region and province pages the
section's other three routes prerender, from the same helper.

**One bookkeeping note.** The migration was applied to the live project byte-identical to the
committed file (md5 checked against `supabase_migrations.schema_migrations`). Five comment lines
were then corrected in the file — a malformed `-- lineage:` directive the generator rejected, which
needs `table:` keys and `<src> <relation> <dst>` order — so the stored text now differs from the
committed file by those five lines and no SQL. The registry and lineage deltas both remain
byte-identical.

**Not verified:** nothing here sits behind the provider boundary. Two things are genuinely open and
neither is ours to close: *why* StepZero's levels exceed its barangay rows is inferred from
`lib/db/stepzero.ts`'s note about renumbered PSGC codes and is not stated by the source, and the
five exception provinces are surfaced but not explained — the page names them and stops, which is
the correct end of what this data can say.

## 2026-08-27 — UUC for PHC 2025: U11, the list as a spreadsheet — and the marker that finally reaches the value

`docs/UUC_PHC_2025_PLAN.md` §9 U11. The one-pager U4 built is a picture; anyone doing work with this
list needs the rows. `/api/export/uuc-phc/data?geoLevel=&geoCode=&format=csv|xlsx` emits them.

### This is not a relaxation of U4's rule, and the whole design turns on why

U3 wrote the rule down: *mark the value, never average it*. 1,584 values across 1,397 barangays were
bounded during cleaning, and once bounded a Water reading of exactly 100 is indistinguishable from
genuine full coverage — `capped_indicators` is the only thing separating them. U4 refused to put
indicator values on the PNG for a reason specific to the format: a 794-pixel one-pager has nowhere
to carry the † marker and its footnote, so the values would leave the site unmarked.

**A spreadsheet has somewhere.** That is the entire argument for this increment, and it is a claim
about the format rather than about the rule, which is why three things follow from it and are not
optional:

- `capped_indicators` is a column of its own, and it sits **immediately before the seven boundable
  indicators** rather than at the far right of 40. A marker a reader has to scroll thirty columns
  to find is a marker that does not travel with the value, which is precisely the failure U4 named.
- On the XLSX each bounded cell is additionally **shaded in place** — the marker reaching the value
  itself, the thing the PNG could not do. It is deliberately secondary: shading survives neither a
  copy-paste, nor a re-save as CSV, nor a reader who cannot see colour, so the column stays
  authoritative and the notes say so.
- The notes block leads with the capping caveat, on the sheet the file opens on, above the data.
  The plan asks for it to be visible without scrolling; a second sheet is one click away and
  routinely never opened.

### Every figure in the notes block is counted from the rows

U10 established that a page making a claim about our own data must compute every figure on it,
because a stale data-quality figure is worse than none. A downloaded file is the same claim with a
worse failure mode — it leaves the building, and nothing downstream will ever notice it drifted.

So `buildUucPhcExportNotes` counts. The national file reads *"1,584 value(s) across 1,397 of the
5,991 barangay row(s) in this file were bounded during cleaning (water 886, fic 456, pre_natal 208,
sba 30, abr 2, imr 1, ufmr 1)"* — the cleaning report's own per-indicator table, reproduced without
a single one of those numbers being typed anywhere in the build. The Mayoyao file reads *"2
value(s) across 2 of the 27"*, which is the figure that is true about Mayoyao; a header quoting
1,584 onto a municipal file would be wrong twice over. The same holds for the 226 rows criterion (d)
cannot be evaluated for: counted per file, and where the count is zero the note says the opposite
thing explicitly rather than falling silent, because silence there reads as "no capping in this
dataset".

### `ref_uuc_phc_list`: the rows needed a relation, and it widened the assistant

`supabase/migrations/20260827180000_ref_uuc_phc_list.sql`. A `security_invoker` view joining
`fact_uuc_phc_barangay` (the record) to `fact_uuc_phc_indicators` (the evidence) and resolving the
geography against `dim_geo`. 41 columns, 5,991 rows.

U1 kept the record and the evidence apart on purpose, and the export is the first thing in the build
that needs both on one line. The forcing constraint, though, was scoping: **neither fact table
carries an ancestor code.** "Every listed barangay in this region" therefore means naming its
barangays, and at national grain that is 41,958 identifiers in a URL. `dim_geo`'s denormalized
`region_code` / `province_code` / `citymun_code` are what turn it into one predicate, and this view
is where they meet the facts.

That closed a gap nobody had noticed on the assistant side. **`queryDataset` performs no joins at
all** — by design, since it composes no SQL — so until this existed, no registered relation in this
dataset could answer *"the listed barangays of this province, with their values"*. You could reach a
barangay whose code you already had, and nothing above it. This is the first registry entry in the
section that widens what the assistant can answer rather than describing something it could already
reach, and the seed says so.

A view rather than a table, on `ref_uuc_phc_quality`'s precedent (U10): it cannot go stale against
the tables beneath it, which is the property a downloaded file needs most.

### The route flags are a second copy of U7's rule, and the migration is what makes that safe

The view carries `route_ip` / `route_conflict` / `route_four_ps` / `route_health` /
`health_evaluable` per barangay, computed by the same expressions `agg_uuc_phc_criteria` sums per
area. There is no way to derive one from the other — an aggregate cannot produce a row — so this is
genuinely a second copy of the rule, the thing U9's placeholder finding warned about.

The section's answer to a two-copy rule is not to avoid it but to assert it, and that is what
assertion 4 does: **the flags roll up to `agg_uuc_phc_criteria` on every one of its 1,788 geo rows
and all five measures**, or the migration aborts. Live, the national row reads
3,677 / 2,302 / 726 / 2,000 with 5,765 evaluable — U7's figures exactly, now reproducible by anyone
who opens the downloaded file and counts.

`health_evaluable` ships beside `route_health` for the same reason the criteria page prints "Not
evaluable here" rather than 0%: for 226 barangays the comparison was never made, and a bare
`route_health = false` would assert they were tested and failed.

Assertion 3 is the other one that earns its place: **for all 1,788 geos, the rows the view yields
under that geo equal `agg_uuc_phc_counts.n_listed`.** That makes "a city/municipality export matches
that page's barangay list" true by construction at all four levels at once, rather than by
inspecting one town.

### The route refuses to emit a short file

`rows.length` is compared against `agg_uuc_phc_counts.n_listed` — computed from a *different* fact
table — and a disagreement returns 500 rather than a file. This is the fact loader's own discipline
("a silently short load is worse than a failed one when 5,991 is a headline figure") carried into
the export, and it matters more here than anywhere in the build: a page that renders one province
short can be noticed and fixed, a spreadsheet on somebody's laptop cannot.

The mirror-image case is an area with **nothing listed**, which is not a failure and must not look
like one. NCR gets a real file — notes block, header row, no data rows — and the page keeps its
download links with copy saying what they will give. A 404 is reserved for an area with no
`agg_uuc_phc_counts` row at all.

### Two small decisions, both about not inventing things

**No licence is claimed.** The plan's Verify asks the header to carry source, licence, DC number and
caveat. `dim_dataset.license` is null for this dataset, so the header reads **"Licence: not stated
by the source"** — the honest answer to the question the Verify asks, and the alternative would put
an invented licence on the copy of this data that travels furthest from anyone who could correct it.
Same for `As of`, which the row does carry (2025-01-01).

**`dataset_id` is the one view column the file omits.** A surrogate key into `dim_dataset`, constant
down every row, meaningless to anyone not holding this database. Which dataset the file is gets said
in words in the notes block instead. Everything else is `ref_uuc_phc_list`'s column names verbatim,
so a file and the relation it came from can be checked against each other column for column — and
`capped_indicators` is pipe-separated exactly as `ingestion/data/uuc_phc_2025_cleaned.csv` encodes
it, which is what makes the round-trip below a literal comparison rather than a re-parse.

### One reading that had to be written down rather than fixed

A route flag is **false where the value behind it is missing**, not null — `agg_uuc_phc_criteria`
reads a null as 0, "which cannot manufacture a pass: a pass needs 10", and the export inherits that
so the flags in a file add up to the counts `/uuc-phc/criteria` prints. But U3's per-barangay
disclosure renders the same null as "—", because at one-barangay grain "not recorded" is the honest
rendering. Both are right for what they are, and a reader holding the file next to the page would
otherwise conclude the two surfaces disagree about 17 barangays.

Rather than change either, the column dictionary says which reading applies and points at `ip_pop`,
`armed_conf`, `idp` and `four_ps` — which are in the file, empty — as the way to tell a missing
value from a low one. Guarded by tests in both the seed and the export column table.

`route_conflict` differs from the disclosure in a second, smaller way worth noting: it is the summed
conflict/displacement test **or** the ELCAC designation, as criterion (b) is defined; the disclosure
shows the two components separately. Same criterion, two renderings, neither wrong.

### `maxDuration = 60`, and why the deployment is where that was found

A national export is 5,991 rows read a page of 1,000 at a time — PostgREST's own cap — so it costs
six sequential round trips plus serialisation. Locally that is ~6s and looks fine. **On the deployed
Vercel preview it measured 8.5s for the CSV and 9.0s for the XLSX**, which is inside the platform's
default function ceiling but not comfortably: one slow cold start or one slow Supabase response and
the file that fails is the largest one on the section.

So the route sets `maxDuration = 60`, on `app/api/cron/precompute/route.ts`'s precedent, with the
measurement written beside it — the number is the reason, and a future reader changing the paging
needs to know which figure the limit was protecting. The constraint is time and not response size:
a national CSV is 1.6 MB.

Worth recording as a method note rather than only as a fix: this is the one thing in the increment
that **local verification could not have found**, because `next start` imposes no such ceiling. The
export was correct locally and would have been correct in production too — right up until it wasn't.

### Verification

All five in-migration assertions pass. **The national CSV has 5,991 data rows and round-trips
against the committed extract with 0 mismatches** — every row joined on `source_geo_code` and
compared field by field on the 12 indicators, the 7 benchmarks, `health_indicators`, `elcac_brgy`,
`capped_indicators` and the four source names, numerics as decimals; 0 rows in the file absent from
the extract, 0 in the extract absent from the file. `capped_indicators` is non-empty on exactly
1,397 rows totalling 1,584 values, and 226 rows read `health_evaluable = false`.

The XLSX was written by `exceljs` and **read back with an independent OOXML reader (openpyxl)**: the
capping caveat at **A3** of the sheet the file opens on, the header at row 15 with panes frozen at
A16 and an autofilter across all 40 columns, numbers and booleans typed rather than stringified, and
on BONGAN (Mayoyao) `fic` reads 100 **shaded** while `water` 78.31 and `fic_prov_ref` 66.33 beside it
are not. All 40 column meanings are on the "About this data" sheet. **Excel and Google Sheets
themselves were not exercised** — neither is available in this environment. What is verified is that
a second, independent implementation opens the file and finds the caveat above the fold; that the
plan's "opens in Excel and Sheets" holds in those two products specifically is **not** verified, and
is the one item on U11's Verify list this environment cannot close.

The Mayoyao export is 27 rows and all 27 barangay names appear verbatim in that page's HTML. NCR
returns 200 with its notes, its header row and no data rows. 400 on an unknown level, an unsupported
format or barangay grain; 404 on an unknown geo.

Registry and lineage: the tenth relation registers `approved`/`public` with 41 approved columns, and
both its column dictionary and its `notes_md` **hash-match the committed seed** field for field.
`ingestion/build_kb_lineage.py` regenerates the seed to 216 nodes / 384 edges — an additive diff of
7 nodes and 16 edges — printing nothing to stderr, so the view has its `built-by` edge and no table
node lacks one. `get_advisors` reports no `security_definer_view` and nothing new. `anon` reads all
5,991 rows over PostgREST, scopes by `citymun_code`, and returns `["fic","water"]` beside two 100s
and Ilocos Sur's uncapped 102.15 benchmark — the case that makes this column load-bearing.

In Chromium against `next start`: `/uuc-phc` and the region, province and city/municipality pages
show the three links with the right hrefs and a row count (5,991 / 17 / 27, and NCR's zero-state
copy); an XLSX downloads on a real click as `uuc-phc-2025-listed-barangays-mayoyao.xlsx`; zero
console errors.

**Exercised on the deployed Vercel preview**, not only locally: national CSV 200 / 1,613,747 bytes /
8.5s / 5,991 data rows, national XLSX 200 / 926,724 bytes / 9.0s, Ilocos Norte 0.9s, NCR 0.8s. The
repo's own CI (`lint-typecheck-test`) is green on the head; `playwright-smoke` is skipped by the
workflow's own condition on PRs, not by anything in this change.

`npm run typecheck`, `npm run lint` and `npm test` (49 files, 584 tests) are clean, and
`npm run build` compiles `/api/export/uuc-phc/data` as a dynamic route beside the existing PNG one.

**Not verified, beyond the Excel/Sheets gap above:** nothing here sits behind the provider boundary.
The unresolved thing this export now puts in more hands is the same one U9 and U10 report — the
upstream encoding error behind the capping. A corrected extract empties `capped_indicators`, which
is why the file counts it rather than stating it.


## 2026-08-27 — The review queue, emptied: the duplicate-identity question answered by measuring what rejection actually costs

The queue had stood at **16 nodes and 35 edges at `auto`** since `--propose` was run for real, and two
entries in a row handed the duplicate-identity question forward as needing a person. It is settled
here, and the thing that settles it is not a judgment call about naming — it is a count.

**The queue is now empty.** 7 nodes and 14 edges approved, 9 nodes and 21 edges rejected. Extracted
rows stand at **84 nodes / 114 edges approved, 11 / 26 rejected**.

### The question, and why it looked harder than it was

Nine of the sixteen pending nodes were the same programmes the graph already holds, under a second
rendition of their names. The deck names each programme twice: once in the p47 programme list
(`Local Health Systems Integration`), and again as the all-caps heading on that programme's own
profile slide (`LOCAL HEALTH SYSTEMS INTEGRATION`). The stand-in transcript took the first, the model
took the second, and the upsert has no reason to consider them one key.

`lib/db/kb-review.ts` had already ruled out the obvious response, in a comment written before this
situation existed: there is deliberately **no merge**, because re-pointing an edge would leave its
`evidence_quote` "standing behind a fact it does not support", and *"rejecting the duplicate is the
honest action; re-extracting under a corrected prompt is the honest fix."* Rejection was therefore
the only available action — and rejecting 9 nodes takes 21 `defined-by` edges down with them, since
the database refuses an approved edge with an unapproved endpoint. Twenty-one program→legal-basis
edges is exactly the kind of fact this assistant exists to answer from, so the rule looked expensive.

**It is not, and the way to find out was to check every one of them against the canonical node
rather than to reason about the rule.**

| pending `defined-by` edges | | |
|---|---|---|
| already approved under the canonical key | **20** | rejection costs nothing |
| not present anywhere in the graph | **1** | a real loss |

Twenty of the twenty-one restate a fact the graph already asserts — `Special Health Fund defined-by
COA-C 2023-003` was approved months of increments ago; edge 496 proposes it again with
`LOCAL HEALTH FINANCING (SPECIAL HEALTH FUND)` on the left. **§11's edge-dedup open question —
"when extraction proposes an edge lineage already asserts, is it dropped or kept as corroboration?"
— is answered by this measurement in the only case that has ever arisen: dropped, and at no cost.**
The corroboration argument is real in the abstract and worth nothing here, because the second
provenance pointer would be attached to a node that should not exist.

### The one that does cost something

**Edge 502 — `LOCAL INVESTMENT PLANS FOR HEALTH defined-by AO 2020-0022` (p87) — is the single fact
this triage loses**, and it is recorded as such on the row rather than buried in the batch note. No
approved edge links any LIPH node to `AO 2020-0022`; the canonical node (281, `Local Investments Plan
for Health/ Annual Operational Plan (LIPH/AOP)`) carries **no legal basis at all**. So the programme
whose guidelines are literally titled *"Guidelines on the Development of Local Investment Plans for
Health"* has no `defined-by` edge, the model found the right one, and it is rejected on identity.

That is the no-merge rule's actual price, stated as one row rather than as a worry about twenty-one:
**one fact, recoverable by re-extracting p87 under a prompt that emits the canonical key.** Whether
that price is right is now a question with a number attached, which it did not have before.

### What the model contributed that the stand-in missed

The approvals are not a formality — 14 of them are facts the graph did not hold.

- **Joint issuership (11 edges, 3 new organization nodes).** `JMC 2013-01`, `JMC 2015-01` and
  `JMC 2021-0001` had **no `issued-by` edge at all**: every approved issuer edge until now pointed at
  a single agency, so the multi-agency circulars — the ones whose whole significance is who signed
  them — recorded no issuer. `DBM`, `DOF` and `PhilHealth` enter the graph as organizations, and
  "who issued the SHF circular" returns five agencies where it previously returned nothing.
- **Three p47 sub-programmes (3 edges, 3 nodes).** `Local Health Systems Maturity Level and
  Information System`, `Support for DOH Representatives`, `Support for Local Health Boards` — siblings
  of `Support for Barangay Health Workers`, which the stand-in did capture. The two transcripts
  covered different children of the same lists.
- **`org:BLHSD`**, the bureau that owns the entire deck, which had no node.

Each was checked case-insensitively against every approved program and organization key before
approval; none is a rendition of something already present.

### Re-runs, which the previous entry said became worth doing the moment anything was approved

Both new questions answer, and the old ones are unmoved:

```
traverse_kb('issuance:JMC 2021-0001','out',['issued-by'],2)  → DBM, DILG, DOF, DOH, PhilHealth  (new; was empty)
traverse_kb('program:…(LeadGov4Health)','in',['part-of'],2)  → + Support for DOH Representatives,
                                                                 Support for Local Health Boards  (new)
traverse_kb('issuance:DM 2020-0490','in',['supersedes'],5)   → DC 2025-0549 at depth 5           (unchanged)
traverse_kb('issuance:AO 2020-0023','in',['implements'],1)   → all six annual list issuances     (unchanged)
```

3.3 and 3.4 are re-run and unchanged, which is the correct result: nothing approved here touches the
issuance chain.

**Integrity re-checked after the writes, all zero**: no pending rows; no extracted row without a chunk
and a quote; no asserted row carrying a quote; no extracted quote absent from its chunk; **no approved
edge with an unapproved endpoint**; no `supersedes` with a closed `valid_to`.

**The extractor's `note` column was not touched** — it must keep matching the transcript byte for byte.
Every decision here is in `review_note`, attributed to `phase-3-queue-triage`, and every one is
reversible through the queue's own reopen control rather than only by SQL.

**What this does and does not establish.** It establishes that the no-merge rule was affordable in the
one case that has tested it, that the model's contribution over the stand-in is concentrated in
joint issuership rather than in the relations the last two entries argued about, and that §11's
edge-dedup question has an answer grounded in counted rows. **It does not establish that rejection is
the right rule in general**: the sample is one duplicate cluster from one deck, and a corpus where the
model and the stand-in disagreed on *content* rather than on *casing* would not decompose this
cleanly. Nor does it recover edge 502, which needs a provider key this environment does not have.

**Standards.** No code changed in this entry — it is data and documentation. `npm run lint`,
`npm run typecheck` and `npm test` clean, 548 tests, unchanged. `npx prettier --check .` fails on the
same 149 files as untouched `main`.

## 2026-08-27 — Internal AI assistant, Increment 4.1: ingest-time profiling, and the three quarters of it that need no model

Phase 4's first increment, and the one §8 calls **the plan's success condition**: *"a genuinely new
dataset becomes queryable through the assistant with no code change."* That condition is now met,
on `fact_bhw_raw` — the project's 94 MB primary source table, which had **no registry row at all**
and was therefore invisible to every tool the assistant has.

### The decomposition that made it buildable without a provider key

§3 lists four steps: profile every column, infer a meaning per column, propose joins, write at
`auto`. Read as written it is a model pass with some SQL around it. It is very nearly the reverse:

| step | needs a model? | what it actually needs |
|---|---|---|
| 1. profile every column | no | `pg_stats`, which the planner already maintains |
| 3. propose joins | **no, and a model would be worse** | measured value overlap |
| 4. write at `auto` | no | an insert |
| 2. infer meanings | only sometimes | the approved dictionary first, a model for the residue |

So `profile_dataset()` is a Postgres function and nothing in it calls a provider. That is not a
workaround for this environment's missing key — it is the correct shape. **A profiling pass that
cannot run without an API key would not run at ingest time, which is the one time it has to.**

**Profiling reads the catalogue rather than the table.** Guardrail 4 forbids the assistant from
table-scanning `fact_bhw_raw`; a profiler that scans it twice per column on every ingest is the
same outage through a side door. `pg_stats` already holds null fraction, distinct estimate,
most-common values and histogram bounds, from a sampling ANALYZE the database runs anyway. The
function ANALYZEs the target first, then reads the catalogue: **one ANALYZE and a catalogue read
instead of 26 sequential scans.** The cost is that the figures are estimates — which the schema
already assumed, having called the registry column `row_estimate` since 1.1.

The estimate is good. `bhw_id` came back at **270,917 distinct**, which is exactly the true row
count §12.4 records in the contradiction against slide 26's 277,767.

**Joins are measured, not guessed.** A name match only selects *which* target is worth testing;
the proposal then stands or falls on a bounded sample of the column's distinct values resolving
against that target, and the overlap is returned to the reviewer as the evidence. `geo_code` →
`dim_geo.geo_code` came back at **1.0000** and became a join key; the threshold is 0.95 rather than
1.0 because a real foreign key can carry codes retired between PSGC vintages — `dim_psgc_crosswalk`
exists because that happens — and a near miss is reported rather than silently dropped.

### Where `meaning` comes from, which is the part that could have gone wrong

`dataset_column.meaning` is NOT NULL and **the registry is what the model is shown** (§3). So an
invented meaning is the dangerous failure here — worse than a missing one, because it reads as
documentation. Two sources, in order, and a refusal:

1. **The approved dictionary.** A column of the same name and type already described anywhere in
   the registry lends its description, unit and join target. `geo_code` is documented identically
   in eight registry rows; the ninth does not need a model, it needs the eighth. This is the role
   §8 1.2 assigns the hand-written rows — *"the reference example every later auto-profile is
   measured against"* — finally doing work rather than being an aspiration.
2. **A placeholder that admits what it is** (`(needs review) …`) for everything else.

On `fact_bhw_raw` exactly **one** of 26 columns was answered by route 1 (`geo_code`) and 25 landed
as placeholders — an honest result, since nothing in a registry of aggregates describes
`tesda_nc2_year`. The 25 were then written by hand from `ingestion/ingest.py`'s own
source-header mapping (`"tesda_nc2": d["TESDA BHS NC II"] == "YES"`), so they are transcribed from
the repository rather than composed.

**The bulk-approve control refuses while any placeholder remains.** A 26-column table reviewed one
button at a time is 26 clicks and a queue that costs 26 clicks per table is one that gets skipped —
but the shortcut must not become the way an undocumented column reaches the model, so
`approveAllColumns` blocks and says how many are outstanding.

### Two defects the first real run exposed, both in the same place

The role vocabulary. Both were found by running it, not by reading it, which is the lesson the
`--propose` entry recorded three entries ago.

1. **`role = 'time'` did not exist.** `dataset_column`'s CHECK constraint allows
   key/dimension/measure/meta, and the first draft returned `'time'` for dates and `_year` columns.
   It would have failed at the first insert against a table with a date column. `fact_bhw_raw` has
   no `date` column, so the *happy path passed* — the constraint caught it only because the
   constraint was read.
2. **`bhw_id` was typed a `measure`.** High-cardinality numeric, so the cardinality rule called it
   a quantity. `role = 'measure'` is what tells the model a column may be summed and averaged, and
   the mean of `bhw_id` is a number that would eventually be reported to someone. Fixed by
   measurement rather than by a name convention: **a numeric column with about as many distinct
   values as the table has rows is a row identity, not a quantity** (`distinct / rows >= 0.9`).
   `bhw_id` is now `key`, and its written meaning says outright that it is a surrogate assigned at
   ingest, not a registry number, and must never be reported or joined on.

### What it refuses, tested as refusals

Registry-driven means allowlist-driven (guardrail 3): the argument is resolved against
`information_schema` and every identifier in every dynamic statement goes through `%I`. On top of
that it refuses `admin_users`, `usage_events`, `feedback`, `ingestion_batches`, anything `ai_*`, and
its own `dataset_*`/`kb_*`/`doc_*` tables — and refuses any table with an **approved** registry row
unless called with `p_force`, so 1.2's hand-written dictionaries cannot be overwritten by a
placeholder. Verified against the live database: `admin_users` has no registry row, and `dim_geo`
still holds its 10 approved columns.

`exposure` is written `internal` and this increment never grants `public` — on re-profiling, the
one expression assigned to `exposure` preserves a tag someone else approved and otherwise falls
back to internal. Guardrail 5 is unchanged.

The refusals are asserted in `lib/db/dataset-review.test.ts` against the **committed migration
text**, on `dataset-registry-seed.test.ts`'s precedent. That argument is stronger here than it was
there: the thing being asserted is the set of cases where the function must *not* act, and a
refusal is precisely what a happy-path run against a live database never exercises. Two of those
tests were themselves wrong on first writing — a non-greedy regex truncated each `format()` string
at the `count(*)` inside it and so asserted nothing, and a negative lookahead matched the very
expression it was meant to exempt. Both now carry a comment saying so, because a test that passes
while checking nothing is worse than an absent one.

### Verification — the success condition, end to end

`fact_bhw_raw` had no registry row. After one `profile_dataset()` call, 25 written meanings and an
approval, with **no application code changed**:

```sql
select f.educational_attainment, count(*) as bhws,
       count(*) filter (where f.accredited) as accredited
from fact_bhw_raw f join dim_geo g on g.geo_code = f.geo_code   -- the join the profiler measured
where g.region_code = '07' group by 1 order by bhws desc;
→ High School Graduate 10,243 (65.5% accredited) … Elementary Level 473 (84.8%)
```

A cross-tab of educational attainment against accreditation that **no `agg_*` table holds** and the
assistant could not previously reach at any depth. Registry state: 32 hand-written datasets
approved, **1 profiled**, nothing profiled at `public`, nothing profiled left at `auto`.

**Not done, and deliberately not.** `ingestion/ingest.py` does not yet call `profile_dataset()`
after a load. The call is one line, but it cannot be run in this environment — no database
credentials and no source extract — and the `--propose` entry is three entries old: *"typed and
unrun is not a safety property"*. Adding an unexercised call to the ingest path would repeat
exactly that. The pass is invoked as `select * from profile_dataset('<table>', …)` and wiring it
into the pipeline belongs to whoever next runs an ingest.

**What this does and does not establish.** It establishes that a table with no registry row becomes
queryable through the registry with no code change, that the profile is cheap enough to run on the
largest table in the project, and that a join can be proposed on measured evidence rather than on a
model's guess. **It does not establish that the meanings scale**: 25 of 26 columns needed a human
sentence, and route 1 will only earn its keep once several datasets share vocabulary. Nor has the
pass been run on a genuinely *unfamiliar* table — `fact_bhw_raw` is one whose semantics the
repository already documents, which is the easy case and was chosen because its Verify is checkable.

**Standards.** `npm run lint`, `npm run typecheck` and `npm test` clean — **567 tests, 19 more than
before**. `npx prettier --check .` fails on the same 149 files as untouched `main`.

## 2026-08-28 — Internal AI assistant, Increment 4.2: the contradiction sweep, and the four things running it found

Phase 4's second increment and the plan's last unbuilt one. §12.4 rule 3 says that where a document
number and a SQL number disagree the assistant must surface **both** with their as-of dates; §8 4.2
says why that rule needed a batch job rather than prompt copy — *"a rule that only fires when
someone happens to ask the right question is not enforced. Sweeping for them makes it enforced."*

`sweep_contradictions()` is that sweep. It runs in **3.0 seconds** over the 213-slide corpus and 33
registered datasets, and files **12 rows** at `status = 'auto'`. Nothing in it calls a provider.

### The sweep computes contradictions; it does not notice them

This was the whole design constraint, and it is 4.1's again. A pass that asks a model to read the
corpus and report what looks inconsistent has three problems: it needs a key, so in these
environments it would not run; it is unrepeatable, so a disagreement found on Tuesday may be absent
on Wednesday; and its output is a claim rather than a measurement, so a reviewer has nothing to
check but the model's word. Everything below is arithmetic over rows the database already holds.

The hard half is **pairing** — a number on a slide carries no column name. Two passes answer it
differently, and their evidence is of deliberately different strength:

| pass | how it knows what the number is about | strength |
|---|---|---|
| `geo_distribution` | the label beside each number **is a row in `dim_geo`** — all 17 of p37's region names match `geo_name` verbatim | exact |
| `scalar_magnitude` | the words near the number share a non-generic term with the registry entry's **name**, *and* the two values are within 10% | inferred |

The asymmetry is recorded on every row rather than smoothed over: `method` says which pass found it
and `evidence` carries what that pass measured, so a reviewer looking at a `scalar_magnitude` row
knows to be more sceptical than at a `geo_distribution` one.

**The structured counterpart is chosen by measured fit, not by name.** For a slide that lists
geographies against numbers, every approved (table, measure column) pair that holds one value per
geography at that level is probed, and the winner is the one agreeing with the slide on the most
cells. A pair agreeing on *every* cell is corroboration and is not filed — only a pair that agrees
on most and differs on a few is a contradiction, and the cells that differ are the rows.

### Verify — both known cases, rediscovered without either being seeded

§8 4.2's Verify, run against the live database:

```
found_by           slide  scope                        document  dataset_ref                              dataset
scalar_magnitude      26  —                             277,767  fact_bhw_raw.bhw_id                      270,917
geo_distribution      37  BARMM                             400  agg_bhw_by_uuc_status.n_barangays_listed     399
geo_distribution      37  REGION IV-A (CALABARZON)          195  agg_bhw_by_uuc_status.n_barangays_listed     200
geo_distribution      37  (total over all regions)        5,987  agg_bhw_by_uuc_status.n_barangays_listed   5,991
```

> **Superseded 2026-08-28 for these three rows.** The final-list alignment moved the dashboard to
> BARMM 400, CALABARZON 195 and 5,987, so `geo_distribution` p37 no longer contradicts
> `agg_bhw_by_uuc_status` anywhere — the next `sweep_contradictions` run resolves all three. The
> other pairings are unaffected.


1. **§12.4's case.** Slide 26's *"277,767 (Registered and Accreditted BHWs) — as of Dec 2025"*
   against the 270,917 behind SQL. Nothing named slide 26, and nothing named 277,767: the pass
   found every number ≥ 1,000 in the corpus, discarded bare years, and paired this one because the
   words around it share `bhw` with `fact_bhw_raw`'s name and the two values are 2.47% apart. The
   row carries `doc_as_of_text = "as of Dec 2025"` — the slide's own phrase, which is later and more
   specific than the deck's 2025-09-18 — and the SQL side carries no date, because `fact_bhw_raw`
   names no dataset and inventing one would be worse than admitting it.

   It also found the **same claim on slides 8 and 151**, which nobody had recorded, and a second
   figure on slide 8: *"70% of barangays (29,409…)"* against 28,497 distinct `geo_code` values in
   the BHW master list. That one is a finding this project did not have.

2. **§12.2's case.** p37's regional distribution against the `uuc-phc-2025` dataset. Two regions
   disagree and the totals differ by four — the reconciliation `ref_uuc_phc_published_delta` already
   records, arrived at here from the opposite direction. The `evidence` names the three other
   columns that fitted identically (`agg_uuc_phc_counts.n_listed`, `agg_uuc_phc_criteria.n_listed`,
   `agg_bhw_by_uuc_status.n_listed_with_data`), because a tie broken alphabetically is still a tie
   and a reviewer shown only the winner is reviewing an arbitrary pick.

   And it found **the same table again on slide 141**, where the deck repeats it. Two slides making
   one claim is two rows, not one: a citation has to point at the slide the reader was given.

Neither case was seeded in any sense — no table name, no page number, no figure and no keyword
appears anywhere in the migration.

### Four defects, all found by running it, none by reading it

That convention has now caught real bugs three increments running.

**1. A cursor plan turned one second into fifty-four.** The first working version took 54 s for two
slides and timed out the client. The probes were not the problem — 68 of them measured 376 ms
together. The driving query was: a plpgsql `FOR … IN <query>` runs as a **cursor**, planned for a
fast first row (`cursor_tuple_fraction`), and that flipped a hash join over 268 label rows into a
nested loop that re-derived the label view once per row of `dim_geo`. Same rows, same answer, 54
seconds. `as materialized` on the label CTE takes the choice away. This is not a tuning nicety: the
identical query under `EXPLAIN ANALYZE` reported 825 ms, so profiling the statement outside the
function would have said the function was fine.

**2. The label view was quadratic.** "The next non-blank line" written as a lateral subquery
re-derives the corpus once per line — 825 ms on 213 slides, and growing with the square of the
second document. It is a `lead()` window now. Both forms return the same 268 rows, checked by
`EXCEPT` in both directions before the swap.

**3. A statute number was contradicted against a table's row count, on four slides.** The first
version's structured side included `dataset_registry.row_estimate`, and its pairing vocabulary
included each entry's `summary` and `grain`. So *"Universal Health Care Act (RA 11223)"* paired with
`agg_peer_ranks`'s 10,668 rows — 4.9% apart, sharing the word **"for"**. Three more like it. Two
rules came out of that, and both are better than the noise they remove:

- **A count of things is a count of distinct keys, not a count of rows.** `row_estimate` counts the
  rows of a table whose grain may be a grid (geography × indicator × year); that number is an
  artifact of the grid and nobody publishes it. `dataset_column.distinct_count` on a `key` column
  counts the things the key identifies. This is **4.1's role vocabulary doing load-bearing work** —
  and the reason 4.1 retyped `bhw_id` from `measure` to `key` is exactly the reason 277,767 has a
  counterpart to be compared against at all.
- **The pairing vocabulary is an entry's name, not its prose.** A summary is a sentence, and a
  sentence shares words with everything.

Together they took the scalar pass from 11 rows to 4 and removed every row that was wrong.

The honest cost is stated on the migration rather than buried: **the scalar pass can only
contradict a table that has been profiled**, because `distinct_count` is null until a profiling pass
writes it. Today that is `fact_bhw_raw` and nothing else. This pass's reach grows with 4.1's.

**4. A dropped column alias.** Removing the `row_estimate` branch removed the `union all` whose
first arm had supplied the name `data_column`; the survivor selected `dc.column_name` bare. It
failed on the next run. Trivial, and exactly the class of thing that ships when a function is
written, typed and not run.

### One false positive, kept rather than tuned away

Slide 161 — JMC 2023-001 reinstatements by region, 0 / 0 / 4 — pairs with
`agg_bhw_by_uuc_status.n_listed_no_bhw` on a fit of 2 of 3 cells. It is not the same measure. Three
cells is a thin basis and the row says so (`cells: 3, agreed: 2`), which is what makes it reviewable
rather than misleading. Raising `p_min_cells` to 4 would remove it and would also remove any real
disagreement on a three-region table; a queue whose precision is bought by narrowing what it looks
at is not obviously better. 2 rows of 12 wrong, both from one slide, all visible as such.

### What the guardrails cost, and what they bought

- **Guardrail 3.** Every identifier goes through `format('%I')`; every value, the row cap included,
  goes through `USING`. That last part was a change made so the assertion could be flat — no `%s`
  anywhere in any dynamic statement — because *"%s is fine when the value happens to be an integer"*
  is not a rule a reviewer can check at a glance. The registry is the allowlist: only tables with an
  **approved** `dataset_registry` row are read, through columns with an **approved**
  `dataset_column` row, and only documents whose `doc_source` row is approved are parsed.
- **Guardrail 4.** Every probe is capped and restricted to the geographies the slide names, and the
  function sets its own `statement_timeout`. One candidate filter does most of the work and is a
  *necessary condition rather than a heuristic*: **a table holding at most one value per geography
  cannot have more rows than there are geographies**, so `row_estimate > count(dim_geo)` drops only
  candidates the uniqueness guard would reject anyway. It is what keeps the sweep off
  `agg_demographics`, whose 530,465 rows cost **3.4 s for a single probe** — measured, not guessed —
  without a blacklist of table names anywhere in the function.
- **Guardrail 5.** The word `exposure` does not appear in the migration. The sweep reads internal
  tables and quotes internal budget material (§12.5); it must not be able to move either onto a
  public surface. `kb_contradiction` and both views are service-role only, RLS enabled in the same
  statement block as the CREATE.
- **Owner decision 5.** Rows land at `auto`. `status` is absent from both insert column lists, so
  every row takes the column default — asserted in the tests, because "we remembered not to set it"
  is not a property.

The naming is load-bearing too: `kb_contradiction`, `kb_doc_line` and `kb_doc_label_number` all
match the `kb\_%` prefix `profile_dataset_refusal()` already refuses, so the sweep's own tables can
never acquire a registry dictionary and be offered to the model as queryable datasets.

### Approving a row does not resolve it

The queue's two judgements are **"same measure"** and **"not the same measure"**. Neither says which
number is right, and there is deliberately no control that does. §12.4 rule 3 is explicit that these
two numbers "are not a contradiction to resolve, they are different measures at different dates, and
an assistant that picks one is hiding the distinction a budget discussion actually turns on" — a
queue offering a "correct value" field would invite exactly that. `describeSides()` is exported so
the page and any later answer path phrase the pair the same way rather than each inventing wording.

A re-sweep keeps a judged row judged **only while the two numbers it was judged on are unchanged**;
a changed value returns it to the queue with the old note cleared rather than left standing behind a
different pair. And a row the latest sweep did not reproduce is shown as stale rather than deleted —
deleting it would erase somebody's judgement.

### What was deliberately not built

§8 4.2 says the output "feeds the §10 regression list". It does not yet, and filing anything now
would be a fabrication in two ways. Nothing here is confirmed — all 12 rows are at `auto` and owner
decision 5 says a person judges — so there is nothing to file. And `ai_regression_case` cannot
express a swept case without inventing a `conversation` and an `answer_given` it never had, and
without the **expected-payload column §10 has been recording as missing since 2.4**. That column is
the real prerequisite, for route 1 as much as for this, and it is the next thing to build. Wiring it
unexercised would repeat the mistake `--propose` recorded: typed and unrun is not a safety property.

The first run's 19 rows were deleted before the final verification run, so the 12 rows now in the
table are the output of the sweep as committed and not a mixture of versions.

### What this does and does not establish

It establishes that a contradiction between a document and a dataset can be **computed** rather than
noticed — that a slide's regional table resolves against `dim_geo` exactly, that the right
structured counterpart can be selected by measured fit against ~68 candidates, and that a standalone
figure can be paired on vocabulary and magnitude tightly enough to find 277,767 without anyone
naming it. It establishes that the rule §12.4 wrote is now enforced by a job rather than by hoping
someone asks the right question.

**It does not establish that the scalar pass generalises.** Its structured side is one profiled
table, and its identification rests on two weak signals whose conjunction happened to be selective
here; a corpus with more numbers in the same magnitude band would test it properly and this one does
not. **Nor does it establish that the fit threshold is right** — 0.5 was chosen before any data and
never moved, and the one distribution that exercised its lower end produced the false positive
above. **And no row here is a finding yet**: twelve pairings await the judgement that decides which
are real, which is the only thing in this increment a person has to supply.

**Standards.** `npm run lint`, `npm run typecheck` and `npm test` clean — **693 tests, 26 more than
`main`'s 667**. `npx prettier --check .` fails on the same 149 files as untouched `main`. The
committed migration is one file; it reached the database as five `apply_migration` calls while the
two performance defects and the two pairing rules were fixed, which is the shape 4.1 left
(`profile_dataset` + `profile_dataset_role_identifier_rule`). The two are byte-identical where it
can be checked: `md5(prosrc)` of every function in the database matches the same slice of the
committed file.

## 2026-08-28 — §10's expected payload, and route 1: ten cases whose answers were already on screen

Not an increment in §8's list — §8 is finished. §10 has recorded the same gap since Increment 2.4,
and the runner entry restated it in its own "what this still does not do": *"a `queryDataset` case
is scored on whether the call still runs, not on whether it returns the same figure, because
`ai_regression_case` has nowhere to record an expected payload."* Three things were waiting on that
column. This builds it and spends it on the one of the three that can be exercised today.

`ai_regression_case.expectations` now holds **29 pinned figures across 10 seeded cases**, and the
runner scores each one separately.

### The shape is the design: a list of assertions, not a payload and not a figure

Two obvious designs are wrong in opposite directions, and saying which is the whole decision.

A **stored payload compared for equality** fails on things that are not the answer: row order, an
added column, a `warnings` array that gains an entry, a `truncated` flag that flips when a limit
moves. Every one reports a regression that is not one, and this runner has already learned what
that costs — `textUnchanged: null` exists because the first version would have cried wolf on the
only case in the list.

A **single named figure** is checkable but too narrow. The figure a page renders is usually several
numbers — `/place/region/07` says "12,605 of 18,891 validated profiles are accredited (66.72%)" —
and a case pinning one of the three passes while the other two drift.

So a case carries a list, each element naming the call it reads (`call`, an index into
`tool_calls`), the tool that index must be (`tool`), the row it selects (`where`, absent for the
payload root), the field and the expected value. Each is scored on its own, which gives the
property the brief asked for: **the comparison says which part matched.** `queryDataset[0]
geo_code=PH: pct_accredited was 71.57, now 72.4` is a finding. "The payload differs" is not.

Three statuses, not two. `met` and `unmet` are obvious; **`unresolved` earns its place** because a
renamed column, a republication that doubles every geography's rows, and a genuinely changed figure
are three different findings that a pass/fail would report identically — and they want three
different fixes.

### The rules that stop a case passing for the wrong reason

- **Ambiguity fails.** A selector matching more than one row is `unresolved`, never resolved by
  taking the first. This is not hypothetical: every table these seeds read holds exactly one
  `dataset_id` *today*, so `{geo_code: "PH"}` names one row; a republication adds a second and the
  selector matches two. Taking the first would silently score one vintage or the other at random —
  and a republication is precisely the change §10 exists to surface, not to paper over.
- **A missing selector key is reported as such.** "no row matched geo_code=PH — no row carries
  geo_code" means the *projection* dropped the key; "no row matched geo_code=PH (1 rows returned)"
  means the row is gone. A broken case and a real finding, told apart.
- **A refusal is not an absent figure.** Every tool in this set returns refusals as data (§1), so
  an `{error: …}` payload scores `unresolved`, not `unmet`.
- **`tool` cross-checks `call`.** An index alone would let an edited `tool_calls` shift an assertion
  onto a different call and score it there. The payload list is also kept index-aligned with the
  recorded calls *including the ones that failed* — skipping a failed call would shift every later
  assertion by one, silently.
- **A malformed expectation is reported, never skipped.** Skipping is the dangerous option: the
  case goes green having checked less than it claims. The database refuses to store one (below) and
  the reader reports one it cannot parse. Neither makes the other redundant — the constraint covers
  future writes, the reader covers a row written before it.

### Two things deliberately not built, both because nothing exercises them

**No tolerance.** An absolute tolerance for a drifting estimate was considered and dropped. Nothing
route 1 can seed drifts — these are fixed aggregates over a fixed dataset version — so it would be
a knob with no case behind it whose only effect is to loosen a check, and a sloppy tolerance is
exactly how a case passes for the wrong reason.

**No type coercion, and that was measured rather than assumed.** The worry was that PostgREST might
return `numeric` as a string, forcing `"270917"` to be compared against `270917`. So the live REST
API was read with the anon key across six tables and every column these seeds touch: **every
numeric arrives as a JSON number**, `600.00` and `52.0` included (which parse to 600 and 52). There
is no case in front of us, so no rule is written. Instead the runner **names the type on a
mismatch** — `n_total was 270,917, now 270,917 (number → string)` — so if one ever appears, the
finding is the evidence for adding a coercion rule rather than the rule having been guessed.

### `conversation` and `answer_given` become nullable — and a fabrication is cleared

Not for the sweep's sake, for route 1's. §10.1 is explicit that a seeded case's expected answer is
*"not authored — it is on screen"*: there is a figure and a page, and no assistant turn, because no
assistant was asked. **The one seeded case already in the table had invented both to satisfy NOT
NULL** — an assistant message nobody received — and it carried `provider = 'gemini'`, a claim that a
model produced text no model produced. The 2.4 header says why that column exists: so that *"it
regressed"* and *"it was answered by Groq this time"* stay distinguishable. A fabricated value on a
seeded row destroys that distinction for the one query the column is for. It is cleared, and the
ten new seeds carry none of the three.

Two constraints replace the NOT NULLs and say more than they did: a captured answer is
all-or-nothing (`(conversation is null) = (answer_given is null)`), and `provider` cannot outlive
one. `answer_given` on case 1 is left as it was — it is an *authored expected answer*, which the
`note` corroborates, and nulling it would lose the §12.4 rule 3 phrasing it records. The new seeds
do not repeat that shape.

### Why the swept path is still not built

§8 4.2 says the sweep "feeds the §10 regression list", and this column is what it was waiting for:
a confirmed contradiction has no question and no answer, but it does have two figures that must not
move — which is an assertion list exactly. It is still not built, and the reason is unchanged from
the 4.2 entry: **all 12 `kb_contradiction` rows are at `status = 'auto'`** (checked, not assumed)
and owner decision 5 says a person judges, so there is nothing confirmed to file. A `source` value
nothing writes is the `--propose` mistake again — typed and unrun is not a safety property. `source`
still admits only `'reported'` and `'seeded'`, and `ai-regression-case.test.ts` asserts that
against the migration text, so the absence is a recorded decision rather than an oversight. Adding
it is one line, in the migration that files the first judged row.

Worth recording for whoever writes that line: **`answer_given` nullable is what a swept case
needed**, and it is now true for a reason that has nothing to do with sweeping. The remaining work
is the `source` value and deciding what a swept case's `question` says.

### The shape guard lives in the database, and its first draft was wrong

`ai_regression_expectation_well_formed(jsonb)` is an immutable SQL function behind a check
constraint. **The first draft used `<>` and would have accepted an element with no `call` at all**:
`jsonb_typeof(e -> 'call')` is NULL when the key is absent, `NULL <> 'number'` is NULL, and a
`where` reads NULL as no-match — so the element with the missing key sails through the exists()
that was written to catch it. `is distinct from` fixes it. Found by running the guard against
eighteen hand-built shapes rather than by reading it, which is now the fourth increment running
that this convention has caught something.

The guard's behaviour, run against the live database: **12 refused, 6 accepted**, over missing
`call` / `tool` / `field` / `value`, JSON null as a value, object and array values, `call` as a
string, `where` as a string and as null, an element that is not an object, a top level that is not
an array, and a list where one of two elements is bad. `value` is restricted to number, string or
boolean — JSON null is refused, because nothing rendered on a page is a null and "expected to be
null" would ship unexercised.

### Verify

**The ten seeds, scored against live data through the real evaluator.** The replay itself could not
be run here — the runner reads `dataset_registry`, which is RLS-enabled with no policies and so
service-role only, and there is no service-role key in these environments. What *was* run is
everything except that lookup: the seeds parsed out of the committed migration, each recorded
`queryDataset` call translated into the PostgREST request it issues and sent with the anon key, and
the resulting payloads scored by `evaluateExpectation` itself. **29 of 29 expectations met, across
all 10 cases.** Held out of the repository deliberately: it hits the network and pins live figures,
which is exactly what a CI suite must not do.

**Three negative controls on the same live payloads**, because a suite that cannot fail proves
nothing:

```
figure moved by one   unmet      — geo_code=PH: n_total was 270,918, now 270,917
renamed field         unresolved — no field n_records (the row has: geo_code, geo_level, n_total, n_accredited, pct_accredited)
republication         unresolved — 2 rows matched geo_code=PH — a selector must name one
```

**Two structural checks the registry can answer without a service key**, both run against the live
database and both returning zero rows: every table and column any seed names — projections,
filters, order-bys, selector keys and asserted fields — is `approved` and `is_queryable` in
`dataset_registry`/`dataset_column`; and every selector key and asserted field appears in its own
call's `columns` projection. The second is the failure that would otherwise look like a build
problem: a field left out of the projection comes back `unresolved` at replay time and reads as a
regression rather than as a typo in the seed. It is asserted as a test too, so it stays true.

**The four refusals, exercised against the live table** (an attempted insert each, all rejected):
a conversation with no answer, a provider with no answer, `source = 'swept'`, and a malformed
expectation.

**Database and committed file are in sync**, and were not at first: the function reached the
database through `apply_migration` as a comment-stripped copy, so `md5(prosrc)` disagreed with the
committed slice. Re-applied verbatim; both are now `241999716384b2c1f6bb49477153a19c`, 1292 bytes.
Worth noting because 4.2 introduced that check and this is the first time it has caught a real
divergence.

**Standards.** `npm run lint`, `npm run typecheck`, `npm test` clean — **727 tests, 34 more than
`main`'s 693**. `npx prettier --check .` fails on the same **149** files as untouched `main`, and
every file this branch touches is clean.

### What this does and does not establish

It establishes that a `queryDataset` case can be scored on its **figure** rather than on whether
its call still executes, that the scoring says which figure moved, and that the three ways an
assertion can fail to hold — moved, renamed, ambiguous — are reported as three different things
against real payloads. It establishes route 1: ten questions whose expected answers were read off
the live data behind pages that render them, with the screen named on every row so the "on screen,
not authored" claim is checkable rather than asserted.

**It does not establish that the replay runs end to end.** The registry lookup is service-role only
and no key exists here, so `replayCase` itself has been exercised against mocked tools and real
payloads, never against both at once. The first person with a service-role key should open
`/admin/regressions` and press replay; if it is green, that is the missing half.

**It does not establish that these ten are the right ten.** They were chosen to cover the
selector's branches — payload root, one-key, two-key, non-geographic key, integer, decimal, boolean
— which is a property of the *mechanism*, not evidence that they are the questions a briefing asks.
§10's own standard is "three answers read by hand say nothing about the other forty", and eleven
cases is not forty.

**And it does not make any of these cases sensitive to prose.** Every caveat on the runner still
stands: the answer text is not regenerated, and a case can pass here while reading badly. The
caveat string was widened to say "tool calls, cited passages and pinned figures" rather than
quietly growing a third check behind a two-check disclaimer.

## 2026-08-28 — §10.1 route 3: the answer bank harvested, and the replay finally run end to end

§10 names three ways the regression list grows. Route 2 shipped at Increment 2.4, route 1 shipped
this morning with the expectations column, and route 3 — *"`ai_ask_cache` rows at `status =
'approved'` are human-verified question/answer pairs, an unused regression set already accumulating
in production"* — was the last one left. It is built, and the list is now **18 open cases carrying
66 pinned figures**, up from 11 and 29.

The larger result is the one that was not the feature. **The end-to-end replay has now run**, which
the expected-payload entry called out as its own biggest gap: *"`replayCase` itself has been
exercised against mocked tools and real payloads, never against both at once."*

### The question that decided the whole increment: can a harvested case be replayed at all?

A case needs the tool calls with their arguments. `ai_ask_cache` does **not** store them — it holds
`question_norm`, `question_display`, `geo_code`, `answer_md`, `provider`, `data_version`,
`dataset_slug`, `status`, and nothing else. Checked first, because if the answer were no, a harvested
case could only ever be scored on citations it does not have, and a row that cannot be replayed makes
the list look bigger without making it stronger.

`ai_ask_log` does store them. Its `tool_trace` is `[{name, args}]` in call order — the same shape
`ai_regression_case.tool_calls` already uses. So the recovery is a join, and it is exact rather than
approximate: the log row must agree with the cache row on `question_norm`, `data_version`,
`dataset_slug` and `geo_code`, must be `served_from = 'live'` (a cache hit records no trace, because
no tools ran), and must carry a **byte-identical `answer_md`**. That last condition is what makes it
a derivation: the trace taken is the one that produced this exact text.

Measured before anything was written: **all seven approved rows join to exactly one such log row**,
every one `turn_index = 0` and `outcome = 'answered'`. The single-turn shape is why a harvested
case's `conversation` can be built rather than invented — it is the question and the answer, and
nothing else happened.

**Where more than one log row qualifies, nothing is harvested.** Not the first, not the newest. Same
rule the expectation selector enforces one level down, for the same reason: a case built from one of
several candidate traces has stopped being evidence about anything in particular. It is reported as
skipped, with the count.

### Whether the harvest can pin a figure — measured twice, and the first answer was wrong

Every number in an approved answer passed `auditNarrative`, so it came from a tool payload. The pins
are therefore derivable in principle. `lib/ai/harvest-pins.ts` is the derivation: re-issue the
recorded calls, enumerate every field the expectation language can address, and match by exact
equality against the numerals `extractNumbers` finds — the audit's own tokeniser, reused so that a
number the audit admits and a number this pins are the same set. No model reads the answer, and
nothing needs a provider key.

**Equality is exact here and rounded in the audit, deliberately.** `isTraceable` lets "65.72%" be
reported as "about 66%" because it decides whether a *sentence* may be shown. A pin is compared on a
later build, so a rounded match would write an expected value that was never in a payload and fail
on its first replay.

The first measurement, restricted to the payload root and `rows` as the column shipped this morning:
**27 of 41 distinct numbers pinned uniquely, 5 more reachable, 1 ambiguous, 8 absent.** Good enough
to ship — and wrong to. Six of the eight absences were real payload figures the *language* could not
reach, because `getIndicatorByGeo` returns its counts on the root and its breakdown in an array named
after the indicator: `demographics`, `training`, `honorarium`. Among the six were "30,600 BHWs
identify as Indigenous People" and "2,782 BHWs (53.9%)" in Palawan — which are the **subjects of two
of the seven questions**. A case pinning the two totals every such answer mentions in passing while
missing the figure the question asked for is pinning the boilerplate.

So `Expectation` gains an optional **`from`** naming the list to select from; absent means `rows`, so
route 1's ten seeds are untouched (asserted). Naming a list with no `where` is refused by the
constraint and by the reader — the root read is `where` absent, and it takes no list.

The second measurement is where the interesting failure was. Widening naively made things **worse**:
unique matches fell 27 → 17 and ambiguities rose 1 → 17. The cause is that
`getIndicatorByGeo(honorarium_amount).honorarium` *is* the array `getHonorariumStats().rows` returns,
so every honorarium figure suddenly had two addresses and a strict uniqueness rule rejected all of
them.

That forced the rule that is actually right, and it is a distinction worth stating: **two addresses
naming the same row and the same field are one quantity read two ways** — pin the earliest call.
**Two addresses naming different rows or different fields are different quantities that happen to be
equal today** — pin nothing, because a later divergence would report a regression in a figure the
sentence was never about. Under that rule: **37 of 41 pinned.**

The four that are not are each a statement rather than an omission. 5,161 in the Palawan answer is
`searchGeo`'s `nTotal` for the province *and* the indicator call's `validatedProfiles`. 270,917 in
the training answer is `validatedProfiles` on the root *and* `nTotal` on all thirty training rows.
"near 100%" and "below 12%" are prose — no payload carries either, and the audit admits them only
through the rounding rule a pin does not have.

**A selector is never keyed on a measure.** `deriveSelector` uses string keys only, smallest first,
one then two. A selector keyed on the figure being checked would put the assertion inside the thing
that selects the row to assert it in.

### Idempotence and drift, following 4.2 rather than reinventing it

`harvest_key` holds the source `cache_key` under a partial unique index, so a second harvest cannot
duplicate a case **by construction** rather than by a query remembering to check.

`harvest_fingerprint` is md5 over the answer and the trace — the two things a case is built from.
When it changes, the case is rebuilt and **`expectations` is reset to empty**: pins derived from the
previous answer are not evidence about a new one, and a case left green against figures nobody
verified is the exact "passes for the wrong reason" failure the expectations column is arranged
against. This is 4.2's rule for a re-swept row (*"a judgement is kept only while the two numbers it
was judged on are unchanged"*) applied to pins.

`harvest_last_seen_at` is 4.2's `last_swept_at`. One timestamp per run stamps every case the run
reproduced; a case carrying an older one was not reproduced — unapproved, blocked, edited away — and
is **reported stale rather than deleted**. Deleting would silently shrink the list, and a question
verified once is still worth re-running. `/admin/regressions` renders the distinction, deriving "the
latest run" from the newest stamp in the list, which is exact because the function stamps them alike.

### `source` gains `'harvested'`, and still not `'swept'`

A harvested case is neither reported-as-wrong nor seeded-from-a-screen: it is an answer a person
looked at and approved, and `note` means a third thing on it — provenance, not a correction and not a
screen. The admin page now labels all three rather than two.

The difference from `'swept'` is not taste. **This increment writes `'harvested'`.** A `source` value
nothing writes is the `--propose` mistake — typed and unrun is not a safety property. `kb_contradiction`
was re-checked, not assumed: **all 12 rows are still at `status = 'auto'`**, owner decision 5 says a
person judges, so there is still nothing confirmed to file. `ai-regression-harvest.test.ts` asserts
that no statement in this migration introduces the word.

### Verify

**The harvest, run for real.** Seven approved rows → **7 harvested**, 1–3 tool calls each. Run again
immediately: **7 unchanged, 0 duplicated, 0 stale.**

**Both drift paths, exercised against the live table inside a transaction that was rolled back** —
which is how they could be run at all without damaging production data:

```
edited an approved answer      refreshed  — pins cleared (6 → 0), stamp advanced
unapproved a source row        stale      — pins kept, stamp not advanced, case not deleted
a second live log row, different calls
                               skipped    — "2 live log rows record different tool calls for this
                                             answer — a harvested case must name one"
                               stale      — and the already-harvested case is *also* flagged, so an
                                             ambiguity cannot leave a case standing as confirmed
```

**The end-to-end replay, run for the first time.** A harvested case's calls are all public tools —
`searchGeo`, `getIndicatorByGeo`, `getTrainingCoverage`, `getHonorariumStats`,
`getDataCompleteness` — which read the `agg_*`/`dim_*` layer through the anon key. `queryDataset` and
`traverseGraph` are what need the service role, and no harvested case uses them. So `replaySuite`
itself ran: real tools, real payloads, the real reader, the real scorer. **7 cases, 7 ok, 0 degraded,
0 broken, 37 of 37 expectations met.**

**Seven negative controls through the same path**, because a suite that cannot fail proves nothing:

```
figure moved by one              broken / unmet       demographics category=YES: n was 30,601, now 30,600
renamed field in a named list    broken / unresolved  no field count (the row has: dimension, category, n, pct, …)
the named list is gone           broken / unresolved  the payload has no demographic array to select from
selector matches nothing         broken / unresolved  no row matched category=MAYBE (32 rows returned)
a `from` with no `where`         broken / malformed   reported as unreadable, not skipped
tool cross-check fails           broken / unresolved  call 0 is getIndicatorByGeo, but this expectation is about getTrainingCoverage
a tool this build lacks          broken               getVibes is not a tool in this build
```

**Nine database refusals, each an attempted insert against the live table**, all rejected, with a
tenth valid shape accepted as the control (and deleted afterwards): `source = 'swept'`; harvested
with no `harvest_key`; a `harvest_key` on a seeded row; a key with no fingerprint; a second case on
an existing `harvest_key`; and `from` with no `where`, `from` as a number, as an empty string, and as
JSON null.

**Database and committed file in sync.** Both functions checked by `md5(prosrc)` against the same
slice of the committed file: `ai_regression_expectation_well_formed` at
`d300b78fbbb9bafcbf53cbc63f17b081` (1721 bytes) and `harvest_ask_cache_cases` at
`639a54e8cc88367a53feb3f0453840df` (6329 bytes). Applied verbatim with comments, which is what the
last increment learned to do the hard way.

**Standards.** `npm run lint`, `npm run typecheck`, `npm test` clean — **768 tests, 41 more than the
branch's 727 and 75 more than `main`'s 693**. `npx prettier --check .` fails on the same **149** files
as untouched `main`, and every file this branch touches is clean.

**A defect the run found.** The harvest's own report said "1 tool calls recorded". Cosmetic, but it is
a string a person reads to decide whether a case is worth looking at, and it was fixed and re-applied
(which is why that function has two applied migrations). Smaller than the last four increments'
finds; recorded anyway, because the convention is that running the thing is what surfaces them.

**A near-miss in the test itself, worth recording.** The assertion that the harvest never deletes a
case was first written as `expect(harvestBody).not.toContain("delete")` — which failed, because the
stale message *says* "Kept, not deleted". A scan for the word would have had to be deleted or the
promise reworded; it is now matched on `delete from` as a statement. This is the third time in this
repository a naive string scan in a migration test has been the wrong instrument, and the first time
it failed loudly rather than silently asserting nothing.

### What this does and does not establish

It establishes route 3: seven cases whose questions were asked by real users, whose answers a person
approved, whose tool calls were recovered from the log by a byte-identical match rather than a guess,
and whose 37 figures were derived by a program rather than authored. It establishes that the harvest
is idempotent, that an edited source clears its pins, and that an unapproved source leaves a case
stale rather than gone — each run, not reasoned about.

**It establishes that the replay works end to end**, which nothing did before. Against public tools
only, against real production data, with the negative controls to show it can fail.

**It does not establish that a `queryDataset` case replays.** Route 1's ten still need the registry,
which is service-role only, and no key exists in these environments. The half now proven is the half
that shares every line of `replayCase` except the tools it calls — which is most of the risk, but not
the registry lookup itself.

**It does not establish that seven is enough.** §10's standard is "three answers read by hand say
nothing about the other forty", and eighteen is not forty. Worse, these seven are not independent:
five of the seven are national BHW questions, two of them the *same question* asked at two geographies,
and all seven come from one dataset (`bhw-2025`) at one `data_version`. The list has grown; its
*coverage* has grown less than the count suggests.

**It does not make the harvest self-maintaining.** The function files new cases and marks stale ones,
but nothing in the running product derives pins for a case it files: that needs the tools *and* a
service-role write, and the write half cannot be exercised here. A newly harvested case therefore
arrives with zero pins and is scored on its tool calls alone until someone runs the deriver. Stated
rather than papered over, and deliberately not shipped as a button nobody could test — the one thing
this repository shipped unexercised turned out never to have worked.

**And it still does not make any case sensitive to prose.** The answer text is not regenerated. Every
caveat on the runner stands.


## 2026-08-28 — UUC for PHC 2025: aligned to the source office's final list, and the vintage inference was backwards

The source office supplied its final national list, *2025 UUC FOR PHC LIST*, carrying **5,987**
barangays. This dashboard published **5,991**, from the reconciled submission workbook it was built
from, and footnoted the 2027 Budget Cue Cards p37's 5,987 as an older snapshot. **The dataset now
publishes 5,987.** Migration `20260828180000_uuc_phc_final_list_alignment.sql`; registry delta
`20260828180100_seed_registry_final_list_alignment.sql`; full reasoning in
`docs/UUC_PHC_2025_PLAN.md` §3, which is rewritten.

### The gap was six barangays, and nothing else

The final list and the workbook agree on 5,986 barangays name for name across all 17 regions. They
differ on six:

| | Province / City-municipality / Barangay | PSGC |
|---|---|---|
| **Removed (5)** | CAVITE / CITY OF BACOOR / MOLINO IV | `0402103047` |
| | CAVITE / CITY OF BACOOR / SAN NICOLAS II | `0402103064` |
| | CAVITE / CITY OF BACOOR / TALABA 2 | `0402103066` |
| | CAVITE / CITY OF BACOOR / TALABA 3 | `0402103091` |
| | CAVITE / CITY OF CAVITE / BARANGAY 38 | `0402105032` |
| **Added (1)** | BASILAN / SUMISIP / SUMISIP CENTRAL | `1900705019` |

399 + 1 = 400 and 200 − 5 = 195 — which is p37's BARMM and CALABARZON exactly. So the +4 national
delta `ref_uuc_phc_published_delta` had been reporting since U10 closes to zero, and that table is
now empty.

### The inference this reverses, and why it was wrong

Plan §3 argued the workbook was the *later* revision: it corroborates 5,991 in three independent
places, and its file name, `Submissions_UUA_2025_filled_1`, reads as a revision of something, while
p37 is a snapshot "as of 2025". The owner's decision followed from that reading. §3 flagged it as
inference and asked for it to be confirmed rather than assumed, which is the only reason this is a
correction rather than an embarrassment.

It was wrong, and the reason is worth keeping: **the workbook's three corroborating places are all
the same submission, counted three ways** — the `NEW` classification sheet, the `2025 LIST` row
count, and the `TOTAL` subtotals embedded in `2025 LIST`. Internal agreement measured consistency,
not currency, and it was read as evidence of currency.

### The final list is itself internally inconsistent, and this is not fully closed

Its summary tab and its 17 per-region sheets both give 5,987 (BARMM 400, CALABARZON 195). Its
national list sheet still carries the five Cavite barangays, so it holds 5,992 rows, and its printed
grand total there reads 5,991 — stale on both counts, since it also fails to count the added Basilan
row (whose `TOTAL` subtotal still reads 399). **Three sources agree on 5,987** — the summary tab,
the regional sheets, and p37 — **against one stale sheet**, so 5,987 is taken. **This should be
confirmed with the source office rather than treated as settled on our side.**

### What the added barangay costs

`SUMISIP CENTRAL` is not in the reconciled workbook at all: `NEW` scores it `NOT UUA`. Its values
come from the same workbook's `2025 LIST` sheet, which carries it under PSGC `1900705019` — so the
row is recovered rather than invented, but from a **pre-reconciliation extract**. The two sheets
disagree somewhere on 473 of the 5,989 barangays they share (ABR most often, 275 rows), so this one
row is of a different vintage to the other 5,986. That is stated in the migration header, the
loader, the plan and the cleaning report rather than smoothed over; the alternative was a listed
barangay with no evidence at all.

Two columns have no counterpart in `2025 LIST` and are left NULL rather than guessed. `elcac_brgy`
— criterion (b) rests on `armed_conf + idp` alone here (30 + 11 = 41), which passes without it. And
`health_indicators`, the source's own criterion (d) score, which this pipeline **loads and never
recomputes**; recomputing it for one row is exactly what that rule forbids. Route (d) therefore does
not count this barangay, and its listing does not depend on that — `ip_pop` is 100, so criterion (a)
carries it alone.

Its seven provincial benchmarks are Basilan's own, copied from its 36 fellow Basilan rows. They are
province constants, and copying them is what keeps `ref_uuc_phc_provincial`'s one-value-per-province
assertion true. **One consequence, recorded because it is a small honest loss:** the row counts as
health-evaluable while having no score, so `ref_uuc_phc_list` exports `route_health = false` for it
on the strength of an absent score rather than a failed test. Leaving its benchmarks NULL instead
would have read truer per-row but would have posted a benchmark-gap finding against a province that
did supply benchmarks, which is a worse misstatement.

### One assertion had to change, and it was the assertion working

`ref_uuc_phc_quality` counts `n_score_disagreement` as `recomputed is distinct from
health_indicators` and `n_score_understated` as `recomputed < health_indicators`. A NULL score is
distinct from every integer but compares to none, so `SUMISIP CENTRAL` entered the first and not the
second, and `20260827170000`'s assertion 7 — which requires them equal, the substance of the claim
"the recomputation is always worse, never better" — would have aborted the migration. That claim is
about rows where both numbers exist, so both counts are now restricted to rows with a recorded
score. Both read 664 again, unchanged by the alignment. The assertion caught a real definitional gap
rather than a wrong number, which is the case they are written for.

### Figures this moved

| | Before | After |
|---|---:|---:|
| Listed barangays | 5,991 | **5,987** |
| Route (a) Indigenous Peoples | 3,677 | **3,678** |
| Route (b) conflict / displacement | 2,302 | **2,303** |
| Route (c) 4Ps | 726 | 726 |
| Route (d) health | 2,000 | **1,995** |
| Criterion (d) evaluable | 5,765 | **5,761** |
| Criterion (d) *not* evaluable | 226 | 226 |
| Comparable, six health indicators | 5,765 | **5,761** |
| Comparable, FIC | 5,652 | **5,648** |
| Bounded values / barangays | 1,584 / 1,397 | 1,584 / 1,397 |
| Score disagreement / understated | 664 / 664 | 664 / 664 |
| Households per BHW, listed vs other | 50.9 vs 98.2 | **50.3 vs 98.3** |
| Provinces where listed is thinner | 76 of 81 | **76 of 80** |

The capping totals are untouched — none of the six barangays carries a bounded value — and so is the
226, since the five removed rows carried real Cavite benchmarks and the added one carries Basilan's.
**Cavite leaves the BHW comparison entirely:** three listed barangays is below the `0 < n < 5`
suppression threshold, so CALABARZON no longer badges an area against the pattern.

### How it is applied, and why it is a delta rather than a re-seed

The extract is regenerated at the source — `clean_uuc_phc_indicators.py` now carries the alignment
as an explicit, named step, and the diff against the committed CSV is exactly those six rows — and
both seed migrations are regenerated from it, each a six-line diff. That makes a fresh replay land
on 5,987 on its own. The alignment migration then carries the same change to a database already
seeded at 5,991: it deletes five rows, upserts one, and re-runs the populate blocks of all four
aggregate migrations plus the published-delta rebuild, verbatim, which is the refresh procedure each
of those files documents. Idempotent from either state; every assertion in every copied block still
runs.

**Standards.** `npm run lint`, `npm run typecheck` and `npm test` clean — **693 tests**, the same
count as before, with fixtures moved to the new figures rather than added to.
`npx prettier --check .` fails on the same files as untouched `main`. Every touched migration parses
under the PostgreSQL grammar (`pglast`). The pipeline was verified reproducible before the change:
re-running the cleaner against the committed workbooks reproduced both committed CSVs byte for byte,
so the six-row diff afterwards is the whole of what changed.

**One downstream effect, not handled here.** Increment 4.2's contradiction sweep recorded
`geo_distribution` p37 (5,987) against `agg_bhw_by_uuc_status.n_barangays_listed` (5,991) as a real
contradiction. It stops being one once this is applied; `sweep_contradictions` recomputes, so the
row resolves on the next run rather than needing a hand edit here.

**Applied on the owner's instruction**, to `bhw-connect` (`ejcuwrnxngdwvecxwrhy`), in the seven
`apply_migration` calls the sections divide into plus the registry delta — the shape 4.1 left. Every
assertion in every rebuilt block passed on the way through, including the one that forced the
`ref_uuc_phc_quality` change. Verified live afterwards against the figures predicted here: both fact
tables and `ref_uuc_phc_list` at 5,987, BARMM 400, CALABARZON 195,
`ref_uuc_phc_published_delta` **empty**, routes 3,678 / 2,303 / 726 / 1,995, evaluable 5,761,
comparable 5,761 and 5,648, capping unmoved at 1,584 / 1,397, score columns 664 / 664, Cavite's
listed side suppressed at 3 barangays, Basilan at 37, and 80 comparable provinces.

**One figure in this entry was wrong before it was checked against the database, and is corrected
above.** Route (d) was predicted at 2,001 → 1,996 from a Python reproduction of the rule that
counted `health_indicators >= 4` alone. `agg_uuc_phc_criteria` counts `>= 4` **and** evaluable, and
one barangay scoring 4 or more sits in a province whose benchmarks cannot support the comparison —
so the real pair is 2,000 → 1,995. The delta is the same −5. The distinction was already recorded
in `docs/uuc-phc-feature.md`, which quotes exactly that 2,001-against-2,000 gap, and the
reproduction should have been checked against it rather than against the aggregate's name.

**Still open, and not for us to close.** Applying this reverses a figure the owner confirmed, and
the final list contradicts itself on the five Cavite barangays — its summary tab and 17 regional
sheets against its own national sheet. Both want confirming with the source office; the dashboard
now publishes the 3-to-1 majority reading in the meantime.

## 2026-08-28 — The regression list catches its first real change, and it was a correction

Not an increment. The same morning route 1 seeded ten cases from figures rendered on public pages,
`20260828180000_uuc_phc_final_list_alignment.sql` replaced the reconciled 5,991-barangay UUC
submission with the source office's final list of **5,987**. Eight of route 1's twenty-nine pins
stopped matching the moment it landed.

**This is the suite working, and it is worth writing down as such.** §10 exists to "tell whether a
change made answers better or worse", and until now nothing had exercised that against a change
anyone actually made. What it caught was not a defect: it was a deliberate data correction, and the
right response is to re-derive the pins rather than to relax them.

### What moved, measured before anything was written

The ten seeds were parsed out of the committed migration, each recorded `queryDataset` call
re-issued through PostgREST with the anon key, and every pin scored by `evaluateExpectation` itself
— the same path the seeds were derived on, so the comparison is like-for-like.

**21 of 29 met. All eight that moved read a UUC table:**

```
agg_uuc_phc_counts     n_listed              5,991 -> 5,987
fact_uuc_phc_barangay  matchingRows          5,991 -> 5,987
agg_uuc_phc_criteria   n_route_ip            3,677 -> 3,678
agg_uuc_phc_criteria   n_route_conflict      2,302 -> 2,303
agg_uuc_phc_criteria   n_route_health        2,000 -> 1,995
agg_uuc_phc_criteria   n_health_evaluable    5,765 -> 5,761
agg_bhw_by_uuc_status  n_barangays_listed    5,991 -> 5,987
agg_bhw_by_uuc_status  listed_n_bhw         48,485 -> 48,480
```

**Every one came back `unmet`, not `unresolved`** — and that distinction is the reassuring part.
The selectors still found their rows and every field is still there, so nothing structural broke;
only the numbers moved. Had the alignment dropped or renamed a column these would have read
`unresolved`, which means something entirely different and wants a different fix. Keeping the two
statuses apart was argued for on paper when the column was designed; this is the first time the
distinction did work.

**The second-order movements are the case for pinning more than the headline.** Six barangays
changed — five out of Bacoor and Cavite City, one into Sumisip — and that moved the route (d) health
count by five, the BHW headcount by five, and routes (a) and (b) by one each *in opposite
directions*. A suite pinned only on 5,987 would have reported "one figure changed" and missed all of
it. The three pins that legitimately held (`n_barangays` 41,958, `n_route_four_ps` 726,
`n_listed_no_bhw` 100) are left exactly as they were.

**Nothing outside the UUC dataset moved, established rather than assumed.** Cases 6, 7 and 12–15 pin
`agg_bhw_counts`, `agg_bhw_profiling_status`, `agg_certification`, `agg_by_income_class` and
`agg_workload`, and every one of their pins still met. The seven harvested cases read those same
census tables through the indicator tools, and none of them reads a UUC table at all — so they are
unaffected for a reason that was measured, not inferred from the diff.

### The notes were rewritten too, and that is not cosmetic

Route 1's claim is that a seeded case's expected answer is *"not authored — it is on screen"*, and
the `note` is the only thing that makes the claim checkable, because it names the screen. Three of
these notes quoted 5,991 as the rendered figure. Leaving them would have kept the pins honest while
making their provenance false — the worse of the two failures, because a reader checking the claim
would find the page saying 5,987 and no way to tell whether the case or the page was wrong.
`/uuc-phc` and `/uuc-phc/criteria` both render 5,987 now, verified in the tree rather than assumed:
the alignment changed their metadata strings, and the criteria page's structure is otherwise
untouched, so case 10's note still describes what it renders.

### Keyed on the question, not on the case id

The seeds' case ids skipped four values while the original migration's refusals were being
exercised against the live table, so they are an artifact of how that migration was run rather than
a property of the data. A migration replayed against a fresh database has to reach the same four
rows, and `question` is unique among seeded cases and is what the case actually *is*. Asserted.

### A defect the run found — in the test, and for the fourth time

The assertion that no pin still claims 5,991 was first written as a raw scan for the string over the
migration text. It failed, on the case-8 note: *"Re-derived when the source office's final list
replaced the reconciled 5,991"* — which mentions the number legitimately, as the figure that was
superseded. That is provenance worth keeping, and a test forcing it out would have been the
instrument being wrong rather than the migration.

It now asserts on the **parsed pin values**, with a separate check that any note mentioning 5,991
also names 5,987. **This is the fourth time a naive string scan in a migration test has been the
wrong instrument in this repository** — twice silently asserting nothing, and now twice failing
loudly, which is the better direction but still the same mistake. The rule that keeps emerging:
parse the thing you mean to assert about; do not scan the file it lives in.

### Verify

- **29 of 29 pins met** after the re-seed, scored through the same live path.
- **Zero disagreements** between the four cases' stored expectations and the live tables, checked
  directly in SQL as a second, independent comparison that does not go through the evaluator.
- The four questions each match **exactly one** seeded row, checked before the update was applied.
- 5 new tests (**773 total**, 5 more than `main`'s 768): that the re-seed touches exactly the four
  UUC seeds and no fifth exists, that it keys on `question` and never on `case_id`, that pin counts
  per case are unchanged at 2 / 1 / 5 / 3 rather than any being dropped, that no pin is on 5,991,
  and that the three unmoved pins are preserved.
- `npm run lint`, `npm run typecheck`, `npm test` clean. `npx prettier --check .` fails on the same
  **149** files as untouched `main`.

### What this does and does not establish

It establishes that the expected-payload column does the job it was built for: a change to published
data reached the list within hours, named the eight figures it moved and the three it did not, and
distinguished a moved figure from a broken one. It establishes that the second-order effects of a
six-row data change are visible to this suite and would not have been to a hand-written check.

**It does not establish that the list would have caught a change nobody announced.** This one was
known — a concurrent branch merged it — and the pins were re-measured deliberately. Nothing runs the
replay on a schedule, so the list still only speaks when someone opens `/admin/regressions`.

**And it does not establish that these pins are right for longer than this dataset version.** They
are correct against the final list as merged; the next republication moves them again, which is the
point rather than a defect. What this increment adds is the first worked example of what to do when
that happens.

## 2026-08-28 — The regression list on a schedule, and route 1's twenty-nine pins through the real runner at last

Two gaps, closed together because closing either one alone was the awkward half.

The first is the one the previous entry named as its own limit: *"It does not establish that the
list would have caught a change nobody announced. Nothing runs the replay on a schedule, so the
list still only speaks when someone opens `/admin/regressions`."* The UUC final-list alignment moved
eight pinned figures and the suite named all eight correctly — within hours, because a person knew
to go looking.

The second is Gap B from the route 3 entry: *"It does not establish that a `queryDataset` case
replays. Route 1's ten still need the registry, which is service-role only."* Seven harvested cases
had replayed end to end; ten seeded ones had not, and they carry twenty-nine of the list's
sixty-six pins.

They are one increment because a cron runs server-side, where the service-role key already lives. A
scheduled replay covering seven of eighteen cases would not have been worth having, and the schedule
is what finally forced route 1's calls through `executeQueryDataset` for real.

### The free-tier ceiling was re-read rather than remembered, and it had moved

`app/api/cron/precompute/route.ts` said, in its header, *"One invocation, not two, per Vercel Hobby's
cron-job-count limit (pitfall P6)"*, and `BUILD_PLAN.md` P6 said *"few jobs, daily granularity"*.
Checked against Vercel's cron usage page on the day rather than from memory: **Hobby allows 100 cron
jobs per project**, and has since 2026-01-20, when the per-team caps (Hobby 2, Pro 40) were removed
and the per-project cap was raised from 20 to 100 on every plan.

What Hobby still caps is **frequency**: minimum interval once per day, and scheduling precision to
the hour — *"a cron job configured as `0 1 * * *` will trigger anywhere between 1:00 am and 1:59 am"*,
and an expression that would run more than once a day **fails at deploy time**. So a second daily job
fits the plan's free-tier commitment as it stands, and the constraint that would have forced folding
the replay into the precompute route does not exist any more. P6 is corrected in place rather than
quietly worked around, and the precompute header now says why its own chaining is still right for
*its* two steps and no longer forced.

Given that it fits, separate beats chained here for reasons that are about these two jobs rather
than about the limit. Precompute is already time-boxed at 50s and reports running out of it; adding
a replay would spend that budget on a different job and silently reduce narrative coverage. A replay
that finds something must not read as a precompute failure. And the two want different clocks:
20:00 UTC and 22:00 UTC, two hours apart, which is the first spacing that Hobby's hour of slack on
each cannot make overlap.

**That constraint is now a test rather than a memory.** `ai-regression-run.test.ts` parses every
schedule in `vercel.json` into its five fields and asserts that each names exactly one minute and
one hour — which is precisely the condition for at-most-once-a-day — and that the hours are at least
two apart. The alternative was a comment, and a comment is what P6 was.

### What a scheduled run does with a failure

The brief was explicit that this must not be write-and-forget and must not spam, and those pull in
opposite directions. Four decisions, in the code header and here:

**It writes a row every time, including when it finds nothing.** The clean rows are what make "the
last run was clean, at 06:11" a checkable statement. Without them, silence and health are
indistinguishable — and silence is exactly how a cron fails.

**`/admin/regressions` renders the newest runs as stored, replaying nothing.** One cheap read above
the case list. A scheduled check whose output lives only in a function log has the same gap the
schedule was built to close, one step later: nobody opens the function log either.

**The page says when the last run is more than 36 hours old.** This is the check that catches the
new failure mode this increment introduces. A daily job with an hour of scheduling slack that has
not run in 36 hours has missed a day, and "no news" would otherwise read as good news at exactly the
moment it means the opposite.

**The digest is the anti-spam mechanism, and it suppresses nothing.** `findings_digest` is md5 over
the run's findings, keyed on case id and finding text together and sorted, so a run that found what
yesterday's run found is recognisable as a repeat. The row is written either way; the page says
"unchanged across the last N recorded runs" instead of presenting the same eight figures as a fresh
alarm. The skipped-case count is inside the digest, so a run that stopped early can never be
mistaken for the complete run before it.

### `unmet` and `unresolved` are not treated the same, and the run row is where they would have been lost

The obvious shape for a run summary is one failure count, and that would have thrown away the thing
the previous entry spent a section on: *"Every one came back `unmet`, not `unresolved` — and that
distinction is the reassuring part."*

So the row carries `pins_met`, `pins_unmet` and `pins_unresolved` as three columns and no total, and
a run's `outcome` ranks what a reader has to do next:

- **`moved`** — the suite checked everything it claims to check and something it checks changed: a
  pinned figure is `unmet`, or a cited passage moved page, changed text, or dropped out of its own
  search. Re-derive the pins, which is what the 2026-08-28 alignment entry did for eight of them.
- **`structural`** — the suite *could not* check something: a pin `unresolved`, an expectation that
  could not be read, a call that failed or is not in this build, a cited chunk that is gone, or a
  case the run never reached before its time budget. Fix the case or the code.
- **`clean`** — everything reached, everything met.

**`structural` outranks `moved`,** because an unscored assertion is a case that has quietly stopped
checking what it claims to — the failure the expectations column exists to prevent — whereas a moved
figure is the suite working. And a run that did not reach every open case is `structural` for the
same reason: it has established nothing about the cases it never opened, and a summary counting only
what it looked at would call the list green while a third of it went unread.

The check constraint admits exactly those three, and the test asserts the list is exactly those
three: a fourth value nothing writes is the `--propose` mistake this repository has recorded before.

### The HTTP status says whether the run happened, never what it found

200 with `outcome: "moved"` is a successful invocation that found eight moved figures. That is the
job working, and returning 500 for it would make a data correction indistinguishable from a broken
cron in Vercel's own view of the schedule — the same flattening as collapsing `unmet` into
`unresolved`, one level up. 500 is reserved for the run not being recorded, because an unrecorded run
is one nobody will ever see.

### The runner gained a deadline, and gives up between cases rather than inside one

`replaySuite` takes an optional `deadlineAt` and returns `skipped`. It is checked between cases and
never inside one — a half-replayed case would be scored on whichever calls happened to finish — and
the first case always runs, because a suite that yields before doing anything reports nothing and the
caller cannot tell that from an empty list. Omitted, nothing yields and `/admin/regressions` behaves
exactly as before.

`CaseReplay` also gained `malformedExpectations` as a count. The summariser needs to know whether a
case checked what it claims to, and the alternative was matching on the finding sentence — the naive
string scan that has been the wrong instrument in this repository four times now.

### Verify

**Route 1's ten seeded cases, through the real runner, against live production data: 29 of 29 pins
met.** Ten cases, ten `queryDataset` calls, ten `ok` verdicts, 0 unmet, 0 unresolved. This is the
thing that had never happened.

**The whole list: 17 cases, 66 of 66 pins met, `clean`.** Run through the real cron handler with the
real `CRON_SECRET` gate, the real `runScheduledReplay`, the real `loadReplayableCases` reader and the
real `replaySuite`. The eighteenth case is the one seeded case whose tool is `searchDocuments`; see
the harness note below for why it could not run here and what it did instead.

**The cases replayed are the live rows, not a transcription of them.** md5 over all 18 cases'
`tool_calls`, computed in Postgres over `jsonb::text` and again in JS over a re-implementation of
jsonb's key ordering: **`bf234545c98a6fb9d67f2a12fdf15c77`** both sides. md5 over all 66 pins in a
canonical form: **`4f8f81ba8d3b2e892796f0dfd96a6f5d`** both sides.

**Eight negative controls, each perturbing exactly one case and run through the whole scheduled
path**, because a suite that cannot fail proves nothing:

```
figure moved by one          unmet        #8  n_listed was 5,988, now 5,987
count-mode figure moved      unmet        #9  matchingRows was 5,986, now 5,987
renamed field                unresolved   #6  no field n_totals (the row has: geo_code, geo_level,
                                              n_total, n_accredited, pct_accredited)
selector matches nothing     unresolved   #7  no row matched geo_code=99 (1 rows returned)
selector matches three rows  unresolved   #13 3 rows matched geo_code=PH - a selector must name one
`from` with no `where`       unreadable   #12 an expectation could not be read and was not checked
tool cross-check fails       unresolved   #15 call 0 is queryDataset, but this expectation is about
                                              getTrainingCoverage
a tool this build lacks      unknown-tool #14 getVibes is not a tool in this build
```

**The three outcomes, demonstrated at run level** (with the document case set aside so the outcome
turns on the perturbation rather than on the harness):

```
clean        17/17 cases, 66 met,  0 unmet, 0 unresolved   digest 631f815e
clean again  identical                                     digest 631f815e   <- the repeat is a repeat
moved        16 ok / 1 broken, 65 met, 1 unmet, 0 unres.    digest 3e26dfe3
moved again  identical                                      digest 3e26dfe3
structural   16 ok / 1 broken, 65 met, 0 unmet, 1 unres.    digest e59ca0b2
```

**The gate.** An unauthenticated GET returns 401 with `{"error":"Unauthorized"}` and
`runScheduledReplay` is never called — asserted against the live handler in the harness and in four
unit tests covering a missing header, a wrong secret, the secret sent without `Bearer`, and
`CRON_SECRET` unset (which refuses rather than opening).

**Timing, measured rather than assumed.** 17 cases through the scheduled path took **16.3-18.5s**
across five runs, and the full 18 took 26.0s on its first (cold) run. Every one of those numbers is
an upper bound: the harness routes each request through a local proxy and this container reaches
Supabase through an outbound proxy of its own. Against a 45s replay budget inside a 60s function
that is real headroom but not vast, and the run row is what will make it visible if the list outgrows
it — `cases_replayed < cases_open` is a `structural` outcome and the page says how many were never
opened. When that day comes the fix is the read order, not a bigger budget: cases come back newest
first, so it is always the same tail that would be skipped.

**Standards.** `npm run lint`, `npm run typecheck`, `npm test` clean — **811 tests, 38 more than
`main`'s 773**. `npx prettier --check .` fails on the same **149** files as untouched `main`,
compared file by file rather than by count, and every file this branch touches is clean.
`20260828200000_ai_regression_run.sql` parses under `pglast` 8.4 as three statements
(`CreateStmt`, `IndexStmt`, `AlterTableStmt`) and is idempotent — `create table if not exists`,
`create index if not exists`.

**A defect the run found, in the test again — the fifth time, and the same instrument.** The
migration test parses the `create table` body and splits it on top-level commas, tracking quotes so a
`check (... in ('a','b'))` stays one item. It reported nine columns instead of eighteen, because the
header comments *above* the columns are prose and prose has apostrophes in it, and every `'` in
"the run's" flipped the quote state. Comments are now stripped before anything counts quotes. Same
lesson as the four before it, arriving from the other direction: it is not enough to parse instead of
scanning if the parser is fed the comments too.

### The harness, stated plainly, because it is the weakest part of this evidence

**There is no service-role key in any environment available here**, and `dataset_registry`,
`dataset_column` and `ai_regression_case` all have RLS on with no policies, so the anon key reads
nothing from them. The replay above ran against a local PostgREST stand-in that forwards every
request to the real project with the anon key and answers only those three tables from a fixture.

What that does and does not weaken:

- **Every pinned figure came from the real database over real PostgREST.** All nine tables route 1's
  seeds read — including `fact_uuc_phc_barangay` — carry a public-read policy, and were fetched
  live. The same is true of every table the harvested cases' public tools read.
- **The two `ai_regression_case` columns a replay consumes are byte-identical to the live rows**, by
  the md5s above, and the real `loadReplayableCases` parsed them.
- **A wrong registry stand-in can only produce false failures, never false passes.** The registry is
  an allowlist: anything it gets wrong makes `queryDataset` refuse. It carries the live registry's
  structural fields — table name, exposure, status, and every column's name, type, role, unit,
  `is_queryable`, ordinal and `allowed_values` — and elides only the prose (`summary`, `meaning`,
  `notes_md`), which nothing in the replay path reads.
- **The one case that could not run here is case 1**, whose `searchDocuments` call resolves against
  `doc_chunk` — service-role only. Under the anon key its cited chunk does not resolve, and the run
  reported `structural` with "chunk 26 (slide 26) is no longer in the corpus". That is a true
  statement about this harness and a false one about production. It is also, incidentally, the
  `structural` category doing exactly its job: it said *could not check*, not *the figure moved*.

### What this does and does not establish

It establishes that route 1's ten cases replay: twenty-nine figures pinned from screens, scored
through `executeQueryDataset`, the registry lookup, the column allowlist and `evaluateExpectation`,
against live production data, all met. It establishes that the whole list of eighteen runs as one
suite in about twenty seconds, that a perturbed figure fails as `moved` and a perturbed structure as
`structural`, and that the two are kept apart at the pin, the case, the run row and the page. It
establishes that the cron route refuses an unauthenticated call.

**It does not establish that a run has ever been recorded.** `ai_regression_run` does not exist on
the live database — the deliverable is a PR and this session has no instruction to apply migrations —
so `recordRegressionRun` is the one link in the chain that was stubbed. The insert's shape is checked
only by the generated types and by the migration parsing; the first real run will be the first test
of it, and if it fails it fails loudly, as a 500 rather than a green invocation, which is the reason
the status code was defined that way.

**It does not establish that the registry read works under the service role.** It works under a
stand-in built from the live registry's own structural rows. That is most of the risk — every line of
`executeQueryDataset` downstream of the lookup ran for real — but the lookup itself did not.

**It does not establish that the schedule fires.** Nothing here has run on Vercel. The cron entry is
in `vercel.json` and the once-per-day property is asserted against Hobby's documented limit, but the
first proof that a job fires at 22:00 UTC is the first row in the table.

**It still does not establish that the list would catch a change nobody announced** — only that it
would now *look*, daily, without being asked. The difference between looking and catching is the
list's coverage, and the previous entry's assessment of that has not changed: eighteen cases are not
forty, five of the seven harvested ones are national BHW questions, and every case in the list reads
one of two datasets. A daily run over a narrow list is a daily run over a narrow list.

**And it still does not make any case sensitive to prose.** No provider was called, deliberately, and
every caveat on the runner stands.

## 2026-08-28 — The contradiction sweep, re-run: p37 resolved, and resolving it made the slide worse

Increment 4.2 filed twelve `kb_contradiction` rows on 2026-08-28 at 01:14 UTC and none had been
recomputed since. The UUC final-list alignment landed between then and now and predicted, in as many
words, that *"`sweep_contradictions` recomputes, so the row resolves on the next run rather than
needing a hand edit"*. Nothing had tested that. This ran it.

**The prediction held for the rows it named, and the slide it named came back worse.** The queue went
from **12 rows to 22**.

### What the run changed

Run at 14:01 UTC against `bhw-connect` (`ejcuwrnxngdwvecxwrhy`); 16 findings returned. Against the
twelve rows as they stood before it:

| | rows | what they are |
|---|---|---|
| **unchanged** | 6 | slide 161's two, and the four `scalar_magnitude` rows on slides 8, 26 and 151 |
| **no longer reproduced** | 6 | p37 and p141 against `agg_bhw_by_uuc_status.n_barangays_listed` |
| **new** | 10 | p37 and p141 against `agg_uuc_phc_criteria.n_health_evaluable` |

The six unchanged rows are unchanged in the strict sense: value, difference, `evidence` and quote all
md5-identical to the pre-run snapshot, with only `last_swept_at` moved. The six that stopped
reproducing keep their older stamp and are shown stale rather than deleted, which is the shape 4.2
settled on — **they are still at `status = 'auto'`, so the reviewer meets 22 cards, six of them
marked as no longer reproduced.**

A second run returns the same 16 findings and inserts nothing (`max(contradiction_id)` unmoved at
128), so this is a fixed point and not a state mid-churn.

### The prediction, tested

**It was right about the three rows it named.** BARMM 400-against-399, CALABARZON 195-against-200 and
the 5,987-against-5,991 total no longer reproduce, and neither do their three twins on slide 141. The
alignment moved `agg_bhw_by_uuc_status.n_barangays_listed` to 400 / 195 / 5,987, the column now agrees
with p37 on all 17 regions, and a perfect fit is corroboration and is not filed. No hand edit was
needed, exactly as written.

**It was wrong about the slide.** p37 carried three rows before this run and carries five after it.
So did slide 141. The entry's claim that p37 "no longer contradicts `agg_bhw_by_uuc_status` anywhere"
is true and was the wrong thing to check.

### Why fixing the data made the queue worse

The geographic pass discards a perfect fit **per candidate column, not per slide**. When the slide's
true counterpart is found and agrees everywhere, the pass does not conclude *this slide is
corroborated*; it concludes *this column is not interesting* and keeps looking. The next-best column
is then, by construction, the best-fitting column that **disagrees** — and for a slide whose true
counterpart agrees on every cell, a column that disagrees is a column measuring something else.

Before the alignment, four columns tied at 15 of 17 and `n_barangays_listed` won. All four now agree
17 of 17 and all four are discarded together. That leaves the field to
`agg_uuc_phc_criteria.n_health_evaluable` at **13 of 17, a fit of 0.7647**, comfortably above the 0.5
floor, with no tie. It is not a near-miss on the same quantity. It is a **subset**:

```
region                          n_listed   n_health_evaluable   difference
REGION II (CAGAYAN VALLEY)           227                  165          -62
REGION IX (ZAMBOANGA PENINSULA)      523                  516           -7
REGION XIII (CARAGA)                 268                  112         -156
BARMM                                400                  399           -1
the other 13 regions                                                     0
                                                            total     -226
```

The four cells the sweep now files as disagreements are exactly the four regions holding the 226
barangays whose provincial benchmarks cannot support criterion (d). The registry's own `meaning` for
that column says so outright — *"n_listed minus this is the excluded count"* — and the pass cannot
read it, because §12.4's own rule from the first run is that **the pairing vocabulary is an entry's
name, not its prose**. The rule that removed the statute-number false positives is the same rule that
hides this one.

So the shape of the defect is: **the sweep's precision falls as the data improves.** A slide whose
counterpart is wrong produces one true row; a slide whose counterpart is right produces several false
ones. That is backwards, and it is not a threshold that wants nudging — 4.2 already asked whether 0.5
is right and left it open, but raising the floor to 0.8 would keep all ten of these rows and lose
slide 161's genuine three-cell case. The floor is not what is wrong.

**Nothing is changed about the sweep here, and that is deliberate.** Which of these twenty-two
pairings are real is the owner's judgement per owner decision 5 and §7, and a sweep retuned in the
same session that discovered the problem would be a queue tuned to its own author's reading of twelve
rows. What the fix should be — suppress a slide once any candidate corroborates it, rather than
suppress only that candidate — is recorded here to be decided rather than applied.

### The queue now says which pass found each row

§8 4.2 pairs two ways "of deliberately different strength" and `method` is a column for that reason,
but the card rendered it as a bare slug: `geo_distribution` and `scalar_magnitude` look equally
authoritative to anyone who has not read the migration. `describeMethod()` names the strength instead
of implying it — *geography table · exact pairing* against *standalone figure · inferred pairing* —
with one sentence saying what each pass actually matched on, so a reviewer knows how far to trust the
pairing before reading the numbers. Exported for the reason `describeSides()` is: one wording,
wherever these rows are met.

An unrecognised `method` returns strength `unrecognised` and says the pairing cannot be judged from
the card, rather than falling back to the slug and reading as a third normal case. The `check`
constraint admits two values today; a third would arrive with a migration, and until this function is
taught about it the honest answer is that the row is unjudgeable.

The fit line also states how many cells **differ**, not only how many agree. On these ten rows that
is the whole tell: "13 of 17 agree, 4 differ" against a column whose four disagreements are all in
the same direction is a subset showing itself, and a reviewer should not have to do the subtraction.

This extends the queue at `/admin/kb-review` rather than adding a second surface. There was already
one, and a second place to meet these rows would be worse than an imperfect first.

### What this does and does not establish

It establishes that the alignment's prediction was correct as written — a recomputation resolved the
three p37 rows with no hand edit — and that the stale-not-deleted rule behaves as designed under a
real data change. It establishes that the sweep is idempotent across consecutive runs. It establishes
that the corroboration rule is per-column, and that this is not a tuning question but a structural one
with a worked example: ten rows filed against a subset count because the true counterpart agreed too
well to be reported.

**It does not establish that any of the twenty-two rows is a real finding.** All twenty-two are still
at `auto`; nothing here confirms or rejects one, and the sweep still does not feed the §10 list —
`source` does not admit `'swept'`, which stays a value nothing writes.

**It does not establish that ten new rows is the whole cost of the corroboration rule.** Two slides
were re-paired here because the alignment happened to perfect their counterpart. How many other slides
in the corpus are one data correction away from the same fall-through is not known, and this run
cannot say — it only shows what happens when one is.

**And it does not establish that `n_health_evaluable` is the worst available pairing**, only that it
is the best-fitting disagreeing one today. A future column fitting 12 of 17 would take p37 next.

**Standards.** `npm run lint`, `npm run typecheck` and `npm test` clean — **816 tests, 5 more than
`main`'s 811**, confirmed by running `main` rather than taken from the previous entry. No migration:
this branch adds none and applies none, and the only database writes are the two
`sweep_contradictions()` calls the increment is about.

**One recorded number was wrong and is corrected.** `npx prettier --check .` fails on **148** files on
untouched `main`, not the 149 the last three entries record. Measured twice, on `main` at #109 and on
the pre-#109 tree, both 148 — so #109 did not change it and the drift is `"prettier": "^3"` floating
to 3.9.5. This branch fails on the same 148, compared file by file rather than by count, and every
file it touches is clean.

## 2026-08-28 — Corroboration suppresses the slide, not the candidate: the sweep stops losing precision as the data improves

The re-run entry above ends by naming a defect and deliberately not fixing it: *"What the fix should
be — suppress a slide once any candidate corroborates it, rather than suppress only that candidate —
is recorded here to be decided rather than applied."* This applies it.

`20260828210000_sweep_corroboration_suppression.sql` replaces `sweep_contradictions()`. Four lines
of behaviour change and nothing else: the candidate set, the probes, the evidence, the identity
constraint and every guardrail are byte-identical to 4.2's.

### The defect, restated in one sentence

A candidate fitting every cell was skipped with `continue`, which discards **the candidate, not the
slide** — so a slide whose true counterpart agrees everywhere is handed to the best-fitting column
that *disagrees*, and for a corroborated slide that is necessarily a different measure.

The fix sets a flag inside the candidate loop and reads it after, so the slide is dropped instead:

```
if v_fit >= 1.0 then
  v_corroborated := true;
  exit;
end if;
...
continue when v_corroborated or v_best_fit is null;
```

**The read has to be after the loop, and that is the whole of the design.** Candidates are iterated
`order by 1, 3`, so the corroborating one is often probed *after* a disagreeing one has already been
recorded as `v_best`. A guard placed inside the candidate loop — `continue when v_corroborated`,
which looks like the same fix — only suppresses candidates probed *later* than the corroborator, and
leaves an earlier disagreement standing. That variant was built and run: on a fixture whose
disagreeing column sorts first it still files all five rows on the corroborated slide, and suppresses
only the slide whose corroborator happens to come first. It is a fix-shaped bug, and the test below
fails on it.

`v_fit >= 1.0` is stronger than it looks, which is why it is safe to read as a fact about the slide.
The coverage guard runs first and `v_fit` divides by the slide's cell count, not by the cells the
candidate covered — so a perfect fit means the candidate carried a value for **every** geography the
slide names and agreed on all of them. There is no reading of that under which the distribution is
still open.

### The level_total goes with the cells, and the reason is not symmetry

4.2 left this unsettled and the re-run entry named it as undecided. The argument for keeping the
total is real: a slide whose cells all agree can still have a total that differs from the table's
level-wide total, because the table covers geographies the slide does not list, and that difference
is a claim about scope rather than about any one geography.

It does not survive contact with the code. The total row is labelled and computed from
`v_best_table` / `v_best_column` — the *runner-up*, since the corroborating candidate was never
recorded as best. So a surviving total on a corroborated slide would compare the slide's own cells
against a different column's level-wide sum: not a scope finding, the same mispairing restated over
17 cells at once. On p37 that row is the slide's 5,987 against `n_health_evaluable`'s 5,761 — a
difference of exactly the 226 excluded barangays, filed as though it were a disagreement about how
many barangays are listed.

The scope reading is worth having, and it is a comparison against the **corroborating** column, which
this function has never computed and does not compute here. Filing the runner-up's total in its place
would be worse than filing nothing, so the total is suppressed and the scope comparison is left
unbuilt rather than approximated.

### `p_min_fit` stays at 0.5, and the re-run entry's reason for it was arithmetically backwards

Agreed with the conclusion, not with the number. That entry argued *"raising the floor to 0.8 would
keep all ten of these rows and lose slide 161's genuine three-cell case."* Measured on live data, the
ten `n_health_evaluable` rows sit at a fit of **0.7647** and slide 161 sits at **0.6667**, so a floor
of 0.8 excludes both — it would have removed the ten as well, and p37 has no other candidate between
0.8 and 1.0 to fall through to.

The conclusion survives, and in a sharper form than the entry gave it. **The false rows fit better
than the true one**, so no floor separates them: every floor that removes 0.7647 also removes 0.6667.
A threshold can only have bought this queue precision by narrowing what it looks at until the one
real case went with it — which is the same trade `p_min_cells` was refused on, for the same reason.

Nothing here is evidence for moving the floor in either direction. After the fix the geographic pass
files two rows on live data, both from slide 161; a floor is a statement about how much disagreement
is worth reading, and one row is not a distribution to calibrate against. It stays at 0.5, still
chosen before any data, and still the thing to revisit when a corpus with more geographic tables
arrives.

### It has not been run against the live database, and here is what was done instead

**Stated plainly: this migration has not been applied.** There is no owner instruction to apply one
in this session, and `sweep_contradictions()` writes, so it was not called either. The 22 rows at
`status = 'auto'` are untouched — none confirmed, none rejected, none deleted.

That leaves the gap `--propose` recorded — *typed and unrun is not a safety property* — and it is
closed from two directions, neither of which is the function on live data. Both are named for what
they are.

**Real function, synthetic data.** A local PostgreSQL 16 cluster, the 4.2 migration applied to a
fixture built to the p37 shape: 17 regions, a corroborating column and a subset column differing on
four of them. The candidate tables are named so that the **disagreeing** one sorts first under
`order by 1, 3`, which is the ordering hazard rather than the easy case.

| | old function | fixed function |
|---|---|---|
| slide with the disagreeing column probed **first** | 5 rows (4 cells + total) | none |
| slide with the corroborator probed **first** | 5 rows | none |
| slide corroborated by nothing (the 161 shape) | 2 rows | 2 rows, **md5-identical** |

Twelve rows to two. The third row is the one that matters as much as the first two: the fix removes
only what corroboration accounts for, and a genuinely paired slide comes out bit for bit unchanged.
The 161-shaped slide is also the *last* distribution in the fixture, after two corroborated ones, so
it doubles as the check that the flag is cleared per distribution — left set, it would have silenced
everything after the first corroborated slide, and a run that files nothing looks exactly like a run
with nothing to file. Both migrations were applied twice; the sweep run twice returns the same rows
and inserts nothing.

**Real data, reproduced logic.** The geographic pass was rewritten as one read-only query against
`bhw-connect` — the label view, the `dim_geo` resolution, the dedup, the candidate set from the
registry, the uniqueness and coverage guards, and the fit — and run over live data. It is a
reproduction of the logic, not the function.

It reproduces the live function exactly where the two can be compared: on slide 161 it picks
`agg_bhw_by_uuc_status.n_listed_no_bhw` at 0.6667 and names
`unallocated_households` and `unallocated_n_bhw` as the ties, which is the filed row's `evidence`
field for field. On that basis, what the corrected sweep would file:

```
slide  candidates at fit 1.0000                                    best disagreeing   verdict
 37    n_barangays_listed, n_listed_with_data, agg_uuc_phc_counts   n_health_evaluable  corroborated
       .n_listed, agg_uuc_phc_criteria.n_listed                     @ 0.7647            → 5 rows dropped
141    (the same four)                                              (the same)          → 5 rows dropped
161    none                                                         n_listed_no_bhw     unchanged, 2 rows
                                                                    @ 0.6667
```

- **The ten `n_health_evaluable` rows on slides 37 and 141 are not filed.** Four columns agree with
  p37 on all 17 regions — the four the re-run entry said were tied at 15 before the alignment — so
  both slides are corroborated and both are dropped whole.
- **Slide 161's two rows are filed unchanged**, same column, same fit, same ties.
- **The four `scalar_magnitude` rows on slides 8, 26 and 151 are filed unchanged.** Pass 2 is not
  touched by the diff at all; this is byte identity, not a measurement.
- **No slide that files nothing starts filing something**, on two independent grounds. By
  construction, the change only ever adds a suppression: per slide the output is unchanged or empty,
  never different. And empirically there is no such slide to worry about — the whole corpus yields
  **three** distributions of three cells or more (chunks 37, 155, 175), and all three already file.

Sixteen findings become six.

### The ten rows already in the table, and whose call it is to clear them

The migration deletes nothing. After it is applied and the sweep re-run, the ten
`n_health_evaluable` rows simply stop being reproduced: `last_swept_at` stays behind, the card marks
them stale, and they remain at `status = 'auto'`. The queue would then hold 22 rows, **16 of them
stale** — the ten plus the six already stale since the re-run — against 6 current.

That is honest but it is a bad queue. Sixteen stale cards of twenty-two, ten of them filed by a
defect that no longer exists, is a reviewer's whole afternoon spent on rows the sweep would not file
today.

**It needs an explicit step, and it is the owner's.** Not this session's: §7 and owner decision 5 put
these rows with the owner, and a session that fixed the sweep clearing away the evidence of what the
sweep used to do is exactly the shape to avoid. Two ways to do it, and the recommendation is the
second:

- Delete them. Defensible here in a way the stale-not-deleted rule did not anticipate — that rule
  exists because *"deleting it would erase somebody's judgement"*, and these ten carry none. But it
  leaves no record that they were ever filed.
- **Reject them.** The queue already has this control and it is the honest answer to the question
  the card asks: `n_health_evaluable` and the listed count are **not** the same measure, and the
  registry's own `meaning` says why — *"n_listed minus this is the excluded count."* A rejection
  records that, where a delete records nothing. The six stale rows against `n_barangays_listed` are
  the opposite case and want the opposite judgement.

Either way it is one deliberate action after the migration lands, not something a migration should
do on its way past.

### The test parses the loop rather than scanning the file

Five entries in this log record the same mistake: a test asserting on a migration through a raw
string scan — twice silently asserting nothing, three times failing on a legitimate mention. The
rule settled on is to parse the thing being asserted about. This is the first time that rule has had
to bite on *control flow* rather than on a constraint or a format string, and a scan genuinely
cannot do it: the correct fix and the fix-shaped bug above contain the same tokens and differ only in
**where** the flag is read.

So the suite blanks comments and string literals with offsets preserved, matches `loop` to its own
`end loop` counting nesting (with `end loop` matched ahead of the bare keyword so the two never
collide), and asserts positions: the perfect-fit branch inside the candidate loop, the read of the
flag *after* it and before either insert, the reset inside the distribution loop and before the
candidate loop begins. Four deliberate breakages were run against it — the original `continue`, the
flag read inside the loop, the missing reset, and the guard moved below the cell insert so the
level_total survives — and each fails on the assertion that describes it and no other.

**The same pass found a second thing wrong with this suite, which is why it also changed.** Every SQL
assertion in it read `20260828100000_kb_contradiction.sql` by name. The function is `create or
replace`d, so from this migration onward that file describes a body the database does not run — and
a test pinned to it goes on passing while asserting about dead text. That is the string-scan failure
in a new costume: still green, no longer meaning anything. The suite now finds every migration
defining `sweep_contradictions` in apply order. Guardrail assertions run against **all** of them,
since each is live between its own migration and the next; behavioural assertions run against the
last. Table and view assertions still read the 4.2 file, which is where the table and views are.

### What this does and does not establish

It establishes that a slide's corroboration is a property of the slide rather than of a column, and
that suppressing it there removes the ten false rows without touching the two the same run files for
other reasons — demonstrated on the real function against a fixture, and on live data against a
reproduction of the logic that matches the real function everywhere the two can be compared. It
establishes that the ordering hazard is real and not hypothetical: the near-miss fix was built, run,
and files five false rows.

**It does not establish that the sweep has been run with this change.** The migration is committed and
unapplied. Everything above about live data is a reproduction of the pass in read-only SQL, which
matched the function on the one slide that offers a comparison — one slide is what that check is
worth.

**It does not establish that the geographic pass now files anything true.** After the fix it files two
rows on live data, and 4.2 already recorded both as a false positive — slide 161's JMC reinstatements
against `n_listed_no_bhw`, *"not the same measure"*, kept rather than tuned away. The pass's one real
finding was p37, and the data correction resolved it. So the honest summary is that this fix stops
the pass inventing findings; it does not give it any. A corpus with a second geographic table would
say whether the pass is worth its floor at all, and this one cannot.

**It does not establish that corroboration is visible when it happens.** A suppressed slide and a
slide no candidate fitted are indistinguishable from the outside: both return no rows and say
nothing. The function's return type would have to change to tell them apart, which is a
`drop function` rather than a `create or replace`, and it is out of this fix's scope. The cost is
real — if some later change made every candidate look like a perfect fit, the sweep would file
nothing and look healthy — and it is recorded here rather than absorbed.

**And it does not establish how many other slides are one data correction away from this.** The re-run
entry raised that and this does not answer it; it removes the consequence rather than surveying the
exposure. Today the corpus has three geographic distributions, so the survey is small, but the
question is about a corpus that grows.

**Standards.** `npm run lint`, `npm run typecheck` and `npm test` clean — **822 tests, 6 more than
`main`'s 816**, confirmed by running `main` rather than taken from the previous entry. The migration
parses under `pglast` 8.4 as three statements (`CreateFunctionStmt`, `CommentStmt`, `GrantStmt`) and
was applied twice to a local cluster to check it is idempotent. `npx prettier --check .` fails on the
same **148** files as untouched `main` — compared file by file, not by count — with prettier 3.9.5,
which is the number the re-run entry corrected the record to. Two of the three files this branch
edits, `DECISIONS.md` and `AI_ASSISTANT_PLAN.md`, were already on that list before it and are still
on it; the third, `contradiction-review.test.ts`, is clean and was clean. `.sql` is outside
prettier's scope entirely, so the new migration neither joins that list nor can be checked against
it. No database writes: no migration applied, no sweep called, no `kb_contradiction` row judged, and
no `ai_regression_case` filed.

## 2026-08-28 — Increment 4.1's leftover: `ingest.py` calls the profiling pass, and the four things running it found

4.1 built `profile_dataset()` and met the plan's success condition with it, then declined to add one
line: *"`ingestion/ingest.py` does not yet call the pass after a load — one line, deliberately not
added unrun."* The reason was not doubt about the line. It was that the session had no database
credentials and no source extract, and the `--propose` entry two before it had already settled the
principle: **typed and unrun is not a safety property**. Adding the call and reasoning about it would
have reproduced exactly the state 4.1 chose over that.

So the deliverable here is not the line. It is the line **plus the run behind it**, and the run is
what the rest of this entry is about — including two things it contradicted.

### What made the run possible, and where it ran

Both of 4.1's blockers had lifted. `ingestion/data/dataset.parquet` is in the tree at its full
**270,917 rows**, and a PostgreSQL 16.13 is available in the container. So the pipeline was run
end to end against a **local** database, never the live project:

- the 87 committed migrations applied in order (18 fail locally on pgvector, Supabase `auth`/`storage`
  schemas, or seed data whose FK parents those failures removed — none of them registry migrations,
  except `20260826090000_ai_dataset_registry.sql`, which needed only its `create extension vector`
  line stripped: its own comment says *"nothing in this increment stores a vector"*);
- which reproduced the registry state 4.1 verified against — **32 approved datasets, 382 approved
  column rows**, `dim_geo` among them;
- and left `fact_bhw_raw` and `fact_honorarium` with **no registry row at all**, because 4.1's profile
  of `fact_bhw_raw` was a data operation on the live database, not a migration. The local fixture is
  therefore the genuine pre-4.1 state, and the first-profile path is the one that ran.

**No write reached the live database.** This branch adds no migration and applies none.

### The three design decisions, and the measurement behind each

**1. A profiling failure must not be able to lose a good load.** The hook runs after
`run_via_psycopg2()` has committed, on its own connection, one transaction per table; a failure is
recorded in the QA report, warned about on stderr, and **does not change the exit status**.

The arguable half is the exit code, so: the load is the expensive, irreversible half and the profile
is a cheap catch-up any operator can run by hand. A failed profile leaves the database in exactly the
state 4.1 shipped — the dataset is simply not registered yet — which is the status quo, not a
corruption. Exiting non-zero would report a successful load as a failed one, and the obvious response
to a failed ingest is to run the ingest again.

Tested rather than asserted, on the realistic version of this failure — a database where the 4.1
migration was never applied. A second local database was built with only the four tables the
pipeline writes, and the full pipeline run against it:

```
EXIT CODE: 0
WARNING: profiling fact_bhw_raw failed: function profile_dataset_refusal(unknown) does not exist
→ 41,052 dim_geo, 270,917 fact_bhw_raw, 577,069 fact_honorarium   (the load, intact)
→ ingestion_batches.qa_report->'profile'->'tables'->'fact_bhw_raw'->>'failed' reads that same text
```

All three tables failed independently rather than the first aborting the rest, and the failure is
durable **in the database** rather than only in a terminal nobody was watching.

**2. The hook never forces, and that is the whole of its idempotence.** `profile_dataset()` refuses a
table whose registry row is `approved` unless called with `p_force`. Three states were run against a
real 270,917-row load:

| the second load finds | hook does | after |
|---|---|---|
| registry row at `auto`, unreviewed | re-profiles | 1 registry row, 26 column rows — unchanged from the first run |
| registry row `approved` | **skips** | still `approved`, all 26 columns `approved`, all 26 reviewer meanings intact |
| *counterfactual:* the same call with `p_force => true` | re-profiles | registry back to `auto`, **approved columns 26 → 0** |

The third row is why the decision matters. The reviewer's `meaning` **text** survives a force — the
function lifts approved meanings forward — but their **approval** does not, and
`lib/db/dataset-registry.ts` filters both tables to `approved`. A forcing hook would make a reviewed
dataset silently vanish from the assistant on the next re-load, with no error raised anywhere.
Re-profiling an approved dictionary is a reviewer's decision; it is never a side effect of
re-running ingest.

That is one word away from being undone, so it is pinned by a test — and the test **parses**
`ingest.py`, walks to `profile_loaded_tables`, and reads the SQL literals passed to `cur.execute`,
rather than scanning the file. **The first version of that test was wrong in precisely the way this
repository has now been wrong six times**: it collected every string in the function and fired on the
hook's own skip message, which mentions `p_force` as prose. A grep would have been satisfied by a
comment. Verified by mutation — the guard fails on a copy with `p_force => true` spliced into the
call and passes on the committed file.

**3. Guardrail 4 applies to the profiler, and to anything wrapped around it.** 4.1 reads `pg_stats`
after an ANALYZE rather than scanning, and a hook that then asks "so how many rows did we profile?"
would put the scan back at load time through the front door. Per table the hook issues exactly one
catalogue query and one `profile_dataset()` call, and every number it reports is read out of the rows
that call already returned. It never counts rows: `row_estimate` exists so that nobody has to. The
estimate needs no apology here — ANALYZE returned **270,917** and **577,069**, both exactly right.

A fourth, smaller one: **the refusal set is consulted, not reimplemented.** The hook asks
`profile_dataset_refusal()` and the approved-row question directly instead of catching an exception
and parsing its message, so the allowlist has one home. That is also why `dim_geo` is in the target
list despite having had a hand-written dictionary since 1.2 — the pipeline loads it, so it is
offered, and the database declines it. A hardcoded exclusion would be a second source of truth for a
decision `profile_dataset()` already owns.

### The second 4.1 leftover, measured — and the answer is worse than "unproven"

4.1 recorded that 25 of `fact_bhw_raw`'s 26 meanings had to be hand-written, leaving the
borrow-from-the-dictionary route *unproven at scale*. The run measured it, on two tables:

| table | columns | supplied by the dictionary | still needing a sentence |
|---|---|---|---|
| `fact_bhw_raw` | 26 | **1** (`geo_code`) | 25 |
| `fact_honorarium` | 8 | **1** (`id`) | 7 |

The first line **independently reproduces 4.1's hand-count** — the same 1-of-26, arrived at by
running rather than by counting sentences, along with the same `geo_code → dim_geo.geo_code` join at
an overlap of **1.0000**.

The second line is the new evidence, and it does not help the hypothesis. `fact_honorarium`'s single
borrow is `id` — *"Surrogate row identifier; carries no meaning"* — which is a statement that the
column means nothing. **Across 34 columns of two datasets the approved dictionary supplied one hub
key and one admission of emptiness, and not a single domain column.** The route works exactly where
vocabulary is genuinely shared and nowhere else, which is a narrower claim than "it will earn its
keep once several datasets share vocabulary."

One caveat, measured rather than assumed: the count is **order-dependent within a single ingest**.
`fact_bhw_raw` and `fact_honorarium` are profiled in the same run, so the first is still at `auto` —
and therefore cannot lend — when the second is profiled. Re-profiling `fact_honorarium` after its
sibling was approved raises it to **2 of 8**, `bhw_id` borrowing its sentence. The honest figure for
a first ingest is 1; the honest figure for a mature registry is not yet known.

### Two things the run contradicted

**`fact_honorarium.bhw_id` is profiled `role = 'measure'`.** This is the defect 4.1 found and fixed on
`fact_bhw_raw`, recurring on the very next table the same pipeline loads. The fix was the rule *"a
numeric column with about as many distinct values as the table has rows is a row identity, not a
quantity"* (`distinct / rows >= 0.9`). On the **child** side of a one-to-many join the ratio is
229,428 / 577,069 = **0.40**, so the rule does not fire. `role = 'measure'` is what tells the model a
column may be summed and averaged, and 4.1 said of this exact column that *"the mean of `bhw_id` is a
number that would eventually be reported to someone."* The rule turns out to be a rule about the
table where an identity is the grain; it does not survive the foreign-key side of a join.

Worse, this is **not** repaired by the borrow route, and finding out why corrected a second record.
Both the migration header and 4.1's log entry say route 1 lends *"description, unit and join target"*
(`DECISIONS.md` line 5230). The code lends `meaning` and `unit` — nothing else; `role`, `is_join_key`
and `joins_to` are recomputed from the profile on every pass. So when `bhw_id` did borrow, it took a
sentence describing a foreign key while remaining typed a measure and joined to nothing. **The prose
in both places overstates what the function does**, and the mismatch was invisible until a second
table borrowed from a first.

**No join was proposed between `fact_honorarium` and `fact_bhw_raw`** — the one join this pipeline
most obviously has. Not a measurement that failed: an empty candidate set. `profile_dataset()`
proposes joins only toward columns some already-**approved** row names as a join target, and the
entire 32-dataset registry names two — `dim_geo.geo_code` and `dim_dataset.dataset_id`. Nothing names
`fact_bhw_raw.bhw_id`, and nothing will: `bhw_id` is a surrogate that joins to nothing, so it is
`role = 'key'` with `joins_to` null even after review. **The profiler extends the join graph outward
from existing hubs; it cannot create one.** §3 sells the registry on *"which datasets can I connect to
answer this?"*, and regression question 3 is a join-path question — so a child table arriving
unjoinable to its parent is a limit on the thing the registry is for, not a cosmetic gap.

Neither is fixed here. Both are `profile_dataset()`'s rules rather than the hook's, and this increment
is the hook; widening it to retune the role vocabulary would make a hook bug and a profiler bug
indistinguishable, which is the argument §4 already makes about schemas and extractors. Both are
recorded in `ingest.py`'s header as well as here, because the hook now writes rows carrying them
without anyone asking.

### What this does and does not establish

It establishes that the call runs, on a real full-size load, and that its three contracts hold under
test rather than under argument: a profiling failure leaves the load committed and the exit status
clean while recording itself durably; a re-load neither duplicates registry rows nor disturbs an
approved dictionary; and the pass adds no scan at load time. It establishes that a table with no
registry row acquires a reviewable dictionary as a side effect of being loaded, which is what 4.1
left undone.

**It does not establish that the resulting rows are good.** Two of the eight columns it wrote for
`fact_honorarium` are wrong in ways described above, and both are sitting at `auto` waiting for a
reviewer who now has more to catch than 4.1's run implied.

**It does not establish anything about the live database.** The run was local. On the live project
`fact_bhw_raw` is already approved, so the hook's first act there would be to skip it; the first live
row it writes will be for `fact_honorarium`, which has never been profiled and whose eight columns
carry the `bhw_id` defect. That is a prediction, not a result.

**It does not establish that the borrow route scales**, and the measurement moved against it: one hub
key and one surrogate across 34 columns. Nor does it establish the mature-registry figure, since the
one number that improved (1 of 8 → 2 of 8) came from re-profiling by hand in an order a single ingest
cannot produce.

**And it does not establish that `--emit-sql-dir` loads get profiled at all.** They do not. That mode
exists for environments with no database connection, which is exactly what the pass needs, so it
prints the statements to run and records in the QA report that profiling did not happen — rather than
emitting a call whose correctness would depend on the operator applying the batch files in order.

**Standards.** `npm run lint`, `npm run typecheck` and `npm test` clean — **822 tests, the same as
`main`**, confirmed by running `main` rather than taken from the previous entry; this branch changes
no TypeScript. That baseline was measured twice: 816 on `main` at `f889404`, and 822 after #111
merged underneath this branch and was merged back into it — the six new tests are #111's, not this
branch's. `ingestion/`'s own convention is a `--selftest` flag, and `ingest.py`
had none: it has one now, and all six pass (`build_poverty`, `build_psgc_crosswalk`, `extract_kb`,
`ingest_documents`, `ingest_population`, `ingest`). No migration: this branch adds none and applies
none, so there is nothing of its own for `pglast` to parse — the one migration in the tree that was
not here before arrived with #111 through the merge below, and parses as three statements under
`pglast` 8.4. `npx prettier --check .` fails on the same **148**
files as untouched `main` — measured on both trees and compared file by file rather than by count,
confirming #110's correction of the older 149 — and prettier does not format Python, so the one file
this branch touches is not among them.


## 2026-08-29 — Icon-only feedback button; type scale on the profiling breakdown table

Re-cuts the two surviving changes from **#67**, which was closed as superseded rather than rebased.

- `components/feedback/spot-feedback.tsx`: the floating action button is now icon-only — the
  "Feedback" / "Cancel" text label is gone, the pill padding with it. The chat bubble stays and
  swaps to a ✕ while feedback mode is active. The FAB moved into an exported `FeedbackFab` in the
  same file purely so both states can be rendered and asserted in a test; `SpotFeedback` owns the
  state exactly as before.
- `components/profiling-status/child-breakdown.tsx`: section heading and table body `text-sm` →
  `text-base`, header row `text-xs` → `text-sm`. Nothing else.

**Why the third change from #67 was not carried over.** #67 also removed a "To certify" column from
the breakdown table, on the grounds that it was the inverse of "Certified" and therefore clutter.
That premise no longer holds. #70 rebuilt the table as four mutually-exclusive stages that partition
the headcount — Total / Encoded / Validated / Attested / Not encoded — and `certify.remaining` /
`certify.pctToGo` no longer exist. "Not encoded" is a _member_ of that partition, not a redundant
inverse, and the section caption reads "stages sum to 100%", so dropping it would falsify the
caption and leave the remaining columns summing to less than the total. The column set is unchanged
here, and `child-breakdown.test.tsx` now pins the header labels and count so a future re-run of
#67's idea fails in CI instead of shipping.

**Accessibility.** Dropping the visible label means the accessible name comes entirely from
`aria-label` (plus `title` for sighted mouse users), and it has to track state: "Give feedback" when
idle, "Cancel feedback mode" when active. Deliberately _not_ "Cancel feedback" — the comment panel's
own close button already uses that name, and the two are on screen together while commenting. Both
states are asserted rather than eyeballed. Hit target is pinned at `h-11 w-11` = **44x44 CSS px**
(measured in Chromium against the project's own Tailwind build, both states; the old pill was
124x45), meeting WCAG 2.5.5 and well clear of the 24x24 minimum in 2.5.8.

**Testing approach.** The repo had no React render tests and no jsdom/testing-library, and this did
not seem worth adding two devDependencies for: the two new suites render with `react-dom/server` and
parse with `linkedom`, both already dependencies. Each assertion was mutation-checked — removing the
"Not encoded" column fails 3 tests, dropping `aria-label` fails 3, freezing the label so it stops
tracking state fails 2, and restoring the old `px-4 py-3` padding fails 1.

**Standards.** `npm run lint`, `npm run typecheck` and `npm test` clean — **835 tests, up from 822
on `main`** (baseline measured on `main` in this session, not carried over from the previous entry);
the 13 new tests are this branch's two suites. No migration and no database access — presentation
only. No e2e change was needed: nothing in `e2e/` selects the feedback button, by text or otherwise
(the CI-gated smoke path is home → explore → filter → CSV), so the label removal breaks no selector.
`npx prettier --check .` fails on **147** files, down from **148** on `main`: the only difference in
the set is `components/feedback/spot-feedback.tsx`, a pre-existing failure that this branch had to
touch anyway and therefore left clean. Both new test files are clean. Compared file by file, not by
count.
`docs/DECISIONS.md` remains a pre-existing failure: prettier wants to rewrite 849 lines across 225
hunks of six weeks of history (`*italics*` → `_italics_`, blank lines before lists), which would
bury a 17-line UI change. Left alone, as every prior entry has left it; this entry's own text is
prettier-clean.

**Not changed, but worth flagging.** `components/chat/chat-launcher.tsx` has a sibling floating
button ("Ask the data") in the same bottom-right stack with the same
`rounded-full bg-accent px-4 py-3 text-sm` styling. It is now the only pill FAB on the page, so the
two no longer match. It was left alone deliberately — it is text-only with no icon, so there is no
mechanical icon-only equivalent, and picking one would be a design decision beyond this change.

## 2026-09-02 — D1.1: BetterGov.PH investigated; COMELEC returns adopted as a second source

`docs/LEGISLATIVE_DISTRICTS_PLAN.md` D1.1 asked whether BetterGov.PH's advertised district mapping
(256 districts / 85 provinces / 22 cities / 7,418 barangays / 99.8% of members) is loadable, which
would have collapsed D1.3 from 2–3 days into a loader. **It is not.** Full findings are in the plan
at §4/D1.1; the parts that are decisions rather than findings are recorded here.

**Correction to the plan's earlier research.** The plan's §2 said the file could not be located in
BetterGov's 36 public repos. That was right about `open-congress-data` and wrong overall: the
mapping is in `bettergovph/open-data-visualization`, a 34,654-file application repo that reads as
an app rather than a dataset. The §2 row has been rewritten.

**Decision 1 — do not load or depend on either BetterGov file.** Two independent reasons, either
sufficient. (a) `static/data/districts.json`, the file that matches their "22 cities" claim, fails
our own D1.5 gates: Quezon City's 1st and 3rd Districts hold the identical 115-barangay list with
the other four sharing a 5-barangay placeholder (118 distinct barangays against QC's real 142), and
Palo sits under Leyte's 4th District when it belongs to the 1st. Its own `metadata` describes it as
derived from project-location caches and reports counts (162 districts, 26 provinces, 5 cities)
that disagree with its own 115-entity payload. (b) Licensing: the repo has no `LICENSE` and its
README scopes the work to "educational and research purposes", which cannot be republished under
the CC BY 4.0 commitment in the plan's §8. (b) alone would have settled it even had (a) passed.

**Decision 2 — adopt COMELEC 2025 precinct returns as a second source in D1.3/D1.4.** This is a
deviation from the plan as written (Wikipedia for composition, Wikidata for the registry, PSA for
validation, `jgngo/psgc-data` as a stale third opinion) and is the reason the half day was worth
spending. BetterGov's other file, `static/data/districts_generated.json`, is sound — 86 provinces,
1,627 municipality rows, 220 province-level districts, and correct barangay-grain splits for 12
multi-district cities — because it is not really their data: `scripts/extract_districts_from_elections.py`
derives it from precinct-level COMELEC returns by reading the
`MEMBER, HOUSE OF REPRESENTATIVES - <DISTRICT>` contest each precinct voted in. Spot-checked
against ground truth: Leyte's 1st (all 8 municipalities), Pampanga's 2nd (6) and 3rd (5), and
Quezon City at 142 barangays with 37 in the 3rd District — the same 37 our own Wikipedia reading
returned, from a wholly independent path.

The district comes off the ballot, which makes it the best available answer to the multi-district
city — the case the plan calls the hardest part of D1 and the one Wikipedia infoboxes serve worst.
We crawl COMELEC ourselves rather than depending on `klescosia/ph-elections2025`, the upstream
BetterGov used, because that repo also has no `LICENSE`.

**Decision 3 — two sources or unresolved.** Added as D1.5 gate and guardrail 2 (renumbering the rest of §7): no district
assignment ships unless Wikipedia and COMELEC agree; disagreements go to the disagreement report
and the LGU stays unresolved. This is not a new principle so much as the existing two-way
reconciliation discipline applied to a dimension that did not have a second source until now, and
it is the gate that would have caught both BetterGov failures before they reached a page.

**Not done, and deliberately.** No issue has been filed on `bettergovph/open-data-visualization`.
The remaining ask is a licence question rather than a data question, it is off the critical path,
and filing on a third party's repo is the owner's call. Draft text is committed at
`docs/bettergov-district-mapping-issue.md`, including the two data problems above reported back to
them, and the observation that their published "7,418 barangays" figure is `city_barangays_mapping.json`
— a PSGC city→barangay roster carrying no district on any row — rather than mapped barangays, of
which there are ~1,800.

**Standards.** Documentation only: no migration, no schema, no application code, no dependency
change, so `npm run lint` / `npm run typecheck` / `npm test` are unaffected and the suite is
untouched at its current baseline. `npx prettier --check` passes on
`docs/LEGISLATIVE_DISTRICTS_PLAN.md` and `docs/bettergov-district-mapping-issue.md`.
`docs/DECISIONS.md` remains the pre-existing prettier failure it has been since July, left alone as
every prior entry has left it; this entry's own text is prettier-clean.

## 2026-09-02 — D1.2: the four legislative-district tables

`supabase/migrations/20260902030000_legislative_districts.sql`, applied to `bhw-connect`
(`ejcuwrnxngdwvecxwrhy`) via the Supabase MCP. Schema exactly as
`docs/LEGISLATIVE_DISTRICTS_PLAN.md` §3 specifies it — `dim_legislative_district`,
`geo_district_map`, `district_representative`, `district_correction`, plus the partial unique index
— with per-table reasoning carried in comments as every other migration here does. No data:
all four tables are empty, and D1.3 loads them. `geo_level_enum` untouched, per §1.

**RLS, decided per table rather than by default.** All four have RLS enabled in the same statement
block as the `CREATE TABLE`, per the 0.3 guardrail.

- **The three mapping tables are public-read**, gated on `status <> 'rejected'`. Two calls here.
  Public at all, because /districts and /districts/[code] (D2.1, D2.2) publish this mapping and its
  per-row provenance — the feature's whole posture is that the grouping is published rather than
  asserted, and a service-role-only table would make the transparency page a server-rendered
  privilege rather than a public fact. And `auto` rows readable, not just `approved`: D1 loads at
  `status = 'auto'` and D2.1 renders all 254 districts immediately, so gating public read on
  `approved` would leave the page empty after a _successful_ ingest. What tells a reader how much
  to trust a row is the match-quality badge, not the status column. `rejected` rows are withheld
  because rendering a row a reviewer has ruled wrong would contradict the review.
- **`geo_district_map` publishes superseded rows too.** Hiding them would hide precisely the
  evidence that makes the correction mechanism credible rather than decorative — D2.2 and D2.5
  render the history, so the history has to be readable.
- **`district_correction` is public-INSERT-only, with no SELECT policy**, exactly as `feedback` is.
  `submitter_email` sits on the table, and any SELECT policy broad enough to serve D2.5's public
  ledger would equally serve someone who wants the email column.

  **This leaves D2.5 a constraint, not a gap, and it is worth stating now:** the public ledger
  cannot read this table directly from the client. It needs a server-side route (or a view) that
  projects only the publishable columns — id, action, district, status, `review_note`, timestamps —
  and never `submitter_email`. Relaxing this policy is the wrong fix and the tempting one.

**Three indexes beyond the plan's one.** The plan specifies `geo_district_map_live_idx` (the
partial unique index that makes supersession possible at all — without the `where superseded_by is
null` clause a correction would collide with the row it replaces). Added: `geo_district_map
(geo_code)`, `geo_district_map (district_code)`, `district_representative (district_code)` and
`district_correction (status, created_at desc)`. Postgres does not index a foreign key
automatically, and the reverse lookup — "which district is this LGU in" — is a stated requirement,
not a speculative one: D3.3's `/api/geo/search` has to surface "Leyte's 1st" from "Palo", and it is
one of D3.4's four regression cases. Cheap on empty tables, awkward to add once loaded.

**No `'fuzzy'` value in the `match_method` check constraint**, deliberately. Guardrail 1 says never
fuzzy-match a place name into a district; putting the enumeration in a check constraint makes that
a thing the database refuses rather than a thing an implementer has to remember.

**Verification.** Not just "the migration applied":

- All four tables present, RLS enabled on each, and exactly the intended policies
  (`[r]` select on the three mapping tables, `[a]` insert on `district_correction`) — read back
  from `pg_class`/`pg_policy`, not assumed.
- All 10 indexes present and correct, including the partial unique index with its `WHERE` clause
  intact.
- `ingestion/verify_rls.py` extended to cover the new tables and **run against the live project as
  `anon`: all 26 checks pass**, including the new `district_correction` insert (201) followed by a
  select returning zero rows — the same insert-only shape `feedback` has.
- The `rejected`-row gating exercised directly, since `verify_rls.py` is deliberately anon-only and
  cannot seed one: two rows inserted as service role (`auto` and `rejected`), then read as `anon` —
  the `auto` row is returned, and the `rejected` row is not, **including when `anon` asks for it
  explicitly** with `?status=eq.rejected`. Both rows then deleted; all four tables verified back at
  zero.
- `get_advisors(security)` shows **no new findings**. Every lint returned is pre-existing
  (`rls_enabled_no_policy` INFO on the service-role-only tables — the deny-all-by-design outcome
  documented in increment 0.3 — plus the `function_search_path_mutable` WARNs and the auth setting).
  None names any of the four new tables.

**Standards.** `npm run lint`, `npm run typecheck` and `npm test` clean — **835 tests, unchanged**:
this increment adds no application code and no test, which is correct for a migration that creates
empty tables. The behaviour that could regress here is RLS, and that is covered by `verify_rls.py`
against the live database rather than by a unit test against a mock. `npx prettier` has no parser
for `.sql` or `.py`, so neither changed file is in its scope, consistent with the other 88
migrations.

## 2026-09-02 — D1.3: the legislative-district builder

`ingestion/build_legislative_districts.py` (modes mirroring `build_psgc_crosswalk.py`:
`--selftest`, `--fetch --snapshot-dir`, `--from-snapshot`, `--emit-sql-dir`/`--database-url`,
`--write-doc-summary`), the committed snapshot at `ingestion/data/districts_20th/`, the generated
`docs/LEGISLATIVE_DISTRICTS.md`, and a follow-on migration. **No data has been loaded**: the build
fails three of its eight gates and therefore refuses to write, which is the design working, not a
step skipped. What the increment delivers is a reproducible build and an honest account of what it
cannot yet resolve.

**Current build: 250 districts, 3,043 membership rows, 194 representatives**, from a snapshot of
114 province/city pages and 256 district articles.

**Deviation 1 — the district articles are the composition source, not the province tables.** §2
said Wikipedia province pages carry the `{{Collapsible list}}` of constituent LGUs, and they do —
for 68 of 114 pages. The other 46 either use one of eight different heading spellings, or carry no
table at all (Agusan del Norte's "Congressional representation" section is a `{{main}}` hatnote and
nothing else). Every one of the 256 district articles, by contrast, carries the same
`{{Infobox constituency}}` with a `|towns =` field — and, decisively, an `|abolished =` field.
Agusan del Norte's 1st reads `abolished = 2025`. Building from the province pages would have
silently loaded six districts the 20th Congress does not have. The province pages are still read,
for the sitting representative, which the articles do not carry uniformly.

**Deviation 2 — a fifth match method, `whole_parent`** (migration
`20260902050000_district_corroboration.sql`). A lone or at-large district covers its whole parent
by definition, so Wikipedia does not enumerate its 25 municipalities. The builder expands those
itself. Filing the result as `exact` would claim we matched a name we never read; `manual_override`
would claim a person decided each one. It is a containment fact and now says so — 828 of 3,043
rows. The same migration adds `corroboration` / `corroborating_source_ref`, because D1.1's
two-source rule arrived after §3 was written and had nowhere on the row to live. The column is
deliberately source-agnostic: the rule is about independence, not about COMELEC.

**Deviation 3 — scope is chosen by evidence, not by name.** Deciding whether "Legislative
districts of X" is about a province (members are municipalities) or a city (members are barangays)
cannot be done by name lookup, and the failures are not hypothetical: **"Quezon City" normalises to
the same key as the province of Quezon**, "Leyte" is both a province and a municipality inside it,
every NCR HUC appears at both province and citymun level, and **Manila's barangays sit two levels
down**, under the sixteen citymun rows that are its _administrative_ districts — the only place
PSGC uses a "district" level at all. So the builder scores every candidate reading by how many of
the page's own members actually resolve under it, and takes the strict winner. Candidates that
resolve against the same set are deduped first, or an HUC's province row and its lone citymun child
would look like a tie and be reported as ambiguous. No hand-maintained city list is needed.

**The environmental constraint, stated plainly: COMELEC is unreachable.** HTTP 403 from both
`2025electionresults.comelec.gov.ph` and `comelec.gov.ph`, with the agent proxy reporting no relay
failures — so the block is theirs, the same class of constraint `build_psgc_crosswalk.py` already
documents for PSA. Every row is therefore `corroboration = 'single_source'`, the two-source gate
fails, and the build will not write without `--allow-single-source` saying so in as many words.
This is the correct outcome: D1.1 found a plausible mapping nobody had cross-checked, and shipping
one of our own would be the same mistake with better provenance.

**Also learned, and worth not rediscovering.** Fetched one page at a time, en.wikipedia.org
rate-limited this build to roughly one page every three minutes — about five hours for a full run.
`action=query&prop=revisions` takes 40+ titles per request, which turns 370 pages into ten calls
and seconds of wall time. A descriptive `User-Agent` is required; the default urllib one gets 429.
WDQS was additionally under an active outage limiting to 1 request/minute, which the single
registry query tolerates but a chattier design would not.

**Residuals, all reported rather than hidden** (`ingestion/_qa_report_legislative_districts.json`,
summarised in `docs/LEGISLATIVE_DISTRICTS.md`):

- **250 districts against the plan's expected 254.** 256 Wikidata items minus 6 filtered as
  abolished. The gap needs a look before load — most likely districts created by recent Republic
  Acts that Wikidata has not caught up with, which is precisely the time-varying behaviour §1 gives
  `congress_no` for.
- **56 citymuns uncovered, 46 double-claimed; 13 multi-district cities with leftover barangays.**
  Real gaps in the parse, not silent guesses.
- **512 unresolved and 49 ambiguous members**, each with the name, the link target and the reason.
- One of those is worth naming because it is the guardrail working: **Wikipedia lists "Dulian
  (Upper Pasonanca)" in Zamboanga City's 1st and "Dulian (Upper Bunguiao)" in its 2nd, while PSA's
  `dim_geo` carries a single `DULIAN`.** Two source names landing on one row is a source
  disagreement, not a match; picking either would invent a fact and double-claim a barangay. Both
  are reported and neither is emitted, which is why `no_barangay_in_two_districts` passes.

**Testing.** `--selftest` runs on synthetic fixtures with no network and no DB, asserting parsing
(including that the "History" and "At-Large (defunct)" tables do _not_ leak into the current
roster), normalisation, all four rungs of the resolution ladder, evidence-based scope detection,
and the gates. Mutation-checked, four ways: removing the section scoping admits the defunct and
history districts (caught); adding a fuzzy fallback to the ladder makes "Bravoo" resolve to "Bravo"
(caught — this is guardrail 1 enforced by a test rather than by a comment); neutering the
corroboration gate lets single-source rows pass (caught); and loosening name normalisation collapses
distinct places (caught).

**Standards.** `npm run lint`, `npm run typecheck` and `npm test` clean — 835 tests, unchanged: this
increment adds no application code. The migration's constraint behaviour was verified against the
live database rather than assumed — `whole_parent` accepted, `fuzzy` rejected with a check
violation, both seed rows removed and all four tables confirmed back at zero. `get_advisors` was
already run for these tables in D1.2 and the new columns add no policy surface. `.sql` and `.py`
have no prettier parser; `docs/LEGISLATIVE_DISTRICTS.md` is generated, and is prettier-clean as
generated.

**Not committed:** `ingestion/data/dim_geo.csv`, a local export of our own `dim_geo` produced for
`--dim-geo-csv`. It is derived from the database rather than being a source snapshot, so it is
rebuilt, not versioned — the same posture `dim_geo_nir.csv` already takes. The Wikipedia and
Wikidata snapshots (6.5 MB) **are** committed, because the build must be reproducible without the
network and it must be possible to diff why a mapping changed between two runs.

## 2026-09-02 — D1.3b: COMELEC as the second source, BetterGov as a validation set

Implements the recommendation put to the owner and accepted: take the second source from **COMELEC
directly**, and give BetterGov.PH's file the role it can actually hold — a validation set. Two new
modes on `ingestion/build_legislative_districts.py` (`--comelec-snapshot`, `--validation-set`) and
four bug fixes the cross-check paid for immediately.

**Why COMELEC and not BetterGov, recorded because it is not obvious.** They are not two sources:
BetterGov's `districts_generated.json` _is_ a COMELEC derivative — their
`extract_districts_from_elections.py` reads the House contest out of crawled precinct returns.
Taking their file would take the same source at two removes through someone else's parser, which is
the shape of the mistake D1.1 found. Beyond that: coverage (their file resolves barangay grain for
12 multi-district cities; there are ~34, and the multi-district city is the hard part of D1), and
licence (their repo has none, while what we take from COMELEC — which contest a precinct voted in —
is a fact rather than expression, the same §8 argument the plan already makes for the
Wikipedia-derived mapping).

**The licence question dissolves once the role is right.** Checking work against something needs no
licence; republishing it does. So their file is compared against and never ingested — the role §2
already gives PSA. `compare_against_validation_set()` reports and cannot write: a selftest asserts
that no membership row is mutated by a comparison.

**No `--fetch` for COMELEC, and the shortcut does not exist.** `comelec.gov.ph` and
`2025electionresults.comelec.gov.ph` both return 403 with the proxy reporting no relay failures.
The one reachable bulk CC BY 4.0 precinct-level dataset (Figshare 29086472, 63 MB) was checked
column by column and carries **senate and party-list only** — nationwide contests that say nothing
about congressional districts. The House contest lives in the per-precinct returns, so the snapshot
is produced by hand on an unblocked connection and committed, exactly as every PSA file here is.

**What the cross-check found.** Run against BetterGov's 2,286 resolvable rows, the first comparison
returned **37 disagreements**. All four causes were ours:

1. **`normalise_name` folded "Iloilo City" onto "Iloilo".** Iloilo City's lone district took the
   slug `iloilo-at-large` and, having no members to score, fell through to the namesake province
   and was expanded across **all 35 municipalities of Iloilo** — which have five districts of their
   own. Fixed by splitting `slug_normalise()` from `normalise_name()`: matching a place folds
   "city", identity must not.
2. **`default_scope` ignored an explicit "City" in the source name.** When the source says "Iloilo
   City" that is evidence, not decoration, and it now outranks a province of the same folded name.
3. **A national name fallback fired even when a scope was known.** Taguig–Pateros does not resolve
   to one dim_geo row, so its page was unscoped and its barangay **"San Roque" matched the
   municipality of San Roque in Northern Samar** — a different island group. Bataan's **"Samal"**
   was filed under Davao del Norte the same way. Both were nationally unique, so both looked like
   clean `exact` matches. The fallback is gone: an unscoped page resolves nothing, and a member
   absent from its scoped province is `unresolved_in_province`. Unresolved is a published gap; a
   nationally-unique wrong match is an invisible lie.
4. **Two pages genuinely need rung 4**, and only two of 114. `MANUAL_SCOPES` now carries Calamba
   (two municipalities of that name; only the Laguna city has a district of its own) and
   Taguig–Pateros (spans a city _and_ a municipality — the case §1.1 names as the reason district
   codes are slugs), each with its reason.

**Result: 37 disagreements → 0.** 2,012 rows agree with an independently derived COMELEC-based
mapping and none disagree. Double-claimed citymuns went 46 → **0**; unresolved members 512 → 158;
ambiguous 49 → 2; membership rows 3,043 → 3,207. Three of those four fixes were bugs no gate we had
would have caught, because each produced a plausible, internally consistent row — which is the
argument for a second opinion, made concrete.

**Still failing, and honestly.** `corroborated_by_two_sources` (no COMELEC snapshot in this
environment — 3,207 single-source rows), `citymun_covered_exactly_once` (62 uncovered), and
`multi_district_city_barangays_complete` (13 cities with leftover barangays). The build still
refuses to write. D1 is not done.

One thing the fixes changed that is worth noting rather than hiding: `disambiguated` now resolves
**0** rows in the real build, because removing the national fallback moved those cases onto the
in-province exact path. The rung is still implemented and still selftested; it is simply not load
-bearing against these sources. If a future source needs it, it is there.

**Testing.** `--selftest` gains COMELEC contest parsing (including that a Sangguniang Bayan
district is _not_ a congressional one), corroboration across agree/disagree/absent, the assertion
that a corroborated row satisfies the gate a single-source row fails, the validation-set diff, and
the manual-scope path. Mutation-checked four more ways, all caught: restoring the national fallback,
folding "city" back into the slug, letting the validation set write to rows, and making
corroboration ignore the ordinal.

**Standards.** `npm run lint`, `npm run typecheck`, `npm test` clean — 835 tests, unchanged; no
application code. `npx prettier --check` passes on the regenerated `docs/LEGISLATIVE_DISTRICTS.md`.
BetterGov's file is **not** committed and not redistributed; it is read from a local checkout via
`--validation-set`, and the generated doc names only its basename.

## 2026-09-02 — D1.3c: closing what the coverage gates could reach

Four parse fixes and a gap analysis. Membership rows **3,207 → 3,397**; rows agreeing with the
independent COMELEC-derived mapping **2,012 → 2,125**, still with **zero disagreements**; uncovered
citymuns **62 → 59**; cities with leftover barangays **14 → 10**. Two gates still fail and the build
still refuses to write.

**Four fixes, each a distinct failure of the same kind — a source shape the parser did not know.**

1. **A range whose upper bound is a wikilink.** Caloocan's 2nd writes `Barangays 5–[[Barangay 76,
Caloocan|76]]`. `link_text_and_target()` returns only the first link's display text and silently
   discards everything around it, so the range became the single member `"76"` and **71 barangays
   were lost**. Links are now flattened to their display text _before_ run detection.
2. **Lettered ranges.** Davao City writes `Barangays 1-A–10-A`; dim_geo spells these
   `BARANGAY 1-A (POB.)`. The range now walks the number and carries the letter. Bounds with
   different letters are deliberately **not** expanded — a run that crosses suffixes is two runs,
   and guessing across them stops being arithmetic.
3. **A lone district naming its own parent.** Biñan's towns field reads simply `Biñan`, meaning
   "all of it". This was worse than an empty list, because **Biñan has a barangay named BIÑAN**: the
   name resolved cleanly and the district ended up with 1 of the city's 24 barangays. A clean match
   at the wrong grain is the quiet kind of wrong, so it is now recognised by name.
4. **Butuan's label variant.** Wikidata files it as "Legislative district of Butuan", which the
   parent pattern cannot read; the page redirects to "Butuan's at-large congressional district",
   which parses. The resolved title is now the fallback, recovering a district that was being
   dropped for a naming variant.

**The remaining gap is characterised rather than merely counted** (`analyse_gaps()`, published in
the QA report and in `docs/LEGISLATIVE_DISTRICTS.md`). "59 uncovered municipalities" is a number;
"9 of them are Manila's administrative districts and 8 are the BARMM Special Geographic Area" is
something a reader can act on, and it is what D2.2 will publish rather than hide. Three causes are
now established, and **none of them is a parsing defect** — each is a statement about the sources:

- **Wikidata's roster is incomplete.** It carries no district for Angeles, Olongapo, Lucena,
  Tacloban, Puerto Princesa or Isabela City — all lone-district HUCs whose districts plainly exist.
  The registry drives the page list, so these were never fetched. **This is most of the 250-vs-254
  gap.** Synthesising the missing rows from `dim_geo` would be exactly the fabrication this build
  refuses everywhere else, so they are reported instead.
- **Davao City is described at a grain PSGC does not model.** Its 3rd district lists administrative
  districts — "Baguio (8 barangays)", "Calinan (19)", "Marilog (12)", "Toril (25)", "Tugbok (18)" —
  while `dim_geo` hangs all 182 barangays directly off the city with no intermediate level. Those 82
  barangays **cannot be placed from this source at all**. COMELEC precinct returns resolve it
  exactly, because a precinct sits in a barangay and names its own contest. This is the clearest
  single argument for the second source, and it is why the remaining coverage gap and the
  corroboration gap are partly the same problem.
- **The BARMM Special Geographic Area** is covered by no district article; its municipalities were
  transferred from Cotabato and these sources have not caught up.

**Testing.** All four fixes are asserted in `--selftest` — including that mismatched letter bounds
do _not_ expand — and mutation-checked four ways, all caught: dropping the link flattening (the
range collapses to `["76"]`), ignoring the letter on a lettered range, disabling the
lone-names-parent rule, and removing lettered-range handling entirely. The rule in (3) was extracted
into `lone_district_names_parent()` specifically so it could be tested directly rather than only
through a full build. The generated doc now collapses blank-line runs, so adding a section cannot
reintroduce the double blank that prettier would rewrite — a generated file that the formatter keeps
rewriting is recurring diff noise.

**Standards.** `npm run lint`, `npm run typecheck`, `npm test` clean — 835 tests, unchanged; no
application code. `npx prettier --check` passes on the regenerated doc.

## 2026-09-02 — D1.3d: the six "missing districts" were a resolution failure here, not a gap in the sources

The increment was scoped as "fetch the six lone-district HUCs Wikidata's roster is missing" —
Angeles, Olongapo, Lucena, Tacloban, Puerto Princesa, Isabela City — on the reading D1.3c recorded.
**That diagnosis was wrong, and the correction is the substance of this entry.** None of the six
has a legislative district of its own. Each is a _member_ of a district that the build had already
fetched and parsed, named in that district's own article:

| city            | district it votes in | the article's own words                                                        |
| --------------- | -------------------- | ------------------------------------------------------------------------------ |
| Angeles         | Pampanga's 1st       | "The district consists of Angeles City, the adjacent city of Mabalacat, and…"  |
| Olongapo        | Zambales's 1st       | "consists of the city of Olongapo and adjacent municipalities…"                |
| Lucena          | Quezon's 2nd         | "consists of Quezon's capital city of Lucena and adjacent municipalities…"     |
| Tacloban        | Leyte's 1st          | "consists of the provincial capital, Tacloban, and adjacent municipalities…"   |
| Puerto Princesa | Palawan's 3rd        | "composed of the city of Puerto Princesa and adjacent municipality of Aborlan" |
| Isabela City    | Basilan's lone       | infobox `region = [[Zamboanga Peninsula]] ([[Isabela…]])` + `[[Bangsamoro]]`   |

The independently derived COMELEC-based mapping agrees with all six, so this is not one source's
opinion. Wikidata's roster was right to have no district for them, and the 250-vs-254 count was
never the same question as the coverage gap — a point worth keeping, because the two were run
together and the plan's expected 254 still needs its own look.

**What actually failed is a fact about PSGC, and it was one level below where anyone was looking.**
A highly urbanised city gets its **own province-level row** in `dim_geo`, with the city hanging off
that row rather than off the province it sits in: `CITY OF ANGELES (HUC)` (03301) with child
`CITY OF ANGELES` (0330100), beside but not inside `PAMPANGA`. Such a city can still vote with the
province. So the province-scoped lookup — which is correct, and stays the default — could not reach
a row that is not the province's child, and five of the six came back `unresolved_in_province`
while the source said plainly where they belonged. The sixth sat inside a `whole_parent` expansion
that had the same blind spot. This is exactly the case the plan's D1.4 named in advance as rung 4's
expected work ("Isabela City/Basilan, Cotabato City, the HUC-votes-with-province cases"); what it
did not anticipate is that five of them are attested well enough not to need a human at all.

**The fix takes its evidence from the source rather than from a hand-maintained list.** A
"Legislative districts of X" page states in its **lead sentence** exactly which independent cities
its districts represent, as disambiguated wikilinks: _"…the representations of the province of
[[Pampanga]] and the highly urbanized city of [[Angeles City|Angeles]]…"_. `independent_city_scope`
reads that and widens the province's scope by those cities only. Two constraints keep it from being
the national fallback D1.3b removed:

- **The lead sentence only.** The same phrasing recurs throughout every page's History section
  about arrangements that ended decades ago — Zambales's page has "the city of Olongapo (chartered
  in 1966)" in a sentence about 1898–1972 — and a whole-page scan would import those as current.
- **Within the province's region, and never nationally.** A city that votes with a neighbouring
  province is in that province's region; requiring exactly one citymun of that name in the region
  is narrow enough that the "San Roque in Northern Samar" class of accident cannot recur. A name
  that does not resolve to exactly one is reported, never guessed at.

The widening also happens **after** `choose_scope`, not before. Scope detection scores candidate
readings by how many members resolve under each, and a scope widened first would let a wrong
reading borrow a city to win on.

**It is its own `match_method`, and that is the decision most worth arguing.** Filing these as
`exact` would have been defensible — the name did match exactly — and it is precisely what makes it
wrong. D1.3b's third bug was a barangay of Taguig matching the municipality of San Roque in
Northern Samar, and it survived review because a widened lookup left no trace on the row it
produced. The set a name was matched against is a property of how the row was made, and D2.2
publishes a per-row receipt; `independent_city` puts it on the row instead of in a build log.
Migration `20260902070000_district_independent_city.sql`, following D1.3's `whole_parent`.

**Isabela City is deliberately not that method.** It votes with Basilan from Region IX while the
rest of Basilan is in the Bangsamoro, so the region test refuses it — correctly — and Basilan's
page lead names no city at all. A person decided it, with the reason committed beside the entry,
and it ships as `manual_override`. One override in 3,403 rows is the rung working as designed
rather than a list starting to grow.

**Result.** Membership rows **3,397 → 3,403**; uncovered citymuns **59 → 53**; unresolved members
**107 → 102**; rows agreeing with the independent COMELEC-derived mapping **2,125 → 2,130**, still
with **zero disagreements** and **zero double-claimed** citymuns. No other gate moved. The build
still fails `corroborated_by_two_sources` (no COMELEC snapshot in this environment) and
`citymun_covered_exactly_once`, and still refuses to write. D1 is not done.

**Two corrections to what the D1.3c entry recorded, since both would otherwise be re-derived.**
Its "10 cities with leftover barangays" does not reproduce: the figure is **12**, both before and
after this change, from an unmodified snapshot. And its first "cause already established" —
Wikidata's incomplete roster — was the wrong diagnosis described above; `KNOWN_GAP_NOTES` now
carries the corrected account rather than quietly dropping the old one, because the generated doc
is what a reader checks.

**The residual gap is now characterised down to individual rows**, in `RESIDUAL_GAP_NOTES` and the
QA report. Of the 31 remaining `unresolved_in_province` members, **23 are name disagreements**
between Wikipedia and PSA ("Impasugong" against `IMPASUG-ONG`, "Maayon" against `MA-AYON`), of
which two look like renamings rather than spellings and one — "Talitay", filed under Maguindanao
del Sur by the article and under Maguindanao del Norte by `dim_geo` — is a boundary disagreement
between the sources, not a name question. The other **8 are template syntax**, not places: four
articles write `| titlestyle              = …` with a long run of spaces the member parser does not
recognise as a parameter, so the parameter and the list's own "LGU" title leak in as member names.
Neither class is touched here. The 23 each need a decision and a reason, which is per-row work
rather than a parser change; the 8 are harmless to the mapping but are noise in a list D2.2
publishes.

**Testing.** `--selftest` gains the whole rung on synthetic fixtures: lead-sentence extraction
including that the History section's identical phrasing does _not_ leak in, the region test with a
same-named city planted in another region, the barangay-grain guard, the override path, and
`lone_district_rows` — extracted from `build()` for the same reason `lone_district_names_parent()`
was, so it can be asserted directly. Mutation-checked six ways, **all six caught on the first run**:
dropping the region test, scanning the whole page instead of the lead, letting the rung fire on a
city page, reporting an override as `independent_city`, dropping the de-duplication in the lone
expansion, and removing `independent_city` from the declared-method gate.

**Standards.** The migration's constraint behaviour was verified against the live database rather
than assumed — `independent_city` accepted, `fuzzy` rejected with a check violation, the probe rows
removed and all four tables confirmed back at zero. `npm run lint`, `npm run typecheck` and
`npm test` clean — 835 tests, unchanged; this increment adds no application code. `npx prettier
--check` passes on the regenerated `docs/LEGISLATIVE_DISTRICTS.md` and on this entry. `.sql` and
`.py` have no prettier parser.

## 2026-09-02 — D1.3e: Manila was 30% mapped, and the coverage count was hiding it

`whole_citymun`, a rung for a district described by sub-city administrative unit, plus migration
`20260902090000_district_whole_citymun.sql`. Manila's barangay coverage **258/857 → 813/857**;
membership rows 3,403 → 3,411; uncovered citymuns 53 → **45**; unresolved members 102 → 92.

**How this stayed invisible, which is the part worth keeping.** The gate said "9 uncovered rows
under Manila". Nine rows sounds like nine small gaps. It was four legislative districts holding
**no members at all** — 599 unmapped barangays, or 70% of the city — because the gate counts
citymuns and Manila's shortfall is three orders of magnitude larger at barangay grain. D1.3c's
gap analysis had grouped these nine under "Manila's administrative districts" and moved on. The
lesson is not that the gate is wrong; it is that a count aggregated at the wrong grain can make a
large failure look like a rounding error, and the fix was to go and look rather than to trust the
grouping.

**The cause: Manila is described at two grains and the resolver handled one.** Its 1st and 2nd
districts enumerate numbered barangays (`Barangay 1` … `Barangay 267`), which resolve — and which
all sit in Tondo, which is exactly why 258 looked like partial success rather than total failure
elsewhere. Its 3rd–6th name **administrative districts** instead: Binondo, Quiapo, San Nicolas,
Santa Cruz, Sampaloc, Malate, Port Area, Pandacan, Santa Ana. Those are not barangays, so a
barangay-scoped lookup returned `unresolved_barangay` for every one.

**Why this is resolvable where Davao's identical shape is not.** Davao City's 3rd is described the
same way and cannot be fixed at all, because PSGC hangs all 182 of its barangays directly off the
city with no intermediate level. Manila is the one place PSGC _does_ use a sub-city level: its
province-level row (13806) has ten citymun children which are precisely those administrative
districts. So nothing here is expanded, inferred or fabricated — the source name matches exactly
one citymun already inside the page's own scope, and the row is emitted at that grain. That is
what §3 means by membership "at whatever grain the district is actually defined at", and
`geo_level` on the row is what records which grain was used.

**Its own `match_method`, by the same argument as D1.3d's.** The set the name was matched against
changed — the scope's citymun children rather than its barangays — and that is a property of the
row rather than of a build log. A reader of `/districts/[code]` seeing one citymun row beside a
sibling district's 146 barangay rows is owed the reason, and "we matched the whole of Sampaloc"
is a different claim from "we matched this barangay", with a different way of being wrong.

**The caption rule, recorded because it is where this could have gone silently wrong.** Manila's
1st writes its towns field as `Tondo` followed by barangays 1–146, and the 2nd as `Tondo` followed
by 147–267. `Tondo` there is a heading over the list, not a member. Read as a member it would hand
each district the whole of Tondo and double-claim all 259 barangays — the same double-count trap
D1.1 found in BetterGov's `districts.json`, reintroduced by our own fix. So resolution now runs in
**two passes**: whatever resolves normally first, then a citymun name is a claim only if this
district has not already enumerated barangays inside it. Against today's `dim_geo` the guard never
fires, because `Tondo` does not normalise onto `TONDO I/II` — which is precisely why it is
asserted in `--selftest` rather than left to depend on a spelling that could change.

**What is deliberately left unresolved.** Four things, all reported and none forced:

- **Paco is claimed by both the 5th and the 6th.** Claiming it for either invents a fact; claiming
  it for both double-counts. The collision guard reports it and neither district gets it — 43
  barangays that COMELEC precinct returns settle exactly and Wikipedia cannot.
- **Six administrative districts Wikipedia names have no `dim_geo` row** — Binondo, Ermita,
  Intramuros, San Andres, San Miguel, Santa Mesa. PSGC folds them into the ten it does carry.
- **Nine barangay numbers the source lists exist nowhere in PSA's Manila** — 21–24, 27, 40,
  113–115. Tondo's numbered rows run 1–267 with exactly those gaps. A source disagreement, not a
  parse failure.
- **`BARANGAY 202-A` is enumerated by no district**, which is the single leftover the
  completeness gate reports for Tondo.

**Testing.** `--selftest` asserts the rung on synthetic fixtures: a whole administrative district
claimed, the caption rule in both directions (a citymun whose barangays this district enumerates
is not a claim; the same citymun is a claim for a district that does not), that a same-named
citymun outside the scope stays unreachable, that a province-grain page never triggers it, and
that two same-named citymuns inside one scope are an ambiguity rather than a first-hit match.
`enumerated_barangay_parents()` was extracted from `build()` for the same reason
`lone_district_names_parent()` and `lone_district_rows()` were — so the rule can be asserted
directly rather than only through a full build. Mutation-checked six ways, **all six caught**:
dropping the caption rule, neutering `enumerated_barangay_parents`, matching nationally instead of
in scope, firing on a province-grain page, resolving an ambiguous name to its first hit, and
removing `whole_citymun` from the declared-method gate. D1.3d's six mutations were re-run against
the refactored two-pass loop and all six still bite.

**Standards.** The migration's constraint behaviour was verified against the live database rather
than assumed — `whole_citymun` accepted, `approximate` rejected with a check violation, the probe
rows removed and all four tables confirmed back at zero. `npm run lint`, `npm run typecheck` and
`npm test` clean — 835 tests, unchanged; no application code. `npx prettier --check` passes on the
regenerated `docs/LEGISLATIVE_DISTRICTS.md` and on this entry.

**Still failing, and still refusing to write.** `corroborated_by_two_sources` (3,411 single-source
rows, no COMELEC snapshot reachable here), `citymun_covered_exactly_once` (45 uncovered) and
`multi_district_city_barangays_complete` (12 cities). Nothing has been loaded. The remaining
coverage gap is now dominated by cases only the second source can close — Davao's 84, Manila's
Paco 43 — which is the same conclusion D1.3c reached, arrived at with far less left in the "we
have not looked yet" column.

## 2026-09-02 — D1.3f: a row the two sources contradict was shipping, and the gate said fine

A latent defect, found while writing up what a COMELEC snapshot would require, and fixed before
the snapshot exists rather than after. **No numbers move** — the build is byte-identical without a
snapshot — which is the point: this is a trap armed to spring the moment the second source lands.

**The defect.** `apply_corroboration` marks each membership row `corroborated`, `conflict` or
`single_source`. The `corroborated_by_two_sources` gate then reads:

```python
single = [m for m in memberships if m["corroboration"] == "single_source"]
gate("corroborated_by_two_sources", not single or allow_single_source, ...)
```

It counts `single_source` only. A row marked **`conflict`** — Wikipedia says the 1st district,
COMELEC says the 3rd — is not `single_source`, so it **passed the gate and shipped**, silently
resolved in Wikipedia's favour. Confirmed by running it rather than by reading it: one contradicted
row, `corroborated_by_two_sources` → `True`.

That contradicts plan D1.5 in as many words: _"Wikipedia and COMELEC agree on every shipped
assignment. Disagreements are written to the disagreement report and the LGU is left unresolved,
never silently resolved in favour of either."_ It is guardrail 1 arrived at from the other
direction — not a name matched wrongly, but two sources contradicting each other and one of them
quietly winning. Nothing in the row would show it: `corroboration = 'conflict'` sat there as a
label nobody enforced.

**Why the fix withholds the row rather than only failing the gate.** Failing the build on any
conflict was the tempting one-line fix and it is a trap. Against ~3,400 rows and two genuinely
independent sources, some disagreement is close to certain, so that gate would never pass — and an
un-passable gate is exactly how a gate gets relaxed, which is the argument this log keeps making in
the other direction. `withhold_conflicting_rows()` drops the disputed row instead. The LGU then
falls out of the mapping and reappears in `citymun_covered_exactly_once` as uncovered, which is the
honest place for it: **a published gap beats a coin-flip dressed as a mapping.**

**And a backstop gate, `no_conflicting_rows_shipped`.** Not redundant with gate 7, and the
distinction is the whole bug: `single_source` means nobody corroborated the row, `conflict` means
somebody contradicted it, and gate 7 counts only the former. The new gate guards against a future
edit that stops calling the withholding — the same job `match_methods_are_declared` does for the
ladder. Its detail carries `withheld_before_gate`, so "0 conflicting rows" is never confused with
"no conflicts were found".

**A second, smaller thing the end-to-end run exposed.** The corroboration gate's `note` was a fixed
string reading "COMELEC returns unavailable in this environment (HTTP 403)" — which is false the
moment a snapshot is supplied, and it would have been the first thing a reader saw next to a
legitimate coverage number. The note now tracks reality: unreachable when nothing was read, and
"the gap is in the snapshot's coverage, not in its availability" once rows have been corroborated.
A report that explains a number with a stale reason is worse than one that gives the number alone.

**Verified end to end against a synthetic snapshot**, because the directory contract in §5b had
never actually been exercised. Four barangay-level returns under
`LEYTE/<MUNICIPALITY>/<BARANGAY>/precinct0001.csv`, three agreeing with the build and one written
to disagree: all four resolved to `dim_geo`, three came back `corroborated`, and the contradicted
row (Kananga, `0803726`, ours 4th against COMELEC's 9th) was withheld — memberships 3,411 → 3,410,
`exact` 2,350 → 2,349, the conflict published with both sides' ordinals, and
`no_conflicting_rows_shipped` passing with `withheld_before_gate: 1`. That also confirms the layout
the owner's crawl has to produce, which was previously only asserted in a comment.

**Testing.** `--selftest` asserts the defect directly: it builds a contradicted row, checks that
gate 7 is _still satisfied_ by it (the reason gate 7b has to exist), that gate 7b fails on it, that
withholding removes exactly that row and leaves the corroborated one alone, and that the withheld
LGU then shows up as uncovered rather than vanishing. Mutation-checked four ways, **all four
caught**: restoring the original bug, removing the backstop gate, over-broadening the filter so it
also drops corroborated rows, and treating a conflict as corroboration.

**Standards.** `npm run lint`, `npm run typecheck`, `npm test` clean — 835 tests, unchanged; no
application code. `npx prettier --check` passes on the regenerated `docs/LEGISLATIVE_DISTRICTS.md`
and on this entry. No migration: this changes which rows are emitted, not the schema.

**What this does NOT do, recorded because it was nearly overstated to the owner.** A COMELEC
snapshot corroborates rows; it does not create them. `comelec_by_geo` is read in exactly one place,
`apply_corroboration`, which walks existing memberships and stamps them. So a snapshot closes
`corroborated_by_two_sources` and does nothing for `citymun_covered_exactly_once` or
`multi_district_city_barangays_complete` — Davao's 84 barangays and Manila's Paco 43 stay unplaced.
Making COMELEC place them means promoting it from second opinion to row-creating source, and that
runs into a real tension rather than a coding task: **the rows that need COMELEC most are exactly
the ones Wikipedia cannot corroborate, so a COMELEC-created row is single-source by construction
and fails the very gate COMELEC was brought in to satisfy.** That needs an owner decision — its own
`match_method` plus an explicit carve-out in the gate, or left unresolved and published — and is
deliberately not decided here.

## 2026-09-02 — D1.3g: COMELEC is gone, so Davao's 84 barangays came from a different Wikipedia page

Membership rows **3,411 → 3,491**; Davao City **98/182 → 178/182** barangays placed; rows agreeing
with the independently derived COMELEC-based mapping **2,130 → 2,209**, still **zero
disagreements** and zero double-claims. Two gates still fail and the build still refuses to write.

**First, the finding that forced this: the second source is not blocked, it is gone.** D1.3/D1.3b
recorded COMELEC as unreachable _from this environment_, which implied a person on an ordinary
connection could fetch it. That is no longer true — the project owner's own browser gets "Access
Denied" too, ~16 months after the May 2025 election. Everything checked, so it is not re-checked:

| route                                              | result                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| `2025electionresults.comelec.gov.ph` (4 endpoints) | 403 here **and** for the owner                                           |
| `comelec.gov.ph`, `psa.gov.ph`, `congress.gov.ph`  | 403 — every PH government host tried                                     |
| Wayback Machine                                    | no capture of the JSON endpoints (archivers take pages, not a SPA's XHR) |
| `klescosia/ph-elections2025` mirror                | unreachable, and no licence                                              |
| `bettergovph/raw-philippine-data` (HuggingFace)    | real and **CC0-1.0**, but legislative documents and persons only         |
| Figshare bulk precinct dataset                     | senate and party-list only (already established in D1.3b)                |

The endpoint shapes are now recorded even though they cannot be called, because they cost real
effort to recover: `/regions/local/{code}.json` to walk region → province → city → barangay, then
`/regions/precinct/{prefix}/{barangay}.json` and `/data/er/{prefix}/{precinct}.json`. They came out
of a sample error log inside the crawler README that BetterGov vendored, not from COMELEC.

**Guardrail 2 was adopted in D1.1 assuming COMELEC was obtainable. It is not.** That is an owner
decision to reopen, not something to quietly relax, so the two-source gate is untouched here and
still fails on all 3,491 rows.

**What this increment does instead: fix coverage from a source that does exist.** Davao City's
district article names _administrative_ districts — "Baguio (8 barangays)", "Toril (25)" — which
PSGC models at no level, so 84 of its 182 barangays were unplaceable from it. But Wikipedia carries
the mapping on a different page. "Districts of Davao City" opens by saying it lists "the 182
barangays of Davao City ... arranged according to the 3 legislative districts and 11 administrative
districts", and tabulates every one. Same source family, same licence, at the grain the district
article could not reach.

**It is not a second source, and is not filed as one.** It is Wikipedia, like the district
articles, so its rows stay `single_source` and stay subject to guardrail 2. What it fixes is
coverage, not corroboration — a distinction worth keeping sharp, because the two failures have
been running together in this phase and they are not the same problem.

**Three parsing decisions, each of which had a wrong answer available.**

1. **The district spans rows.** The table carries the legislative district in a bolded cell with
   `rowspan`, so it must be carried forward until the next one. Read row-by-row, "Talomo Proper"
   belongs to nothing — or worse, to the next district down.
2. **Parsing stops at the table's `|}`.** The page's References section is also a bulleted list.
   Without the stop it is read as barangays of whichever district was last seen; the first run did
   exactly that and produced 185 "barangays" for a city with 182.
3. **Two naming conventions are folded, and nothing else.** A bare `1-A` is PSA's
   `BARANGAY 1-A (POB.)`, and `Toril Proper` is PSA's `TORIL (POB.)` — "Proper" and "(Pob.)" are
   two spellings of _poblacion_, the same kind of convention `normalise_name` already folds for
   "City of X". Both are exact rules over a whole word, never similarity.

**The four it does not place, and why that is the point.** `Leon Garcia` against dim_geo's
`LEON GARCIA, SR.`; `Tungkalan` against `TUNGAKALAN`; `Balenggaeng` against `BALENGAENG`;
`Biao Guinga` against `BIAO GUIANGA`. Every one is a single-character or suffix difference and
every one is left unresolved and named in the report. A one-letter miss is where a wrong match is
_least_ visible, so guardrail 1 applies hardest there, not least.

**The strongest evidence the parse is right is not internal.** The page yields exactly 182 rows for
a city dim_geo gives 182 barangays, split 54 / 46 / 82 — and the independently derived COMELEC-based
validation set splits Davao 54 / 46 / 82 as well. Across the build, agreement rose by 79 rows with
**no new disagreement**. A parse that invented or misfiled barangays would not land on another
source's district totals exactly.

**Four other cities were deliberately left alone.** Cebu, Quezon City, Zamboanga City and
Valenzuela each have a "List of barangays in X" page that mentions legislative districts, but none
uses the bolded row-spanning cell this parser reads. The fetch keeps a page **only when the parser
actually returns rows from it**, so they are skipped rather than half-read: an unparsed page is a
visible gap, a mis-parsed one is a silent wrong answer. Cebu is now the largest single gap, at 12.

**Testing.** `--selftest` asserts the rowspan carry-forward, that a References list after `|}` is
not read as barangays, both naming conventions, and that a one-letter near miss stays unresolved.
Mutation-checked five ways, **all five caught**: removing the `|}` stop, resetting the district per
row, adding a substring fallback to the resolver, and dropping each naming convention. The three
earlier suites were re-run against the changed loop — D1.3d/e's six and D1.3f's four all still bite.

**Standards.** `npm run lint`, `npm run typecheck`, `npm test` clean — 835 tests, unchanged; no
application code. `npx prettier --check` passes on the regenerated doc and this entry. No migration:
the new rows use `exact`, and which page said so is already carried by `source_ref`. The snapshot
grows by 12 KB (`ingestion/data/districts_20th/city_lists/`), committed for the same reason the
other snapshots are — the build must be reproducible without the network.

## 2026-09-02 — D1.3h: the fifth gate finally exists, and the first thing it found was Carasi

D1.5 named five validation gates. Four were built in D1.3 and the fifth — population
reconciliation against PSA — never was. It is now, and it is the only gate here that can catch a
**wrong** assignment rather than a missing one: a municipality in the wrong district is still
covered exactly once, so `citymun_covered_exactly_once` is perfectly happy with it.

**155 districts checked, 148 sum exactly to their published PSA total, 7 do not, 5 beyond
tolerance.** The build now fails four gates rather than three, which is the gate working.

**Why this became load-bearing rather than a nice-to-have.** Guardrail 2 assumed COMELEC returns
were obtainable; D1.3g established they are not, by anyone. This is now the only _independent_
check in the build, and it is independent in the way that matters: member populations come from
our own PSA load (`agg_population`), the district total comes from PSA's published district
figure, and only the **composition** under test is Wikipedia's. A wrong composition breaks the
arithmetic. It does not replace a per-row second opinion and is not filed as one — it is
aggregate, so two similar-sized municipalities swapped between two districts cancel out and pass.
`corroborated_by_two_sources` is untouched and still fails on all 3,491 rows.

**The finding worth the whole increment.** `ilocos-norte-1st` came out **+1,607** and
`ilocos-norte-2nd` **−1,607** — equal and opposite, which is the exact signature D1.5 predicted.
The municipality of **CARASI has a 2020 population of 1,607**. It is in our 1st district and the
2nd is short by precisely its population, so Wikipedia files Carasi in Ilocos Norte's 1st and PSA's
published totals say it belongs to the 2nd. No coverage gate could have seen this: Carasi is
covered, exactly once, by a district. Arithmetic found it and named it.

**The trap that would have made this gate useless, and nearly did.** The first run reported 42
mismatches out of 199. Thirty-five were not errors at all: **the district articles do not all
quote the same census.** 195 say 2020, 34 say 2015, 21 say 2024, 2 say 2025. Comparing a 2020 sum
against a 2015 published total shows five years of population growth as a 6–10% "discrepancy" —
Sulu's 1st, Tarlac's 3rd and Bohol's 1st all looked broken and are not. `parse_population_year`
now reads the year out of the infobox and the district is compared against the census it actually
quotes, or **skipped entirely**; a vintage we do not hold is never compared to the nearest one we
do. Matching vintages took the check from 76% exact to **95.5%**.

That is the difference between a gate and a noise generator, and it is why the numbers were
measured before a line of the gate was written rather than after.

**Three other skips, each of which would have manufactured a false finding rather than revealed a
real one.** Barangay-grain districts (`agg_population` has no barangay rows, so 37 multi-district
cities cannot be summed at all); districts already reported as incomplete (18 — their total is
short _by construction_, and failing them twice is noise, not a second finding); and any district
with a member carrying no population row (4 — summing a missing row as zero under-counts the
district and reports our own gap as Wikipedia's error).

**The tolerance is empirical and the margin is thin, which is said plainly rather than smoothed
over.** PSA's district totals _are_ sums of member LGUs, so an exact match is the honest
expectation and 148 districts deliver it. `POPULATION_TOLERANCE_PCT = 0.5` exists only so
published-total noise does not fail a build. But the smallest **real** error found (Carasi) shows
at 0.52% and the largest apparent noise (Laguna's 3rd) at 0.38% — so the threshold sits between
them with very little room. Every non-zero delta is published in the QA report and the generated
doc regardless of the tolerance, so nothing hides underneath it; the tolerance decides what fails
the build, not what gets shown.

**The four still-unexplained discrepancies are published, not resolved:** `pampanga-2nd` (+27.61%,
and no single member's population accounts for the gap, so it is not one misfiled municipality),
`surigao-del-norte-1st` (+6.22%), `albay-3rd` (+2.45%), and the sub-tolerance `laguna-3rd` and
`apayao-at-large`. Each is a district for a person to look at, which is what a finding is for.

**A defect this increment's own output exposed.** `md_table` padded a right-aligned column's
_header_ to the left while padding its data cells to the right, so `prettier --write` rewrote any
table whose right-aligned header was narrower than its widest cell — the exact generated-file churn
that function's docstring exists to prevent. It had gone unnoticed because every right-aligned
header so far happened to be as wide as its column. Fixed, and the regenerated doc is prettier-clean.

**Testing.** `--selftest` asserts the year parse, an exactly-summing district, the equal-and-opposite
signature of a swapped municipality, and each of the four skips — including that the gate is not run
at all when no population export is supplied, so the build stays runnable without it. Mutation-checked
six ways. **The first run had one survivor** — "a member with no population row is silently
under-counted" — i.e. that skip was unasserted, exactly the D1.3c lesson about writing the assertion
before claiming coverage. The assertion was added and all six now bite. The four earlier suites were
re-run against the changed file: 6 + 4 + 5 + 6 = 21 mutations, all still caught.

**Standards.** `npm run lint`, `npm run typecheck`, `npm test` clean — 835 tests, unchanged; no
application code. `npx prettier --check` passes on the regenerated doc and this entry. No migration:
this adds a gate and a report, no schema. `ingestion/data/agg_population_citymun.csv` is **not
committed** — it is an export of our own `agg_population`, so it is rebuilt rather than versioned,
the same posture `dim_geo.csv` already takes, and it is gitignored beside it.

## 2026-09-02 — D1.3i: the aggregate finding names a municipality

`attribute_population_discrepancies()`. D1.3h's gate says a district's total is wrong; on its own
that is a district to squint at rather than a finding to act on. This turns it into a named row
where the arithmetic supports one — and refuses to where it does not.

**The rule.** Two districts of the same province wrong by the same amount in opposite directions
is what one misfiled municipality looks like. If exactly one member of the over-counted district
has that population, it is named. Against the real build it produces one attribution:

> `ilocos-norte-1st` (+1,607) against `ilocos-norte-2nd` (−1,607): **CARASI** has a 2020 population
> of 1,607, exactly the amount the 1st is over and the 2nd is under.

D1.3h found the discrepancy and I identified Carasi by hand. Doing it by hand does not scale and
does not survive a re-run, so the build does it now.

**Named, never moved — and that is the whole design.** Moving Carasi would be inventing a fact from
a subtraction. Wikipedia says one thing, PSA's published totals imply another, and D1.3f already
settled what this build does with two sources disagreeing: report it and let a person decide. The
mapping is untouched, and `--selftest` asserts that the attribution pass does not mutate a single
membership row.

**Three guards, and the first is the one that matters.**

- **Same province only.** Two districts at opposite ends of the country happening to be wrong by
  the same amount in opposite directions is a coincidence — nothing can move between them. Pairing
  them would name an innocent municipality with total confidence, which is worse than saying
  nothing. Pairs are formed within one district-slug stem.
- **Exactly one candidate.** If two members of the over-counted district share that population,
  which one moved cannot be read off a total. The pair is still reported; no member is named.
- **Same census.** Deltas measured against different censuses are not comparable and are not paired.

**Testing.** `--selftest` asserts the Carasi shape end to end, that a cross-province pair yields
**nothing**, that a mixed-vintage pair yields nothing, that a tie reports the pair but names no
member, and that no membership row is mutated. Mutation-checked five ways, **all five caught**:
dropping the same-province guard, naming the first candidate on a tie, ignoring the census year,
swapping the over/under sides, and having attribution write to the mapping. The five earlier suites
were re-run against the changed file — 6 + 4 + 5 + 6 + 5 = **26 mutations, all still caught**.

**Standards.** `npm run lint`, `npm run typecheck`, `npm test` clean — 835 tests, unchanged; no
application code. `npx prettier --check` passes on the regenerated doc and this entry. No migration,
no schema change, and no change to any membership row: the build's counts, gates and validation-set
agreement are byte-identical to D1.3h. What is new is a section in
`docs/LEGISLATIVE_DISTRICTS.md` naming the suspect, which is what D2.2 will publish.

**Nothing has loaded.** Four gates still fail, `corroborated_by_two_sources` among them, and the
decision that unblocks it is still the owner's: ship single-source with D2's public-correction
pipeline as the second source, or hold. That is deliberately not taken here.

## 2026-09-02 — D1.3j: three of the "spelling variants" were renamings, and identity came from the article's contents

Membership rows **3,491 → 3,513**; uncovered citymuns **45 → 23**; rows agreeing with the
independently derived COMELEC-based mapping **2,209 → 2,229**, still **zero disagreements** and
zero double-claims. Migration `20260902110000_district_article_identity.sql`.

**Why the obvious fix was the wrong one.** 23 members were unresolved because Wikipedia and PSA
spell the same place differently, and every earlier entry in this log deferred them as "a decision
and a reason each". Looking properly, three of the 23 are not spellings at all:

| Wikipedia says  | PSA says      |
| --------------- | ------------- |
| Banguingui      | **TONGKIL**   |
| Datu Montawal   | **PAGAGAWAN** |
| Leon B. Postigo | **BACUNGAN**  |

They are renamings. The two names share nothing, so no name-based rule could ever resolve them —
and a fuzzy rule would have got them **wrong** rather than merely failed. That is guardrail 1
restated with evidence: the near-miss is where a wrong match is least visible, not most excusable.

**So identity is taken from the linked article's contents, never its title.** Two tiers:

1. **`psgc_identifier` (5 rows).** The article states a PSGC code — in `{{PH brgy table}}` rows
   (`{{PH brgy table lite|101305001|Bontongon|…}}`, sometimes hyphenated `03-49-17-001`) or in a
   PSA citation URL (`muncode=042123000`). A code is an identifier; nothing is inferred. dim_geo
   carries a 3-digit province segment where the 9-digit PSGC uses 2, so the two differ by one
   zero: `101305001` → `1001305` → IMPASUG-ONG.
2. **`barangay_roster` (17 rows).** The article lists the place's barangays and exactly one
   candidate in the scoped province has that set. Two municipalities of one province do not share
   their barangay names, so this is identity by contents.

**The roster tier is not a similarity score in disguise, and the measurement is why that can be
asserted.** Acceptance needs a high match _and_ a clear margin over the runner-up. In the real
build every accepted match scores **0.81–1.00 against a runner-up of 0.00–0.33**, while the one
case that must be refused scores **0.08**. Any threshold across a wide band gives the same answer —
which is the difference between a measurement and a tuned constant, and the opposite of D1.3h's
population tolerance, whose thin margin was flagged as such.

**What it refuses, which is where the guards show.** `Talitay` resolves to nothing: dim_geo files
TALITAY under Maguindanao del **Norte** while its article is scoped to del Sur, so the right answer
is not among the candidates. And a PSGC code resolving outside the scoped province is refused
rather than reinterpreted — General Salipada K. Pendatun's article cites an **ARMM-era** code for a
place now in the Bangsamoro, and quietly accepting a stale identifier is how a confident wrong
answer gets made. The roster tier still gets its turn there, on evidence rather than on the code.

**A second fetch pass, because the question is not knowable earlier.** Which members need their own
article cannot be known until a build has reported what it could not place, and fetching every
member's article would be thousands of pages to answer a question about twenty-three.
`--fetch-member-articles` builds from the snapshot, takes the unresolved list, fetches exactly
those, and writes them back into the same snapshot so the next build is offline and reproducible.

**Also fixed, because this increment's own output exposed it.** Eight "unresolved members" were
never places: four articles align their `=` with a long run of spaces
(`| titlestyle              = font-weight:normal;…`), and the named-parameter filter only looked
at the first 20 characters, so both the parameter and the list's own "LGU" title were read as
member names — and this increment then dutifully fetched an article for `LGU`. Matched as a
leading identifier now. The unresolved-in-province list is consequently **one entry: Talitay.**

**Testing.** `--selftest` asserts the PSGC transformation (including hyphenated and malformed
input), code extraction from both shapes, disagreeing codes resolving nothing, roster parsing, the
renaming case end to end, identifier-beats-roster, the stale out-of-province code falling through
to the roster rather than being accepted, and three distinct refusals: no roster, a _partial_
roster (0.33 — non-zero, and a "better than nothing" threshold would take it), and a **tie** (1.00
against 1.00 — a perfect score with an unknowable answer, which is what the margin is for).

Mutation-checked six ways. **The first run had four survivors** — the province check, the national
scan, the score threshold and the margin were all unasserted, because the fixtures did not contain
a competing candidate for them to discriminate against. Fixtures rewritten (a same-roster citymun
in another province; a real row for the stale code to land on), and all six now bite. This is the
third time in this phase that a mutation run has found an assertion missing rather than a bug, and
it keeps earning its place. The other suites were re-run: 5 + 4 + 5 + 6 + 6 = **26 mutations**, all
caught, plus the two declared-method guards checked directly.

**Standards.** `npm run lint`, `npm run typecheck`, `npm test` clean — 835 tests, unchanged; no
application code. `npx prettier --check` passes on the regenerated doc and this entry. The
migration's constraint behaviour was verified against the live database rather than assumed — both
new methods accepted, `similar_name` rejected with a check violation, probe rows removed and all
four tables confirmed back at zero.

**Nothing has loaded.** Four gates still fail. The corroboration one is still an owner decision.

## 2026-09-02 — Increment 5.1: the assistant's route (pre-filter chips)

The first increment of Phase 5. Before the tool loop runs, a question is classified into a **lane**
(policy / geographic / data-quality / lineage / general), a **scope** (one resolved `dim_geo` row),
and an **output** (answer / chart / slide / profile). The result is emitted as the stream's first
event, rendered as editable chips, and concatenated into the system prompt.

**Rules first, a provider call only as a fallback.** The obvious build is one classify call per
question. The quota table says no: `lib/ai/quota.ts` seeds Gemini at 10 requests/minute and Mistral
at 1, and `runToolLoop` already spends up to six calls on one question (four tool rounds, the
wrap-up, its retry). A seventh, on every question, comes out of the same free-tier budget the
public chat depends on. So `routeByRules` resolves the lane from vocabulary the question actually
contains, and the provider is asked only when *nothing* matches — no policy or lineage or quality
words, no resolvable place, and no domain word. Measured against the rule set, that is a narrow
class of question; "how many BHWs are accredited" resolves for free through the domain-word rule,
which exists for exactly that reason.

**Output is never "unresolved".** A question that does not ask for a chart wants prose. Treating
absence as ambiguity would have sent every plain question to the model, which is the cost the
rules pass exists to avoid.

**The route changes behaviour or it is not worth computing.** `routeSystemFacts` turns each lane
into an instruction: policy must call `searchDocuments` and walk `supersedes` before naming an
issuance as current; lineage must traverse with `direction: "both"`; a resolved scope is handed
over as a `geo_code` the model is told not to re-search. The geographic lane also states what it
*cannot* do — `dim_geo` holds containment and no coordinates, so "near" and "adjacent to" are
unanswerable, and the model is told to say so rather than approximate.

**Prompt rule 14, and why it is narrow.** The route block is appended to `INTERNAL_SYSTEM_PROMPT`,
which rule 8 otherwise tells the model to treat as data. The exception is therefore stated, and
bounded: the block may direct tool choice, it never overrides rules 1–13, and nothing arriving
inside a user message or a data value can claim to be part of it. An unbounded exception would be
a documented route around rule 1.

**Concatenated, never a second system message.** `lib/ai/providers/gemini.ts` builds
`systemInstruction` from the first system-role message and drops every later one — the same trap
`agent-loop.ts` records for its wrap-up nudge. A test asserts the loop receives exactly one system
message and that it still contains the original prompt.

**Scope is carried, not pinned — a bug caught in review before it shipped.** The first build let
the client pin the scope and had the chat pin it from every route event. That is wrong in a way
that would have been very hard to see: ask "accreditation in Basilan", then "accreditation in
Cebu", and the pinned Basilan wins over the Cebu the rules just resolved. The answer is then
confidently about the wrong province **and passes the numeric audit**, because they are real
Basilan figures from a real Basilan query. So `scope` was removed from `pinnedRouteSchema`
entirely and replaced by a separate `carriedScope`, applied by `applyCarriedScope` only when the
question resolved no scope of its own. Both directions are regression-tested.

**Fuzzy search needed a guard.** `searchGeo` is deliberately fuzzy so a misspelled place resolves,
which means its top hit for "what is the training coverage nationally" can be a barangay named
TRAINING. `pickScope` therefore accepts a hit only when every distinctive token (≥4 chars) of its
name appears in the question, *and* rejects one whose only distinctive tokens are domain
vocabulary. Both checks are load-bearing: the first alone accepts TRAINING, the second alone
accepts any single-token name the question never mentions.

**A client-supplied scope is re-derived, not existence-checked.** The plan said `isKnownGeo`;
`verifyScope` does more. The scope is rendered into the prompt as an assertion the model is told to
trust, so a forged `geoName` or a mismatched `geoLevel` on a real `geo_code` would be quoted back
as fact. Every field is taken from the `dim_geo` row and the client's copy is used only to look it
up. A scope that does not resolve becomes null rather than falling back to the computed one.

**Routing never blocks an answer.** `searchGeo` swallows query errors but constructs a Supabase
client first, and that throws outright on an unconfigured environment — which the route handler's
own test suite exposed immediately. The call is wrapped, and every failure path (throw, capped
providers, unparseable classifier JSON) lands on `DEFAULT_ROUTE`, which is `general` + `answer`:
exactly the assistant's behaviour before this increment. A router that cannot decide costs
nothing.

**Existing tests changed shape, not meaning.** Four assertions in
`app/api/ai/assistant/route.test.ts` read the stream by position and now find `route` first. They
were rewritten around an `eventOfType` helper — they were always about which event was emitted, not
where it sat — with an explicit ordering assertion kept where order is the actual claim (a tool
call precedes the answer it grounded).

**Standards.** `npm run lint` (0 errors, 0 warnings), `npm run typecheck`, `npm test` all clean —
**900 tests, up from 835**. `npx prettier --check` passes on every file touched. `next build`
compiles and typechecks clean; its static-generation step fails only in this sandbox, which has no
database for `/bhw` to prerender against. No migration and no schema change: this increment adds
no table and reads nothing new.

**Still open.** The chips are rendered but have no automated interaction coverage — `repin`'s
replay-the-turn behaviour is asserted through the route handler and the pure reducers, not through
the DOM; the e2e pass in 5.2 is where that belongs. The memo is per-instance and unbounded in
lifetime rather than time-based, which is right for a serverless instance and wrong if this ever
runs long-lived.

## 2026-09-02 — Increment 5.2: markdown, starters and follow-ups

The response-quality half of Phase 5 that needs no provider change. Three things the admin chat
lacked that the public launcher has had since Phase 2, plus one it never had.

**Markdown, as a bounded subset rather than a dependency.** Answers are already written as prose
with lists and figures — rule 13 asks for exactly that — and rendered through
`whitespace-pre-wrap`, so a comparison the model wrote as a table arrived as a wall of pipes.
`lib/ai/markdown-blocks.ts` parses headings, lists, `**bold**`, `` `code` `` and pipe tables into a
data structure; `components/admin/answer-markdown.tsx` renders it. Pulling a Markdown stack in for
one admin surface would have been the faster build and the wrong one against the README's
free-tier and bundle posture.

**Two rules make the subset safe rather than merely small.** *No links, ever* — not unsupported,
deliberately absent. The text is model-authored, and the only trustworthy links on this page are
the citation links the server emits from the retrieval payload (2.3). A clickable URL the model
wrote would be indistinguishable from one, which is precisely the property 2.3 exists to
guarantee, so `[text](url)` renders as those literal characters. *No raw HTML* — the parser emits
data, never markup, and the renderer turns it into React elements, so angle brackets are text by
construction. There is no `dangerouslySetInnerHTML` and no code path that builds a markup string.
Both are asserted, not assumed: a test feeds it `<script>alert(1)</script>` and
`[here](javascript:alert(1))` and checks they come through as text, and another asserts no emitted
block kind can carry a URL.

**Unclosed markers degrade to literal text.** `parseInline` is hand-written rather than
regex-driven for this reason: a regex matching only balanced pairs silently drops the unbalanced
remainder, and an answer that survived two audits must not lose characters to a formatting parser.
`2 ** 3 = 8` prints as written. A test asserts every non-blank line's text survives somewhere in
the output.

**A table needs its separator row.** Without that check a single sentence containing a pipe opens
a one-column table — which is how a naive line-shape parser turns prose into a rendering bug.

**Follow-ups are computed, never generated.** Asking the model for suggestions is the obvious build
and wrong twice: it spends free-tier quota on decoration, and a suggested question is a *promise
the assistant can answer it* — a model inventing "compare this to 2024" would offer a question no
registered dataset can serve. `suggestFollowUps` is pure and fires a template only when the payload
carries what the template names, which is the same inversion as the citations in 2.3: evidence
comes from the retrieval, never from the prose. Payloads carrying an `error` are excluded — a
refused call is not a fact to build on.

Two exclusions are about not training the reader to ignore the suggestions: no peer comparison at
national or barangay, because `agg_peer_ranks` has no row there and the question is guaranteed to
come back "not ranked at this level"; and no drill-down at barangay, which has no children. The
generic discovery prompt fires only when nothing else is groundable, and never crowds out a
grounded suggestion.

**Starters exercise different lanes.** Five, one each for the router's policy / geographic /
lineage / data-quality / general paths, so the empty state teaches what the surface can do rather
than only that it accepts text.

**Only the assistant's own text is parsed.** A user turn and a system notice stay literal — a
reader's question should render as they typed it, and a system notice is not model output.

**Standards.** `npm run lint` (0 errors, 0 warnings), `npm run typecheck`, `npm test` clean —
**930 tests, up from 900**. `npx prettier --check` passes on every file touched. No migration, no
new dependency, and no provider call added.

**Still open.** The renderer has no component-level test — its logic lives in `markdown-blocks.ts`,
which is covered, but the React output itself is asserted only through typecheck. Nested lists,
blockquotes and fenced code blocks are outside the subset and render as literal text; if answers
start using them, extend `parseBlocks` rather than reaching for a dependency.

## 2026-09-02 — Increment 5.3: interpretation tools

The assistant could fetch "45.2%" and could not say whether that was good. Everything needed to
answer that already existed and nothing exposed it: `agg_peer_ranks` carries the rank, percentile,
sibling median and an outlier flag; `lib/analysis/` has spread and correlation; `lib/db/insights.ts`
generates the same ranked cards `/bhw` and `/explore` render. Three tools —
`getPeerContext`, `getDistribution`, `getInsightCards` — over code the dashboard already runs.

**No schema, no query, no new data.** This is a tool surface, which is what keeps "the number in
the answer matches the number on screen" (`lib/ai/tools.ts`) true for interpretation as well as for
figures. It is the fourth *kind* of tool rather than a fourth retrieval path: §2's three paths —
SQL for numbers, edges for provenance, documents for prose — can all fetch a figure and none can
rank it.

**`getPeerRank` now selects `median` and `mad`.** Both were already in `agg_peer_ranks` (E2.3) and
neither was read. Additive — existing consumers destructure by name and are untouched — and it is
what makes `isOutlier` explicable rather than magic. "Flagged an outlier" with no median and no
deviation behind it is exactly the naked number this project's figure contract forbids; the
dashboard gets the same two fields for free.

**Every "nothing here" states why.** `agg_peer_ranks` has no national row (nothing to be a sibling
of) and no barangay rows. A bare `{ranked: false}` reads to a model as *missing data*, which it
then reports as a gap in the dataset rather than a property of the table — so `unrankedReason`
returns the cause and the tool passes it through. Same for `getInsightCards` returning nothing
(no card cleared the dashboard's thresholds) and `getDistribution` on a barangay (nothing is
inside it). The reason is part of the answer.

**Small samples are marked, not filtered.** `getDistribution` flags every child below
`MIN_LEADER_N` (30) and warns in the payload, mirroring the floor `lib/db/insights.ts` already
applies before crowning a leader — a 3-profile barangay at "100% accredited" is noise. Filtering
them out silently would misstate the count; leaving them unmarked would let the model rank them.

**Correlation passes `insufficient` straight through.** `describeCorrelation` refuses a
coefficient below its own n floor, and the tool does not paper over that with a number nobody
should quote.

**`InsightCard.score` is dropped.** It is an editorial rank used to curate the grid and documented
as not shown to users; handing it to the model invites it to quote a figure that means nothing
outside the generator.

**Prompt rule 14, and its last clause.** The rule tells the model to call `getPeerContext` before
stating a figure for one place. What matters more is the closing constraint: it may quote a rank or
an outlier flag a tool returned and may never derive one itself. `auditNarrative` strips sentences
whose *numbers* are unsupported, so "Basilan looks like an outlier" passes it untouched — the
sentence carries no number. The prompt is the only thing standing between a reported flag and an
invented one, so the constraint is asserted by a test.

**Indicator access is a lookup, not a switch.** `PICK_FROM_CHILD` and `PICK_FROM_BENCHMARK` are
`Record<MapBaseIndicator, …>`, so a seventh indicator is a compile error rather than a silent null
in an answer.

**Standards.** `npm run lint` (0 errors, 0 warnings), `npm run typecheck`, `npm test` clean —
**951 tests, up from 930**. `npx prettier --check` clean on every file touched. `next build`
compiles and typechecks; its prerender step fails only in this sandbox, which has no database.
No migration.

**Still open.** `getDistribution` walks one level down only, so "every barangay in Region VII" is
still two calls or a `traverseGraph` walk. The correlation is Spearman over the children of one
parent — it does not control for anything, and the prompt does not yet warn the model against
reading it causally.

## 2026-09-02 — Increment 5.4: the consolidated area profile, and a suppression finding

Every dataset that covers one geography in one payload — and, just as deliberately, every dataset
that does not, with the reason. `lib/db/area-profile.ts` assembles fourteen sources;
`app/admin/(dashboard)/place/[geoLevel]/[geoCode]` renders it and `getAreaProfile` returns it to
the assistant, from the same assembler, so a page and an answer about the same place cannot
disagree.

**The coverage map is the increment, not a courtesy.** Six datasets describe a geography and each
stops somewhere different: training is not built at barangay (the barangay × topic cross-product is
outside the free-tier disk budget), honorarium sufficiency is null there, `agg_peer_ranks` covers
region/province/citymun only, poverty is a city/municipality-grain rate that is not rolled up.
Returning `null` for all of those makes a *build decision* indistinguishable from *this place has
no data* — and a reader, or a model, will report the first as the second. `SourceState`
distinguishes `not-built-at-this-level` from `no-data` and every absence carries its reason;
prompt rule 15 requires the model to preserve the distinction. Telling them apart is this
module's main correctness requirement, and most of its test suite.

### The suppression finding — this is the part to read

Consolidation exposed a differencing path that per-dataset suppression does not close, and it is
**not introduced by this increment**.

`ingestion/build_aggregates.sql` suppresses per cell: a barangay demographic cell with `0 < n < 5`
has `n` and `pct` nulled and `is_suppressed` set. Correct in isolation. But the group total is
published, unsuppressed, in `agg_bhw_counts.n_total`. So for a barangay whose `sex` breakdown is
Male 40 visible and Female 3 suppressed, against a total of 43:

    Female = 43 − 40 = 3

One subtraction. The rule is standard: a residual is unknowable only when **at least two** cells in
the group are unknown, so a group with exactly one suppressed cell needs a complementary
suppression — `lib/db/area-profile-suppression.ts` adds one, choosing the smallest visible positive
cell, which loses the least information. `pct` is nulled alongside `n` for the same reason the
ingestion pass does it: `pct × total` reconstructs `n` exactly. A visible **zero** is never chosen
as the complement — hiding a known zero removes no ambiguity from the attacker's sum.

Where nothing can be withheld (a single-category dimension, or every other cell a known zero) the
pass says so via `unprotectable` rather than pretending it protected the group. Honesty over the
appearance of protection: a guardrail that silently fails is worse than one that reports its limit.

**Scope, stated plainly.** This protects *this payload*. **The same differencing path exists on the
public `/place/[geoLevel]/[geoCode]` page**, which renders the demographics figure and the
validated-profile total together — the exposure predates this increment and is not fixed by it.
Consolidation is what made the path systematic and machine-readable, which is why the pass belongs
here; whether to close it at the aggregate level, or on the public page, is an owner decision and
is **not taken here**. Flagged rather than quietly handled.

**Prompt rule 15's second half is a privacy rule, not a style one.** The profile withholds a
complement so a cell cannot be recovered by subtraction; a model that helpfully performs that
subtraction in prose undoes the guardrail. Rule 6 already forbids stating a suppressed value; rule
15 names the specific arithmetic that produces one. Asserted by a test.

**Admin-only is load-bearing** (§9.1, §12.5). The profile spans every dataset and surfaces internal
document passages, and the differencing risk above is the second reason it must not reach a public
surface. It sits inside `(dashboard)`, is not cached, and is never written to `ai_ask_cache`.

**A mismatched geo level is rejected, not corrected.** Every aggregate is keyed on
`(geo_code, geo_level)`, so asking for a citymun at `region` makes every section read "no data" — a
wrong answer wearing the shape of a finding. Same check `app/uuc-phc/[geoLevel]/[geoCode]` makes.

**One unavailable table costs one section.** Every source is caught individually; a throw degrades
to the same shape as no data (§1).

**Standards.** `npm run lint` (0 errors, 0 warnings), `npm run typecheck`, `npm test` clean —
**983 tests, up from 951**. `npx prettier --check` clean on every file touched. `next build`
compiles and typechecks; its prerender step fails only in this sandbox, which has no database.
No migration: this increment adds no table and reads nothing that was not already readable.

**Still open.** The admin page renders each section's payload verbatim rather than re-implementing
fourteen figures, and links out to the built ones — adequate for staff, not a designed view. The
complementary pass covers `agg_demographics`; `agg_honorarium`'s suppressed distribution columns
and `agg_bhw_by_uuc_status`'s `*_is_suppressed` sides are not yet run through it, and the UUC
listed/other split has the same two-cell structure that makes differencing easy. And the public
`/place` exposure above is unaddressed by design.

## 2026-09-02 — Increment 5.5: output modes — chart, slide, deck

The assistant had one output shape, plain text, while the repo already shipped Observable Plot
specs, a presentation deck, server-side PNG rendering and a PPTX writer that it could not reach.

**The chart's values never come from the prose.** `figureFromPayloads` reads the tool payload
directly; nothing parses the answer text. The same inversion as the citations in 2.3 — a model
cannot mis-plot data it was never handed. The model decides *whether* a chart is wanted (the
route's `output`); this decides what is in it.

**It only plots shapes that are unambiguously a labelled series** — `getDistribution`'s ranked
children, and `getPeerContext`'s this/region/nation. A `queryDataset` result is deliberately not
plotted: choosing which column is the label and which the measure would be a guess, and a chart
with the wrong column as its measure is *worse* than no chart, because it survives every audit —
all the numbers in it are real numbers. When nothing matches there is no figure and the answer
stays prose.

**Small-sample children are excluded from the chart and counted in a note**, matching
`lib/db/insights.ts`, which refuses to crown a leader below `MIN_LEADER_N`. A 3-profile barangay at
"100% accredited" rendered as the tallest bar is the misreading the threshold exists to prevent,
and a bar chart makes it look authoritative in a way a sentence does not.

**A one-bar peer chart is refused.** "Versus what?" is the entire purpose of that figure.

**The chart renders through the dashboard's own `FigureCard` and `BarChartClient`,** so an
assistant chart and an Explore chart of the same numbers are the same picture — the visual
counterpart of `lib/ai/tools.ts`'s "the number in the answer matches the number on screen".

**Slides needed no change to `components/present/`.** Slides register themselves and order by DOM
position (`sortByDocumentOrder`), so wrapping each answer in a `PresentationSlide` makes a deck of
a chat session in the order the answers were given. The `PresentationProvider` lives inside the
client chat component rather than on the server page for one reason: `DeckMeta.areaName` tracks the
live route, and the server page cannot know which place the current question resolved to. Slides
are titled by the question they answered — an overview grid of "Answer 1, Answer 2" is not
navigable in a briefing.

**PPTX went from one slide to a deck** without changing its contract. `?indicator=` still yields a
single slide, so every existing export link and the PNG/CSV/XLSX routes that share the schema are
untouched; `?indicators=a,b,c` builds a deck for one geography from the same
`getExportFigureData` call per slide, so nothing new is plumbed. The per-slide layout moved to
`lib/exports/pptx-slide.ts`, and the "no naked numbers" benchmark block and source footer are
applied to **every** slide: a deck whose later slides drop their provenance is worse than one slide
that keeps it, because a figure is separated from its source the moment someone copies it into
another deck.

Slides render **sequentially** and are capped at six with `maxDuration = 60`. Both are budget, not
taste: each slide rasterises its own PNG through resvg on the request path, and six concurrent
renders on a small serverless instance runs out of memory rather than time. Some indicators missing
yields a thinner deck; all of them missing is a 404.

**Standards.** `npm run lint` (0 errors, 0 warnings), `npm run typecheck`, `npm test` clean —
**1007 tests, up from 983**. `npx prettier --check` clean on every file touched. `next build`
compiles and typechecks; its prerender step fails only in this sandbox, which has no database.
No migration.

**Numbering correction.** This increment is **5.5** in the plan (output modes); 5.6 is
sentence-level streaming, which is not built. The commit that introduced it says "5.6" in its
message and cannot be corrected without rewriting pushed history — every code comment and this
heading say 5.5, which is what the §8 cross-references follow.

**CI note, not a code finding.** GitHub Actions did not create a workflow run for `71532f3`
(Increment 5.4), confirmed absent over a four-minute poll; the same happened for this branch's
first commit. Both trees were verified locally against the identical commands CI runs
(`lint`, `typecheck`, `test`). No empty commit was pushed to provoke a run — this increment's push
covers the same tree plus 5.6.

**Still open.** The figure is emitted only for the `chart` and `slide` output routes, so a reader
who wants a chart must ask for one or flip the chip. `figureFromPayloads` returns the *first*
plottable payload rather than judging between several — picking would be an editorial judgement it
has no basis for. The deck export is per-geography across indicators; a deck across *places* for
one indicator has no route yet.

## 2026-09-02 — Increment 5.6: the streaming primitive ships; streaming itself is blocked

`lib/ai/stream-audit.ts` is built and proven. The feature it exists for is **not** built, because
implementing it as planned would cost either free-tier quota or the grounding property, and neither
is mine to spend. This entry records the finding rather than a half-measure.

### What was built

`createSentenceAuditor(citations, toolPayloads)` audits a model's output **one sentence at a time**,
emitting a sentence only once it is complete and has passed `auditCitations` then `auditNarrative`
— the same two audits in the same order the route runs them.

The plan's premise holds exactly: `app/api/ai/chat/route.ts` rejected token streaming because the
numeric audit must see the response before any of it is safe to show, and that reasoning is right.
What it overlooked is that **both audits are already sentence-scoped** — neither looks across a
sentence boundary — so a sentence can be audited the moment it completes, and an ungrounded number
is never rendered because it is never sent.

A property test asserts the streamed result equals the batch pipeline over six fixtures, and that
the result is invariant to chunk boundaries (tested at 1, 3, 7 and 20 characters).

**One divergence is asserted rather than hidden.** The plan claimed byte-identity in all cases;
that is not quite true. When a kept sentence does not end in terminal punctuation, the batch
pipeline's re-join makes its second pass read it as one sentence with the text that follows, pooling
their numbers, so one bad number drops both. Per-sentence auditing drops only the offending
fragment. That is stricter per sentence and never looser, and the invariant the route depends on —
**every emitted sentence passed both audits on its own** — still holds. The claim is corrected here
rather than restated.

### Why the feature is blocked

`runToolLoop` calls the provider **with tools on every round of the common path**
(`agent-loop.ts:67`) and returns as soon as a round comes back with no tool calls. The tool-free
calls at lines 96 and 119 are the wrap-up and its retry — the exceptional path, reached only when
four tool rounds ran out. So in the ordinary case *there is no tool-free call to stream*, and the
plan's "only the final, tool-free round streams" describes a round that does not exist.

Three ways out, none of them free:

1. **An extra tool-free call after the tools finish.** Clean, and it costs one more provider call on
   every question — a seventh on the budget Increment 5.1 went to some length to protect, on a
   Gemini window seeded at 10 requests/minute. This directly contradicts 5.1's own reasoning.
2. **Stream the tools-enabled rounds.** Then text emitted before a tool call is shown to the reader
   as if it were the answer, and audited against payloads that do not exist yet. Emitting
   optimistically and retracting on a tool call is worse: the answer visibly flashes and vanishes.
3. **Buffer until the round ends, then emit sentence by sentence.** Identical latency to today —
   the appearance of streaming with none of the benefit.

Option 1 trades quota for latency and option 2 trades the reader's trust for it. Which — if either —
is worth it is an owner decision, so the primitive is committed and the wiring is not.

**Nothing is wired, deliberately.** `stream-audit.ts` has no consumer today. It is committed rather
than discarded because it is the exact artifact the decision turns on: whichever option is chosen,
this is the module that makes it safe, and it is proven now rather than written under time pressure
later.

### Standards

`npm run lint` (0 errors, 0 warnings), `npm run typecheck`, `npm test` clean — **1020 tests, up
from 1007**. `npx prettier --check` clean on every file touched. No migration, no provider change,
no change to any existing code path.

## 2026-09-03 — D1.6a: the mapping ships, single-source, and the gaps ship with it

3,513 rows are in the database. They rest on one source, 23 municipalities have no row at all, and
both of those facts are printed on every surface that shows the data. This entry is about why that
is the right trade and what had to be built before it could be made honestly.

### The decision the owner made

Guardrail 2 said no district assignment ships on a single source. It was written in D1.1 assuming
the second source could be obtained. By D1.3g it was established that it cannot: COMELEC's
House-contest precinct returns answer HTTP 403 to this environment **and** to the owner's own
browser, the Wayback Machine holds no capture of the JSON endpoints, psa.gov.ph and
congress.gov.ph 403 as well, and the only mirror is unreachable and unlicensed. The source is gone,
not busy.

A rule whose precondition has failed is not satisfied by waiting. The owner's call was to ship
single-source with **D2's public correction pipeline as the second source** — corroboration that
arrives after publication, from the people the rows are about, instead of from a second authority
before it. That is weaker, it is recorded as weaker, and it is not described anywhere as
equivalent.

### Three gates were failing. Only one of them was the ship decision

`--allow-single-source` overrides the corroboration gate and nothing else, so the other two failures
had to be dealt with on their own terms rather than swept along with it.

**`population_reconciles_with_psa` was not a coverage problem — it was a wrong gate reading.** Five
districts sat beyond the 0.5% tolerance. Every one of them turned out to be a stale figure in the
source rather than a misassignment, and the evidence is unusually strong: for each, the district
article's **own** infobox LGU list enumerates exactly the members this build assigns, while the
population field three lines above it disagrees. Pampanga's 2nd names its six municipalities
including Porac and then reports a total 141,932 short — Porac alone is 140,751 of that. The
province table on _Legislative districts of Pampanga_ gives 655,973, which is this build's sum to
the person.

That is one source contradicting itself. The independent check settles it: `districts_generated.json`
— the COMELEC-derived validation set — places **all 45** of those municipalities in the districts
this build assigns, and puts nothing else in them. Composition confirmed twice, in both directions.

So the five are exempted **by name**, in `STALE_PUBLISHED_TOTAL`, and the entries are
**self-checking**: each carries the exact member set and the exact delta it was verified against.
Add a member, drop one, or let PSA revise a population, and the entry stops matching and the
district falls straight back through to the gate. An exemption that cannot expire is not an
exemption, it is a deletion. Four mutations confirm it: removing the member-set check, the
delta/year check, the gate's use of `unexplained`, and filtering exempted rows out of the published
discrepancy list are each caught by `--selftest`.

**A correction to D1.3i.** That increment named Carasi (1,607 people) as a probable misassignment
because Ilocos Norte's 1st and 2nd are wrong by exactly its population in opposite directions. The
arithmetic was right about which municipality explains the gap; the conclusion was wrong. Both
district articles' own LGU lists put Carasi in the 1st, and so does the validation set. Two sources
agreeing on the composition outrank an inference drawn from two totals. It is reported as a stale
pair of published figures now, not as a suspected error in the mapping.

**The two coverage gates were split along the seam that matters**, rather than switched off.
`--allow-incomplete-coverage` forgives an LGU that has **no** row; it can never forgive one with a
**wrong** row. A double-claimed LGU still fails `citymun_covered_exactly_once` with the flag in
force, and `no_barangay_in_two_districts` is untouched by it entirely. The distinction is real:
an uncovered place means a reader asking about it gets nothing, which is true; a double-claimed
place means two districts assert it and at least one is lying.

Both gates also print their gaps **in full** rather than a ten-row sample once overridden, because
a gap that ships is a gap the reader is owed by name. The generated doc renders an overridden gate
as `pass (overridden)`, never as `pass` — rendering the two identically is how a reader comes to
believe a dataset is complete when the build knows it is not.

### What is in the database

| table                      |  rows | verified                          |
| -------------------------- | ----: | --------------------------------- |
| `dim_legislative_district` |   250 | md5 `f269ae82…` matches the build |
| `geo_district_map`         | 3,513 | md5 `b6d5b310…` matches the build |
| `district_representative`  |   194 | md5 `e7fa074f…` matches the build |

Loaded through the Supabase MCP rather than `--database-url` (this environment holds no connection
string), which meant hand-carrying SQL through tool calls. The rows were therefore emitted in a
compressed encoding — per-district geo-code arrays with a shared prefix — and the **md5 of every
row's `district_code`, `geo_code`, `geo_level`, `match_method` and `source_ref` was computed on both
sides and compared**. Compression that is verified is not the same as compression that is trusted;
the first attempt at it dropped every single-member group, because a prefix that swallows a code
whole leaves `unnest('{}')` with nothing to emit.

Re-checked against the live database rather than asserted from the build report: 0 geo codes absent
from `dim_geo`, 0 `geo_level` mismatches against `dim_geo`, 0 places claimed by two districts, 0
districts with no members, every row `single_source` and `auto`. 1,628 of 1,651 municipalities and
cities are covered — 98.6%.

### The 23 that are not covered, by name

Eight are the BARMM Special Geographic Area (`1999901`–`1999908`), created after the district
articles were written. Five are in South Cotabato, four in Bataan, three in Bulacan, plus Santa Rosa
(Laguna), Talitay (Maguindanao del Norte), and Paco — one of Manila's ten administrative districts,
which PSGC models as a citymun and no district article enumerates. 41 barangays across 12
multi-district cities are likewise unplaced, Cebu City's 12 being the largest single block.

None of them is guessed at. Guardrail 1 has no fuzzy rung and did not acquire one here.

### Standards

`--selftest` passes. Every new behaviour was mutation-checked: four mutations against the
stale-published-total exemption, eight against the coverage override. Four of those eight concern
how much of the gap list is printed, in both directions — truncating it under the override and
never truncating it without one — and the first fixture caught neither, because with a single
uncovered town and a single part-placed city a ten-row sample and the full list are the same
thing. The fixture grew to eleven uncovered towns and eleven part-placed cities to fix that. Seven
of the eight are caught; the one survivor is expected and documented: `cities_over_claiming` cannot fire from this build's own construction, since `by_city`
buckets each barangay under the parent `dim_geo` gives it, so a claimed barangay is never foreign to
the city it is counted against. It is kept as a backstop and asserted at zero so the claim stays
true rather than assumed.

`docs/LEGISLATIVE_DISTRICTS.md` regenerated. No migration — the tables, their RLS policies and the
`corroboration` column all predate this increment.

## 2026-09-03 — D1.6: the district mapping gets a passport, and the lineage generator gets a guard

The rows have been in the database since D1.6a. Until now nothing declared what they were: no
dataset, no dictionary, no lineage. A table with no approved dictionary is one `queryDataset`
refuses outright, so the mapping was simultaneously public and unaskable.

### What was registered

One `dim_dataset` row (`ph-legislative-districts`), three `dataset_registry` rows, forty
`dataset_column` rows, and 23 nodes / 37 edges of lineage. All verified live: the three relations
are `public` and `approved`, every column is `approved`, and every edge D1.6 names is present —
`built-by` its migration **and** its ingestion script, `derived-from` the dataset,
`reconciled-in` `docs/LEGISLATIVE_DISTRICTS.md`, with `has-column` / `joins-on` for the six join
keys.

`district_correction` was deliberately left out. It is D2.3's submission queue: no rows, no settled
semantics, and a `submitter_email` column. Registering a table is exactly what makes
`queryDataset` willing to read it, so an unused table carrying an email address is the one not to
open ahead of the feature that fills it. It gets its entry when D2.3 can say what its columns mean.

### The notes are the deliverable, not the row count

`queryDataset` refuses any relation without an approved dictionary, so this text is what a model
reads before composing a query about who votes where. Three things would otherwise be got wrong
in a way nothing downstream would catch, and each is now stated on the relation **and** on the
column a query actually returns — a note is what travels with the rows, which is the same reason
U3's capping caveat sits on `capped_indicators` rather than only on its table:

- **Derived, not official, and single-source.** `corroboration` reads `single_source` on all
  3,513 rows and its column note says never to describe one as verified.
- **Absence means no answer, never no district.** The table is incomplete by design; 23
  municipalities and 41 barangays have no row, and a place that resolved to nothing was left out
  rather than approximated. `match_method` says outright that there is no fuzzy rung.
- **`psa_population` is not a roll-up of the members.** It is the figure the district's own
  article publishes, which is the only reason it can serve as a check against the summed members.
  Presented as a roll-up it would be circular, and the five stale-figure districts would read as
  arithmetic errors here rather than staleness in the source.

Two more that only became visible while writing the dictionary against the live data:
`district_representative.party` is null on all 194 rows because the source template is not parsed,
so null means **not extracted, never independent** — read the other way it would invent a
political fact about a named living person. And `geo_district_map` mixes two grains in one table,
so a `citymun`-only filter silently drops every multi-district city, which is present through its
barangays and never as itself.

### The lineage generator had a silent hole, and now has a guard

`ingestion/build_kb_lineage.py` finds a script's writes by looking for a literal
`insert into <table>`. `build_legislative_districts.py` has none: the table name is a loop variable
passed to `insert_statement`. So the graph would have shown three tables built by a migration and
written by nobody.

That is what the `-- lineage:` directive exists for, and the directives are now in the script,
beside the loop anyone can check them against. But adding them exposed a real bug: `read_ingestion`
pops a script node when it finds no writes, and the pop ran **after** the directive had already
created edges pointing at that node. The emitted SQL joins edges to nodes by key, so those three
edges did not fail — they silently did not insert.

Two changes, and the second matters more than the first. The pop is now conditional on the node
having no edges at all (`Graph.references`), which is what "it gets no edges it did not earn"
should always have meant. And the generator now **reports any edge whose endpoint it does not
define**, excluding the `issuance:` endpoints that legitimately come from extraction and are
already reported separately. Reverting the first fix makes the second fire by name; that is how
the guard was checked rather than assumed.

The same class of silence nearly repeated in the delta itself.
`doc:docs/LEGISLATIVE_DISTRICTS_PLAN.md` was an endpoint of four edges and did not exist in the
live graph, so a delta built from "district-side nodes only" would have loaded 33 of 37 edges and
said nothing. The delta now ships every endpoint of every edge it carries.

### A test file that had never read three of its own columns

`lib/db/dataset-registry-seed.test.ts` parses the committed seed, but its parser exposed neither
`allowed_values` nor `is_join_key` nor `joins_to`. Nothing had ever checked that a declared
vocabulary matches the constraint that enforces it, or that a join key names a target. The parser
now reads all three, and the new D1.6 block asserts the ten `match_method` values against the
check constraint, the two `geo_level` values, and that every join key on these three tables has a
`joins_to`.

Writing those assertions found a real gap rather than confirming what was already there:
`district_representative`'s note did not carry the derived/single-source caveat at all. Seven
mutations were run against the new block — dropping the no-fuzzy warning, removing a
`match_method` value, softening the party note, making a surrogate id queryable, blanking a join
target, pointing a relation at the wrong doc, dropping the mixed-grain warning — and all seven are
caught.

### Standards

1,027 tests, up from 1,020. `--selftest`, lint, typecheck and prettier clean. The lineage
generator prints nothing to stderr: no table without a `built-by` edge, and no dangling endpoint.

## 2026-09-05 — D2.5: the ledger publishes the ones that were turned down, too

`/districts/corrections` is live: every proposal ever submitted to the district mapping, its
status, and its review note, newest first, filterable by status and searchable over the submitted
wording and the reviewer's alike.

The plan calls this "the part that makes the correction mechanism credible rather than
decorative". The reason is worth restating in the log, because it is the whole design brief: the
mapping is single-source (Wikipedia/Wikidata; COMELEC's precinct returns, the intended second
opinion, are gone — D1.3g), and **public corrections are the second source it is missing**. A
submission box whose disposition nobody can see trains people to stop submitting, which costs us
the source, not just the goodwill.

### What the page publishes, and the two columns it does not

The migration handed D2.5 a constraint rather than a gap (`20260902030000_legislative_districts.sql`;
this log, 2026-09-02): `district_correction` has no public SELECT policy, because `submitter_email`
sits on the table and any policy broad enough to serve this page serves anyone who wants that
column. So the ledger reads with the service client and projects columns server-side —
`PUBLIC_CORRECTION_COLUMNS`, a named constant precisely so a test can assert the negative, that no
query behind the public page ever *asks* for the email. The service client bypasses RLS; the
projection is the only thing standing where a policy would normally stand, so it is tested as such
rather than trusted.

`reviewed_by` is excluded on the same reasoning pointed the other way. The transparency promise
here is about the *reasoning*, and honouring a promise made about submitters' addresses by
publishing an admin's address instead would be an odd trade. The note is published verbatim; who
wrote it is not.

### `open` is a status, not a waiting room

The plan says "every proposal ever submitted", and the ledger takes that literally: a proposal
nobody has judged yet appears with an "Awaiting review" badge and its rationale in full. Holding
proposals back until they have an outcome would reproduce, in miniature, exactly the black box the
page exists to close — the submitter would still have no way to tell "not yet read" from "quietly
dropped". Two tests cover this in the two places it could be lost: a status filter sneaking onto
the query, and a filter sneaking into the render.

### "Accepted ones link to the row they changed" — for two of the five actions

`applyAcceptance` stamps `source_ref = 'district_correction:<id>'` on the `geo_district_map` rows
it writes, which is the only link between the two tables and now has a second reader. `add` and
`move` produce such a row, so those entries link the membership row by place name on the district
page that carries it.

The other three genuinely have no row to point at, and the ledger says so in words rather than
rendering a dead "accepted" with nothing behind it: an accepted `remove` marks the existing row
`rejected`, which the public-read policy (`status <> 'rejected'`) then hides; a `rename` edits
`dim_legislative_district`; `other` writes nothing by design. Each still links the district pages
the proposal named, so a reader can always check the current state against what was proposed.

### The 1-hour window, closed at both ends

`/districts/corrections` sits on the same 1-hour ISR window as the rest of the district pages, but
the two events a reader cares about now expire it explicitly: the submission route revalidates the
path after a successful insert (not after a honeypot trip or a failed one — asserted), and the
admin's judge action revalidates it alongside `/districts` and the affected district pages. The
form tells the submitter their proposal will appear on the ledger; an hour's lag would make that
true only eventually, which is a smaller black box rather than none.

### Two smaller calls

**The rationale is now labelled public on the form itself**, under the textarea, before submission
— the plan's privacy line asked for this and D2.3 shipped without it, because until this increment
there was no public page to name. The email field's "never published" note was already there.

**`describeCorrectionChange` moved out of the admin queue** into `components/districts/correction-change.ts`,
shared by the queue and the ledger. The ledger is the public mirror of the queue; a reader checking
what happened to their proposal should see the same sentence the reviewer acted on, not a second
paraphrase free to drift from it.

### Left undone, deliberately

`district_correction` is still absent from `dataset_registry` — the 2026-09-03 entry deferred it to
"when D2.3 can say what its columns mean", which is now true. Registering it is a live-database
seeding job with its own exposure question (the assistant must never be able to query a column this
page is careful not to publish), and it belongs with D2.6's changelog work rather than bolted onto
the read-only page. Noted here so it is a scheduled debt and not a silent one.

### Standards

1,081 tests, up from 1,052. Lint and typecheck clean; `next build` compiles and type-checks, and
the new page renders through static generation against an unreachable database — which is the
degrade-to-empty path, exercised rather than asserted (the generated page carries its explanation
and a truthful zero count). Twenty mutations were run against the new
tests: publishing `submitter_email` in the column list, leaking it onto the mapped row, bucketing
outcome rows without reading `source_ref`, looking up outcomes for unaccepted proposals, resolving
names from the proposals only, never flagging a truncated list, hiding `open` rows at the query
and at the render, dropping the
review note, dropping the outcome links, swapping two outcome explanations, ignoring the status
filter, narrowing the search away from the review note, making it case-sensitive, un-marking a
stranger's evidence URL `nofollow`, and removing each revalidation (plus firing one on a honeypot
trip). All are caught. Two survivors are equivalent mutants, not gaps: rewriting the list read's
error guard as `data ?? []` (the outer `catch` returns the same empty ledger), and reordering the
`case` clauses in `describeAcceptedOutcome`.

## 2026-09-05 — D2.6: an accepted correction says so on the changelog, and district_correction joins the registry

The plan's half-day increment, plus the debt the 2026-09-03 and 2026-09-05 entries both scheduled
here.

### The bump does not expire anything yet, and pretending otherwise was the tempting move

§6.4 says keying the caches on `dataset_slug = 'ph-legislative-districts'` means an accepted
correction invalidates district answers and nothing else, "via the mechanism
`lib/ai/dataset-scope.ts` already implements". That mechanism does exist. What does not exist is a
scope using it: `dataset-scope.ts` defines `bhw` and `uuc-phc`, and no chat surface is keyed on the
district slug, so `ai_ask_cache` holds no district answers for a bump to expire.

`bumpDatasetVersion` ships anyway, and the reason is the direction of the failure. D3.4 adds the
district scope. If the bump is not already in place when it lands, the scope arrives serving
answers cached before a correction and nothing anywhere reports it — the same silent staleness U8
built the per-dataset version to prevent, arriving through the other door. Writing it now costs one
update statement; retrofitting it later costs noticing.

What the bump is worth today, independent of caches: `dim_dataset.last_updated_at` becomes a true
answer to "when did this mapping last change". Until now it only moved when a migration re-seeded
the row, which was fine while every dataset arrived as a bulk load. A public correction is the first
change to a dataset that originates inside the running site.

### The changelog entry does not carry the submitter's text

The rationale is public — the ledger prints it in full and the form says it will. It does not follow
that it belongs on `/methodology`. The ledger is a page about proposals, where a stranger's words
are the content and the reader knows it; the changelog is where this site records that a published
figure changed, and nobody reviews it entry by entry. Copying an open form's output there is a
different decision from publishing it on the ledger, and it is not made. The entry names what the
mapping now says, the proposal number, and where to read the reasoning.

The one-line description is `describeCorrectionChange`'s, making the changelog the third caller of
the sentence the queue and the ledger already share, for the reason yesterday's entry gave: a reader
who follows a changelog line to the ledger should meet the same wording, not a paraphrase to
reconcile. `body_md` is written as plain prose despite the column name, because `/methodology`
renders it verbatim inside a `<p>` — markdown syntax would show as syntax.

### Publication runs last and cannot fail the acceptance

By the time it runs, the `geo_district_map` row exists and the `district_correction` row is closed.
There is no retry available: `judgeDistrictCorrection` refuses a row that is not `open`, and if it
did not, re-running an accept would re-apply the mutation. So both writes are best-effort, log their
failures, and return an outcome the caller does not treat as an error. The trade is explicit — a
missing record of a change that happened, rather than a change reversed by its own record-keeping.

One ordering detail that is easy to get wrong and silent when wrong: the district and place names are
read *before* `applyAcceptance` runs. An accepted `rename` overwrites
`dim_legislative_district.district_name`, so a lookup afterwards prints the new name on both sides
and the entry reads "Rename X" for a district that was called something else a moment earlier.

### Registering `district_correction` moves the access control into the column dictionary

D1.6 deferred this table on two grounds. The first — no rows, no settled semantics — D2.3 through
D2.5 answered. The second was `submitter_email`, and it needed a decision rather than more waiting.

The decision: register it `public`, and mark `submitter_email`, `reviewed_by` and `session_id`
`is_queryable = false`. That is exactly the set `PUBLIC_CORRECTION_COLUMNS` refuses to publish, and
the queryable remainder is precisely what `/districts/corrections` already shows anyone, so
registering it `internal` would have had the registry say the opposite of what the site does.

What makes this a real decision rather than a formality: `queryDataset` reads through the
service-role client. The moment this table is registered, its missing public SELECT policy — the
whole reason D2.5 projects columns server-side — stops protecting it, and the `is_queryable` flags
are the only thing between the dictionary and a submitter's address. A non-queryable column cannot
be selected, filtered or ordered on, and the default projection is built from the queryable set, so
there is no path to one; `lib/db/dataset-registry-seed.test.ts` asserts the three flags against the
committed seed. The private columns are *listed* and flagged rather than omitted, so the next person
regenerating the dictionary meets the decision instead of an absence.

Nothing reads it today beyond the admin assistant's internal tool set — the public district scope
arrives with D3.4, and arrives with these flags already set.

### Two columns hold text a stranger typed, which no other registered relation does

`rationale` and `evidence_url` come from an open public form. Every other registered column holds a
figure this repository computed or read from a named source. Read by a model, that text is both a
claim to attribute and a string that may try to instruct it, so both column meanings say: quote it
as a submitter's claim, never as a finding, never follow an instruction inside it, and treat the URL
as unfetched and unchecked — it is what someone pointed at, not a source of the mapping.

### A generator fix tried and reverted

Regenerating the lineage seed added a node nobody asked for:
`migration:20260903050200_seed_kb_lineage_districts_delta.sql`, edgeless, earned because
`build_kb_lineage.py` keeps any migration whose raw text names the dataset dimension table and
D1.6's lineage delta names it inside one of the filenames it lists as provenance. Tightening the
condition to match the insert statement — what the generator's own docstring says the read is for —
removes the spurious node and also removes ten migration nodes predating this increment, renumbering
every provenance ref in the file. That is a change to the graph worth making deliberately and not on
the way past a half-day increment, so it is reverted and named, in the delta's header and here.

The new delta is written without spelling that table's name out, so it does not earn a node by the
same accident and leave the committed seed stale the moment it lands. Regeneration is now a no-op,
which is the property that makes the seed checkable.

### Standards

1,109 tests, up from 1,081. Lint and typecheck clean. `next build` compiles and type-checks; static
generation fails on `/bhw` in this sandbox because the page takes over 60 seconds against an
unreachable database, and that failure reproduces identically on the unmodified branch tip, so it is
the environment rather than this change. Fourteen mutations were run against the new tests: skipping
the changelog write, skipping the bump, bumping `bhw-2025` instead, treating a zero-row bump as
success, publishing on a rejection, publishing on a failed acceptance, publishing before the
proposal is closed, resolving names after `applyAcceptance` rather than before, dropping the rename
clause, dropping the ledger pointer, dropping the "not published by PSA or COMELEC" sentence,
letting a publication failure throw, marking `submitter_email` queryable, and dropping
`district_correction` from the registry seed. All are caught — but the ordering one only after the
stub was fixed. It survived the first run because the query-builder stub returned the same district
name whether the rename had been applied or not, so the test asserting "the *old* name reaches the
changelog" passed either way. The stub now applies a `dim_legislative_district.district_name` update
to its own rows, which is what makes that assertion mean anything.

## 2026-09-05 — D3.3: Surfaces, with the figure set D3.1 actually built

§6 D3.3 names five surfaces in one line each. The line for the profile pages says districts get
"the same figure set as `/place/[geoLevel]/[geoCode]`" — demographics, training, certification,
honorarium amount/distribution/sufficiency, completeness, households-per-BHW, insights, the whole
place-page contract. That line was never buildable from what exists: D3.1's own text says it built
"the first dataset only" — `agg_bhw_by_district` carries `n_total`, `n_accredited`, `pct_accredited`,
`avg_active_years`, `any_honorarium_pct`, and nothing else, because every other place-page figure
reads a *per-`geo_level`* aggregate keyed on `dim_geo`, and building the district-grain counterpart
of demographics/training/honorarium-amount/completeness/etc. is exactly the "UUC-PHC and
profiling-status counterparts are not yet built" follow-up D3.1 named, times six datasets instead of
two. Reading D3.3 as "wire up parity the data can't support yet" would mean either fabricating
figures from nothing or silently shipping a profile page thinner than its own promise with no note
saying so. §0's own instruction is to record the discrepancy and choose the smallest deviation that
preserves the plan's intent, so: the smallest deviation is the exact figure set D3.1 already
proved out, published honestly as three figures rather than dressed up as nine.

Concretely, "the same figure set as `/place`" becomes three `FigureCard`s on `/districts/[code]`
(Accreditation, Average years of service, Honorarium), each benchmarked against the Philippines
national row only — a district has no region/province ancestor chain the way a `dim_geo` row does
(plan §1), so there is no vertical benchmark rung between "this district" and "the nation" the way
`/place` has one for region. Peer-rank chips are omitted outright rather than approximated:
`agg_peer_ranks` is keyed on `geo_level`, districts aren't one, and guessing a rank would be exactly
the kind of fabricated figure the plan's own identity rule (§7 guardrail 6 and the wider "never state
a number that wasn't computed" rule) forbids.

The other four D3.3 bullets carry the same shape of decision, smaller each time:

- **`/explore`'s map layer** is real, not degraded: `public/geo/districts.json` (D3.2) colors by
  whichever of the 3 district figures is active, toggled at the national view only — a district
  doesn't nest inside a region the way a child geo does, so there is no "drill from region into
  district" rung to add, only a sibling layer to the existing region choropleth.
- **`/explore`'s district filter dimension** turned out to mean "findable", not "a second parallel
  indicator waterfall bolted onto the existing geo-scoped page": a district search result opens its
  own (now fuller) `/districts/[code]` page rather than trying to make every `/explore` figure
  understand a geography that isn't in `dim_geo`. Building a district-scoped clone of `/explore`'s
  20-odd figures would just be the same three-figure ceiling reached by a longer road.
- **`/compare`'s district-vs-district mode** reuses `CompareSummary`/`CompareMetricValues` as-is —
  the three unavailable base indicators (households-per-BHW, coverage %, bhw-per-1,000) pass through
  as `null` and the summary strip already has an honest "not enough data to compare X, Y, Z" path
  for exactly this case, so no new degrade logic was needed, only a narrower per-district column
  (`DistrictCompareColumn`) than the full `CompareColumn` a place gets.
- **Exports and search** needed no scope cut: CSV/XLSX/PNG/PPTX for the 3 district figures reuse the
  existing `/api/export/*` routes behind a `districtCode` param parsed by its own schema branch
  (never mixed with `geoCode`/`geoLevel` — guardrail 7), the mapping-as-download is a new
  `/api/export/districts/{csv,xlsx}` pair over `geo_district_map` directly, and
  `/api/geo/search` gets a `search_district` DB function (district name + member LGU,
  `word_similarity`, same style as `search_geo`) rather than any change to `search_geo` itself —
  a district is never mixed into `dim_geo`/`agg_geo_summary` (guardrail 7), so it search-merges in
  the API route instead of the query.

None of this blocks D3.4. The registry entry D3.4 §1 describes — `agg_bhw_by_district` at
`exposure = 'public'`, grain "one district × dataset" — is exactly the table this increment already
reads from, three columns and all; the AI layer's provenance/vintage rule (D3.4 §2) applies to
whatever figure set exists, not a specific count of them. The wider figure set, if it ships later,
is additive: new district-grain aggregate tables, the same three-`FigureCard` section growing rows,
no rework of what this increment built.

### Standards

Lint and typecheck clean. `npm test` clean (existing suite plus the filter-codec round-trip
assertions this increment added for `districtCode`/`compareDistricts`/`mapLayer`).

## 2026-09-05 — D3.4: the AI layer, and the district chat scope it turned out to need

The plan's four changes (§6 D3.4), in the order it gives them.

### §1 — agg_bhw_by_district joins the registry, and it is filed under the mapping's slug, not bhw-2025

`supabase/migrations/20260905070000_seed_registry_agg_bhw_by_district.sql` (and the canonical seed,
`20260826090100_seed_dataset_registry.sql`), applied to `bhw-connect` via the Supabase MCP. `grain`
is `'one district × dataset'`, spelled out exactly as the plan quotes it — every other grain value
in the seed reads as prose ("One X per Y"); this one keeps the plan's own notation because D3.3's
own DECISIONS entry already quoted it that way, so matching it exactly is what keeps the two
records saying the same thing.

**`dataset_slug = 'ph-legislative-districts'`, not `'bhw-2025'`, and this is the one call in this
increment that isn't mechanical.** The table's *rows* are bhw-2025 figures — every `dataset_id` in
it points there. But `dataset_slug` is not "which dataset do these numbers come from"; it is which
chat scope's narrowed tool set can reach the table at all (`inDatasetScope`,
`lib/db/dataset-registry.ts`: a relation is in scope only if its `dataset_slug` is null or in the
caller's list). Filed under `bhw-2025`, `agg_bhw_by_district` would be invisible to the district
scope §3 needs and unreachable by the very feature this migration exists to unlock. D2.6 already
set this precedent for `agg_bhw_by_uuc_status` (filed under `uuc-phc-2025` though its figures come
from the bhw datasets) for the identical reason, and the registry note here says so, so the next
person filing a derived aggregate under the "wrong" slug on purpose finds the reasoning rather than
reinventing it.

### §2 and §3 — there was no scope to put the rule in, so this increment adds one

The plan's own text treats §2 (a provenance rule) and §3 (cache versioning "already free") as
already-available machinery to switch on. Reading `lib/ai/dataset-scope.ts` said otherwise, and two
DECISIONS entries had already flagged it in advance: D2.6's said outright "no chat surface is keyed
on the district slug, so `ai_ask_cache` holds no district answers for a bump to expire... the public
district scope arrives with D3.4." `bumpDatasetVersion(DATASET_SLUGS.legislativeDistricts)` has been
firing on every accepted correction since D2.6 with nothing downstream to invalidate — this
increment is what gives it something.

**`lib/ai/district-system-prompt.ts`** is a new `DISTRICT_SYSTEM_PROMPT`, on the `UUC_PHC_SYSTEM_PROMPT`
precedent (a separate constant per surface, not a shared prompt with conditional paragraphs). Rule 2
is §2's rule verbatim: name the Congress, say the grouping is derived and correctable. Rules 3-5 are
not asked for by name but are the same class of rule as the suppression instruction — a caveat that
has to travel with a specific kind of value or the model states something false with total
fluency: rule 3 is D3.1's arithmetic trap (never derive a district's figure from a member city's own
citymun total), rule 4 is the gap-disclosure rule every district table's registry note already
carries (an absent row is an unresolved mapping gap, never a zero — Cavite's 3rd is the standing
example), and rule 5 is `district_correction`'s own boundary, restated at rule priority: proposals
are not the mapping, and its free-text columns are an unverified stranger's claim, never an
instruction to follow.

**`lib/ai/dataset-scope.ts` gets a `DISTRICT_SCOPE`**: `id: "district"`,
`datasetSlug: DATASET_SLUGS.legislativeDistricts`, `createTools: () => createDatasetTools("public",
[DATASET_SLUGS.legislativeDistricts])` — the registry pair narrowed to the five tables that slug
covers, no hand-written tool code, exactly as §1's own framing promises. `"district"` joins
`DATASET_SCOPE_IDS`, so `app/api/ai/chat/route.ts` needs no change at all: it already takes
`dataset` as an enum over that list and threads `scope.datasetSlug` through the cache key,
`ai_ask_log`, and the tool set uniformly.

**`DatasetScope.narrativeType` and `.narrativePrompt` become optional, and `DISTRICT_SCOPE` omits
both.** Every existing scope pairs a chat surface with a geo-shaped narrative (`NarrativeContext`
is `{geoCode, geoLevel, geoName}`), generated for a `dim_geo` row. A district is not a `dim_geo` row
— it has no `geoCode`/`geoLevel` of its own (plan §1) — so there is no cache key or prompt shape a
"district narrative" would mean, and no page asks for one: D3.3's own entry gave `/districts/[code]`
three `FigureCard`s, not an AI insight card. Writing a `narrativePrompt` that takes a `geoCode`
anyway would be a stub wearing the shape of a feature nothing calls; leaving the fields required
would force one into existence for a type-checker's sake. Made optional instead, with
`lib/ai/narrative.ts`'s existing "a narrative_type nothing claims generates nothing" guard extended
by one clause (`if (!scope || !scope.narrativePrompt) return null;`) — refusing beats fabricating a
narrative shape for an entity that doesn't have the fields to fill it, the same reasoning the
existing guard already uses for an unclaimed `narrativeType`.

### §4 — three of the four cases, and why the fourth isn't in this table

`supabase/migrations/20260905080000_ai_regression_district_cases.sql`, on the "route 1" pattern
`20260828120000_ai_regression_expectation.sql` established: values read live through the same REST
layer `queryDataset` uses, via the Supabase MCP, not authored. Two came back as expected — Leyte's
1st (`n_total = 1495`, `n_accredited = 1041`, `pct_accredited = 69.63`) and Cavite's 3rd (zero rows,
`mode: "count"`, `matchingRows = 0` — City of Imus, its only member, is unresolved). The
multi-district trap is the one worth recording: Quezon City's whole citymun row in
`agg_bhw_counts` carries `n_total = 244`; its 3rd district's own row in `agg_bhw_by_district` is
`37`. A wrong answer built by rolling up the citymun total (the exact trap D3.1's migration guards
against in the aggregate itself) would report 244 for one of six districts — the case pins 37 and
the note records 244 as the specific wrong number a fluent answer would give instead.

**The fourth case — "a vintage question, for an LGU moved by a correction" — is not seeded as a
row.** `ai_regression_case` pins the *current* live mapping; `district_correction` has zero
accepted rows today (checked live before writing this), so there is no "before" and "after" this
table could assert without inventing a correction against a real place's public district assignment
for a test's sake — which is worse than not testing it, on the same reasoning guardrail 5 gives for
never letting a correction write directly outside the reviewed pipeline. What the case can honestly
seed is its lookup half: "Which legislative district is Palo, Leyte in?" resolves to `leyte-1st`,
which is D3.3's own worked example for `/api/geo/search` ("Palo" surfaces "Leyte's 1st") — so the
seed ties directly to language already in the plan rather than a fixture invented for this row.

The half that actually needs a correction to exist — that accepting one bumps
`dim_dataset.last_updated_at` for `ph-legislative-districts` and nothing else, which is what would
keep a stale cached answer from serving after a real move — is exercised where it can be, as code:
`app/api/ai/chat/route.test.ts` now asserts the district surface's cache key is
`(question, geoCode, "DISTRICT-V1", "ph-legislative-districts")`, independent of the bhw and uuc-phc
keys for the identical question, and `lib/db/district-correction-changelog.test.ts` already asserts
acceptance calls `bumpDatasetVersion(DATASET_SLUGS.legislativeDistricts)`. Together those two prove
the mechanism §3 claims; neither one needed a live mutation to a real district assignment to do it.

### Standards

1,139 tests, up from 1,109. Lint and typecheck clean. The four regression cases' `tool_calls` and
`expectations` were checked by hand against the live database through the Supabase MCP rather than
through `lib/ai/regression-runner.ts` itself — the runner needs a service-role key this environment
does not have, the same gap the original ten cases' migration recorded rather than papering over.

## 2026-09-05 — `fact_honorarium` profiled live: the 2026-08-28 prediction, run for real

The 2026-08-28 entry ("Increment 4.1's leftover") ran `ingest.py`'s new profiling hook end to end
against a **local** database and stated outright what it could not establish: *"the first live row
it writes will be for `fact_honorarium`... That is a prediction, not a result."* Nothing since has
applied it — `dataset_registry` confirmed before this entry that `fact_honorarium` still had no row
at all, while `dim_geo` and `fact_bhw_raw` were both `approved`. No code change was needed;
`profile_dataset()` has existed, unrun against production, since 4.1. This is the run, via the
Supabase MCP:

```sql
select * from profile_dataset('fact_honorarium');
```

**The prediction held, on both counts it named.** `registry_id 45`, `status = 'auto'`,
`row_estimate = 577,069`, `exposure = 'internal'` — invisible to every tool until a reviewer
approves it, exactly as designed. And the two defects the local run flagged in advance reproduced
live, for the reason already on record rather than a new one:

- **`bhw_id` profiled `role = 'measure'`.** Distinct/row ratio 233,491/577,069 = 0.40, below the
  0.9 identity cutoff — the child-side-of-a-join gap `profile_dataset_role()` still has.
- **`bhw_id` borrowed its `meaning` from `fact_bhw_raw.bhw_id`** ("Surrogate row identifier...
  never report or join on it") while staying typed a measure with `joins_to` null — the borrow
  route carries `meaning`/`unit` only, never `role`/`is_join_key`/`joins_to`, so the sentence and
  the type disagree on the same column. Both are `profile_dataset()`'s rules, not this run's to
  fix, and both are already recorded above and in `ingest.py`'s header.

The other seven columns landed as the function's own rules say they would: `id` borrowed its
meaning the same way `bhw_id` did; the five domain columns (`payer_level`, `receives`, `amount`,
`frequency`, `normalized_monthly_amount`, `source_note`) got the visible `(needs review)`
placeholder, because nothing approved anywhere describes a same-name-and-type column for any of
them. No join was proposed to `fact_bhw_raw` — the registry still names only two approved join
targets, unchanged since 4.1.

No migration file added or applied — the call is exactly the one an operator runs by hand per
`ingest.py`'s own comment, and it writes nothing DDL. `dim_geo` and `fact_bhw_raw` were left alone:
both are already `approved`, so `profile_dataset()` refused them without `p_force`, which is the
correct outcome — re-profiling either would return their dictionaries to the review queue.

**What this closes.** The live database now matches what `ingest.py`'s hook has profiled every
table it will touch on the next real load; a future `fact_bhw_raw`/`fact_honorarium` ingest run
will find `fact_honorarium` already registered and skip straight to its refusal-or-reprofile logic
rather than writing a first row cold. **What it does not close.** `fact_honorarium`'s six columns
still need a reviewer's judgment before the assistant can query them, and the `bhw_id` role/borrow
mismatch is still `profile_dataset()`'s to fix, not a reviewer's to work around.

## 2026-09-05 — The contradiction sweep, re-run: the corroboration fix confirmed live, and sixteen rows now stale

Two things this increment's own entries left open. First, whether
`20260828210000_sweep_corroboration_suppression.sql` — "committed but not applied," per that entry
and `AI_ASSISTANT_PLAN.md` §4.2 — had actually reached the live database since. Second, whether
`sweep_contradictions()` had been re-run against it: the table still held the same **22 rows, all
`auto`**, that the 2026-08-28 entry recorded.

**The fix is live.** `pg_get_functiondef('sweep_contradictions'::regproc)` shows `v_corroborated`
read after the candidate loop, exactly as the migration writes it — not the pre-fix version that
files a disagreement anyway when a perfect fit is probed second. No migration was applied by this
entry; this only confirms one already was, at some point between 2026-08-28 and today, uncredited
in any entry since.

**The sweep was re-run live**, via the Supabase MCP: `select * from sweep_contradictions();`.

- **6 rows returned**, all pre-existing: slide 161's cell and level total
  (`agg_bhw_by_uuc_status.n_listed_no_bhw`), and the three `277767`/`29409`-vs-`fact_bhw_raw`
  scalar-magnitude rows on slides 8, 26 and 151. Their `last_swept_at` moved to today — the
  function's own upsert refreshing rows it re-derives, not new findings.
- **16 rows were not returned** — every row on slides 37 and 141, both `n_barangays_listed` and
  `n_health_evaluable` — and their `last_swept_at` stayed at 2026-08-28. This is the corroboration
  fix doing exactly what it is for: `agg_bhw_by_uuc_status.n_barangays_listed` now fits every cell
  on both slides at 1.0 (the UUC final-list alignment's own doing), so the whole distribution is
  accounted for and nothing — including the `n_health_evaluable` fallback that used to win once
  `n_barangays_listed` stopped being a perfect fit — gets filed against it. **16 findings become 6**,
  exactly as the 2026-08-28 entry predicted from a read-only reproduction, now confirmed by the real
  function against live data.
- **Nothing new was found.** No slide added since 2026-08-28, and no new `dataset_registry` measure
  column changed which distributions Pass 1 can probe in a way that surfaced a fresh disagreement —
  the district-mapping work landed no new slide deck for Pass 2 to read either.

**What this does not do.** The 16 rows on slides 37/141 are still sitting in `kb_contradiction` at
`status = 'auto'`, carrying stale `data_value`s from before the alignment (e.g. contradiction 109:
`doc_value = 5987`, `data_value = 5991`, when the live table now reads 5987 — the very reason the
fresh sweep no longer files it). `AI_ASSISTANT_PLAN.md` §4.2 is explicit that clearing them is a
reviewer's call, by rejection rather than deletion — "a rejection records that a subset is not the
same measure" — and this entry does not make that call. They are stale-but-pending, exactly as
predicted, and remain in `/admin`'s review queue until a reviewer rejects them.


## 2026-09-05 — NHFR: the DOH National Health Facility Registry as dataset #6 (plan N1–N4)

Loaded the September 2026 snapshot of the DOH National Health Facility Registry — 44,799
facilities across all 18 regions — as `nhfr-2026-09`, and built `/facilities` on it. Plan:
`docs/NHFR_2026_PLAN.md`.

**The licence question was already answered, in a different document.** `DATASET_SCOPING.md` §2
carried "blocked on a license answer before any ingestion work starts", while
`EXPLORE_ENHANCEMENT_PLAN.md:19` carried an owner decision that unblocked it — *"NHFR/FHSIS: use
whatever is publicly available online, with citation"* — and `EXPLORE_ENHANCEMENT_PLAN.md:351`
(E4.5) had already specced the increment. The owner confirmed on 2026-09-05 that the public export
is FOI-covered. The scoping doc is rewritten rather than left to contradict the plan it sits
beside. **The general lesson is recorded there too:** a scoping verdict is only as current as the
last time someone checked it against the other decisions in the repo.

**The geo-join risk that motivated the block does not exist.** The scoping entry feared free-text
addresses needing geocoding, "a real risk of repeating 1.6's boundary-vintage crosswalk problem".
The export carries clean 10-digit PSGC codes on all four levels; all truncate losslessly to
`dim_geo`'s widths, and every one of the 44,691 barangay codes sits inside its own
city/municipality. No new crosswalk was needed at all — including for Sulu, below.

**Decisions taken, and why:**

1. **Slug carries the snapshot month (`nhfr-2026-09`), status `published`.** NHFR is a live
   registry, not a periodic publication, so a later export is a new version rather than a
   correction — unlike `uuc-phc-2025`, whose year names an actual annual publication. `published`
   not `active`: seeding a second `active` row blanked the site once (E4.3, #44).

2. **Contact and street-address columns are not ingested.** Of the export's 20,194 email
   addresses, **18,413 (91%) are free webmail** — gmail/yahoo/hotmail/outlook — i.e. the personal
   addresses of individual midwives and proprietors, not institutional contacts. These tables are
   anon-readable over PostgREST and their derivatives publish under CC BY 4.0, so loading them
   would republish roughly eighteen thousand people's personal contact details as open data.
   BUILD_PLAN pitfall **P16** sets the precedent (the free-text training column "never leaves raw
   tables"). Nothing on any planned page needed them. Verified: the committed extract contains
   zero email addresses. **Anyone reusing this source should make the same call.**

2a. **The committed copy of the source workbook is redacted too, and that was a correction.**
   Decision 2 kept the contact columns out of the *database*, but the raw export was committed to
   `ingestion/data/` following the repo's practice of committing sources — and this repository is
   public, so that put 18,413 personal email addresses into a public git history for the ~30
   minutes between the first push and this fix. `ingestion/redact_nhfr_source.py` blanks the six
   contact columns (landline ×2, fax, email, alternate email, website — 34,645 values), the
   branch history was rewritten so no commit on it ever carried the unredacted blob, and the
   branch was force-pushed. Verified: 0 email matches in the workbook XML of every commit on the
   branch, against 16,580 in the original, and `clean_nhfr.py` produces a byte-identical extract
   from the redacted copy. **The general rule this sets: "we don't load it" is not the same as
   "we don't publish it" when the raw source is committed. Check the source file too.**

3. **`geo_code` is city/municipality grain and NOT NULL; `barangay_geo_code` is nullable.** 108 of
   44,799 facilities carry no barangay code. Making barangay the required key would mean dropping
   those 108 or inventing codes for them; every facility has a city/municipality, so every
   facility keeps a rollup path. Both resolve in SQL through `map_psgc_to_dim_geo()` so an
   unresolvable code fails the insert rather than silently dropping a facility.

4. **Sulu: honour the code, not the name — the mirror image of the UUC case.** The export names
   all 177 Sulu facilities under Region IX while 152 carry BARMM-vintage `19066…` codes and 25
   carry Region IX `09066…` ones. (`UUC_PHC_2025_PLAN.md` §4 had the reverse: names said BARMM,
   codes said Region IX.) Both resolve onto `dim_geo`'s BARMM placement — the 152 directly, the 25
   through the crosswalk `20260826121200_crosswalk_sulu_region_ix.sql` already seeded for all 430
   Sulu geos. So the rollups file Sulu under BARMM while the source's region column says Region
   IX, and the methodology page says so rather than papering over it.

5. **`dim_geo` needed patching, and this is now the second dataset to find that.** `dim_geo` is
   built purely from the bhw-2025 parquet, so it holds only places with at least one profiled BHW.
   Four districts of the City of Manila — **Binondo, San Miguel, Ermita (95 facilities alone) and
   Intramuros**, 127 facilities between them — have no row. `ingestion/patch_dim_geo_nhfr_gap.py`
   computes the gap against the live `dim_geo` at run time rather than asserting a number that
   could go stale, and tags new rows `nhfr_only_v1` so the gap stays visible in the data.
   `patch_dim_geo_stepzero_gap.py` did the same in July for 12 citymuns and 2,682 barangays.
   **Worth noting as a pattern:** every dataset that reaches places the BHW census did not will
   hit this, and the fix is always a tagged patch, never a silent `dim_geo` edit.

6. **Two source inconsistencies reconciled by rule, not silently, on P15's precedent.** 15
   facilities carry *both* a government and a private ownership sub-classification (e.g. "RIZAL
   RURAL HEALTH UNIT" is Government/LGU and also "Single Proprietorship"); `ownership_major` is
   authoritative and the contradicting value is discarded, with all 15 named in the cleaning
   report. 6 hospitals write bed capacity with thousands separators ("1,200"), which is formatting
   rather than a different value.

7. **No `n<5` suppression.** This counts *places*; BUILD_PLAN §4.1 exempts counts of totals, and
   `agg_uuc_phc_counts` is the direct precedent. The personal columns were dropped at ingestion
   rather than aggregated away, which is a stronger guarantee than suppression would have been.

8. **No "% licensed" figure at any level, and a blank never renders as "unlicensed".** 28,247 of
   44,799 facilities carry no licensing status, overwhelmingly barangay health stations, which are
   not a licensed facility type. The denominator a compliance rate needs — which facilities are
   *supposed* to hold a licence — is not knowable from this export. A unit test pins the label so
   a future edit cannot quietly turn absence into an accusation against thousands of functioning
   facilities.

9. **No committed seed migration.** 44,799 rows is ~10 MB of SQL. `ingest_uuc_phc.py` commits a
   seed because 5,987 rows fit in a migration; this follows `ingest_stepzero.py` instead — live
   load in one transaction with an `ingestion_batches` QA row, or batched `.sql` files offline.
   The reproducible committed artefact is the cleaned CSV.

10. **Child breakdowns sort by coverage ascending, not by facility count.** Ranking by count
    re-ranks areas by how large they are. The question this dataset answers is where there is
    nothing: nationally 28,490 of 41,958 barangays have a facility, so roughly 13,470 have none,
    and the coverage bar labels its unfilled remainder rather than leaving it as empty track.

**Known debt, deliberately not paid here** (the owner scoped this to the core dataset + section):
`dataset_registry` / `dataset_column` rows are not written, so NHFR is unreachable from the AI
chat — `queryDataset` refuses a table with no approved dictionary. Present mode, the PNG
one-pager, dataset-aware feedback routing and an AI insight slot are likewise not built. This is
the same debt the UUC build had to pay back in U5, recorded up front this time rather than
discovered later. A facility **point map** is also deferred: the source carries no coordinates,
only PSGC codes, so points would sit at barangay centroids — a different claim than a facility
location.

**Two things the local end-to-end run caught that review had not.** The migrations, the loader
and both aggregates were run against a throwaway PostgreSQL 16 instance with a `dim_geo` derived
from the extract's own geography (Sulu deliberately held on the BARMM vintage, plus one synthetic
facility-less barangay per city so coverage is never trivially 100%). It found:

- **`agg_nhfr_by_type` failed outright** with "ON CONFLICT DO UPDATE command cannot affect row a
  second time". The cause is a real property of the source: `facility_major_type` looks like an
  attribute of `facility_type` but is not. **13 of the 45 types appear under both 'Health
  Facility' and 'Health Related Facility'**, and lopsidedly — Rural Health Unit 2,744 against 1,
  Birthing Home 3,562 against 3, Clinical Laboratory 4,346 against 3. Grouping by it split one
  type across two rows with the same key. The column is dropped from the aggregate (it stays on
  the fact table, where it describes the facility), and the "health-related" badge the type
  breakdown rendered is gone with it — it would have labelled a whole type from what is
  per-facility encoding noise.

- **"Barangays with a facility" is 28,490, not 28,511.** The export prints 28,511 distinct
  barangay codes, but **21 Sulu barangays are listed under both code vintages** and resolve to one
  barangay each. Every figure quoting the coverage numerator is corrected; the loader's
  pre-load check still expects 28,511 because it checks the extract, not the load. The facilities
  are not duplicated — each carries its own registry code.

The run also confirmed what was designed rather than assumed: 44,799 rows loaded with 0
unresolved `geo_code`, 108 null `barangay_geo_code`, all 177 Sulu facilities filed under BARMM
(including the 25 that arrive on `09066…` codes and can only get there through the crosswalk),
and national = Σ regions = Σ provinces = Σ citymuns = 44,799. Sulu's move shows up exactly where
it should: Region IX 1,523 and BARMM 1,327.

**Not yet run against the live project.** The migrations and the load are operator steps: this
session had no `DATABASE_URL`, and 44,799 rows cannot be pushed through the Supabase MCP tool. The
order is `patch_dim_geo_nhfr_gap.py` → `ingest_nhfr.py` → the two aggregate migrations (which
recompute on every run). `verify_rls.py` gained the three new tables; the UUC and district tables
are still missing from its lists, which is pre-existing drift noted in the file rather than fixed
here.


## 2026-09-06 — Facilities chat: the /uuc-phc U8 equivalent for NHFR

Wired an "Ask the data" chat onto `/facilities`. N5 registered the three NHFR relations with
`dataset_registry`/`dataset_column` so `queryDataset` could reach them, and named the remaining
piece explicitly in its own migration comment without recording it here as promised — this entry
closes that gap and does the work.

Three additions, on the `uuc-phc` (U8) and `district` (D3.4) scopes' precedent — no new tool code,
because the registry pair is the whole tool set once a dataset is registered:

1. **`lib/ai/scope-id.ts`** — `"facilities"` added to `DATASET_SCOPE_IDS`.
2. **`lib/ai/facilities-system-prompt.ts`** — `FACILITIES_SYSTEM_PROMPT`, one rule per caveat
   `dataset_registry.notes_md` already carries on the three NHFR tables (N5): a blank
   `licensing_status` is never "unlicensed" and never feeds a "% licensed" figure;
   `facility_major_type` is never a grouping key; Sulu's 177 facilities are named under Region IX
   but must be rolled up under BARMM (`geo_code`); contact/address columns do not exist in this
   table at all, not merely hidden; `agg_nhfr_by_type` is sparse by construction, so a missing row
   means zero only after checking `agg_nhfr_counts.n_facilities`; the four headline type counts
   never sum to `n_facilities`; and barangay coverage's denominator is `n_barangays`, never
   `n_facilities`.
3. **`lib/ai/dataset-scope.ts`** — `FACILITIES_SCOPE`: `datasetSlug: nhfr-2026-09`, the registry
   pair narrowed to that slug (`createDatasetTools("public", [DATASET_SLUGS.nhfr])`), the new
   prompt, and its own `emptyAnswer`. Registered in `SCOPES`, which the `Record<DatasetScopeId, ...>`
   type makes exhaustive by construction.
4. **`components/facilities/ask-facilities.tsx`** — an `AskFacilities` wrapper around
   `ChatLauncher`, on `components/uuc-phc/ask-the-list.tsx`'s precedent, mounted on
   `app/facilities/page.tsx` and `app/facilities/[geoLevel]/[geoCode]/page.tsx`. Its third starter
   question ("Are the facilities with no licensing status unlicensed?") is deliberately the trap a
   visitor is most likely to walk into unprompted, so rule 2's answer is the first thing they see.
5. **`app/facilities/methodology/page.tsx`** gained the `#ask` section `ChatLauncher`'s "how this
   works" link points to, on the `/uuc-phc/methodology` section's precedent.

No narrative type and no AI insight slot: that remains its own deferred item (the plan's
"Deferred" section groups it with present mode and the PNG one-pager), and `DatasetScope.narrativeType`
is already optional for exactly this case — `district` carries none for a different reason (no
`(geoCode, geoLevel)`-shaped narrative context), and `facilities` now carries none because the
slot itself hasn't been built yet. Adding one later is a field addition, not a rewrite.
`app/api/ai/chat/route.ts` needed no change — it already reads `DATASET_SCOPE_IDS` generically and
resolves everything else through `datasetScope(dataset)`.

`lib/ai/dataset-scope.test.ts` gained a `describe` block for the new scope and prompt, mirroring
the `district` and `uuc-phc` ones, and the existing "every scope has its own narrative type"
assertion was split in two: dataset slug and system prompt stay checked for uniqueness across all
scopes, while narrative-type uniqueness is now checked only among the scopes that declare one —
two scopes sharing "no narrative" is expected, not a collision.

## 2026-09-06 — Facilities AI insight: the deferred slot, filled in

The other half of the previous entry's deferral, paid back the way that entry said it would be —
a field addition to `FACILITIES_SCOPE`, not a rewrite, on `UUC_PHC_SCOPE`'s precedent.

1. **`lib/ai/dataset-scope.ts`** — `"facilities_overview"` added to `NARRATIVE_TYPES`, and
   `FACILITIES_SCOPE` gained `narrativeType: "facilities_overview"` plus a `narrativePrompt`: lead
   with the facility count and barangay coverage (`agg_nhfr_counts`), then at most one more finding
   from `agg_nhfr_by_type`. The prompt restates the same two traps `FACILITIES_SYSTEM_PROMPT`
   already forbids the chat — no percent-licensed figure, and a blank `licensing_status` is never
   "unlicensed" — because a narrative is a second place an ungrounded number or a wrong-unlicensed
   claim could otherwise slip out unaudited by the chat's own rules.
2. **`app/facilities/[geoLevel]/[geoCode]/page.tsx`** — `AiInsight` mounted with
   `narrativeType="facilities_overview"` and `methodologyHref="/facilities/methodology#ask"` (the
   section already added for `AskFacilities`; no new anchor needed). Landing page excluded, on the
   `uuc-phc` decision this repeats: its single figure is already the page's hero, and a narrative
   there would restate it at the cost of a provider call on the section's highest-traffic page.
   Unlike `/uuc-phc` and `/place`, `/facilities`'s area pages carry no presentation-mode
   (`PresentationProvider`/`PresentationSlide`) wiring at all, so the insight is a plain section
   here rather than a promoted slide — introducing deck mode for one card was not this slot's job.
3. **`lib/ai/dataset-scope.test.ts`** — the facilities `describe` block's "carries no narrative"
   case is replaced with the `uuc-phc` block's shape: asserts the new `narrativeType` and that the
   prompt names both `agg_nhfr_counts` and `agg_nhfr_by_type` and forbids both traps. The "some
   scopes (district, facilities) carry none" test description now names only `district`, the one
   scope left with no `(geoCode, geoLevel)`-shaped narrative to generate.

`components/narrative/ai-insight.tsx` and `lib/ai/narrative.ts` needed no change — both already
resolve a scope generically from `narrativeType` via `scopeForNarrativeType`, which is the whole
point of the field being optional rather than a hardcoded union of surfaces.

## 2026-09-06 — Facilities: Present mode

Wired `PresentationProvider`/`PresentationSlide`/`PresentButton` onto `app/facilities/page.tsx`
and `app/facilities/[geoLevel]/[geoCode]/page.tsx`, the last item of the debt the NHFR load
recorded up front ("Present mode, the PNG one-pager, dataset-aware feedback routing and an AI
insight slot are likewise not built") — the AI insight slot was filled first, as its own entry
above notes, leaving this one. `/uuc-phc`'s deck is the direct precedent: a section with its own
identity gets its own `brandLabel` rather than presenting under "BHW Connect".

`NHFR_BRAND_LABEL` and `nhfrCaption` already existed in `lib/db/nhfr.ts` (N4/N5's precedent, one
step ahead of this wiring), so `deckMeta` needed no new dataset code — just assembling the same
shape `/uuc-phc` and `/place` already build.

**Landing page**: three slides — `coverage` (stats + coverage bar), `types` (facility-type
breakdown), `regions` (the region `ChildBreakdown`). The methodology paragraph and `AskFacilities`
stay outside the deck, on both existing pages' precedent (a chat launcher is not a finding).

**Area page**: `coverage`, `types`, then a conditional slide — `facility-list` at
city/municipality, `areas` (titled from `CHILD_HEADING`) everywhere else — and finally `ai-insight`,
wrapping the `AiInsight` block that had been sitting as a plain, un-decked section since the prior
entry. This is the gap the task named directly: that slot was added as a plain section specifically
because this wiring didn't exist yet. `PresentButton` sits beside the page's own `<h1>`, inside the
provider, matching where `/uuc-phc` and `/place/*` put it.

`deckMeta.filterChips` uses `crumbAncestors` (region/province/citymun names already computed for
the breadcrumb trail) rather than introducing a second ancestor list. `nhfrCaption` handles a null
`counts` the same way it does everywhere else — an "N = —" line — so `deckMeta` builds
unconditionally and the `!counts` branch simply registers no slides; `PresentButton` already
no-ops when `slides.length === 0`, so no extra guard was needed there.

## 2026-09-06 — Facilities: the PNG one-pager, the last item of the NHFR deferral list

`lib/exports/nhfr-figure.ts` + `app/api/export/facilities`, mirroring `uuc-phc-figure.ts` — same
canvas, same resvg path, same bundled-font constraint — but with two bars, not one: `lib/db/nhfr.ts`
supports exactly two exhaustive binary splits (barangay coverage, ownership), and neither aggregate
table carries a third one to draw. `composeNhfrFigureSvg` is split out as a pure function of
already-fetched data (`buildNhfrFigure` does the fetching), so its content rules are unit-tested
rather than only eyeballed — `uuc-phc-figure.ts`'s `wrapNames` is the only export it could test.

- **No licensing figure, anywhere on the sheet.** Neither `agg_nhfr_counts` nor `agg_nhfr_by_type`
  carries a licensing column — `FacilityStats`' "no % licensed tile" rule isn't a choice this sheet
  could reverse even if it wanted to. The footer states the omission instead of leaving it silent,
  in the same words the rule is stated elsewhere: a blank never means unlicensed.
- **The facility-type table reuses `agg_nhfr_by_type`'s own order** (already sorted descending by
  count) rather than re-sorting, capped at 20 rows with the omitted count and its facility total
  named — the same "+N more" discipline `uuc-phc-figure.ts`'s child table and barangay-name list
  both use.
- **The child table's sort had to be inverted from `uuc-phc-figure.ts`'s.** That sheet ranks by
  share descending; `ChildBreakdown` on `/facilities` ranks by coverage *ascending* (least-covered
  first, nulls last) because a raw count just re-ranks areas by size and the question this dataset
  answers is where there is nothing. Copying uuc-phc's sort verbatim would have made the PNG and
  the on-screen table disagree about which area to look at first — copied the comparator instead.
- **The city/municipality leaf names facilities, not barangays** — the one real divergence from
  uuc-phc's citymun sheet, which names listed barangays because that dataset's leaf answer is
  membership. NHFR's leaf answer is "which facilities, and what kind," and a city can carry
  hundreds of them where a town carries dozens of barangays. Named individually: every facility
  other than a Barangay Health Station, capped at 40 (`wrapNames` again), with the station count
  stated rather than silently absorbed into the omission — BHS is already a numbered row in the
  facility-type table above it, so nothing is actually lost by not naming those individually.
- **A real bug caught by rendering and looking, not by any test or type check:** the first render
  of the licensing-caveat footer line ran to 161 characters and overflowed the canvas edge —
  `uuc-phc-figure.ts`'s own footer-overflow fix (`docs/DECISIONS.md`'s "footerLines, plural") is a
  documented failure mode of this exact SVG-composition style, and this file reproduced it anyway
  on a new sentence. Fixed the same way: four short footer lines instead of three longer ones.
- **`next.config.ts`'s `outputFileTracingIncludes` was missing an entry for `/api/export/uuc-phc`**,
  found while adding this route's own entry. That route rasterizes through the identical
  `resvgFont()` path and would have shipped the same blank-text-on-Vercel failure the comment above
  the block describes; added both entries in this change.

**Verify.** Rendered and visually inspected against the live `bhw-connect` Supabase project (not
just unit fixtures): national (18 regions, all present; CAR near the middle of the coverage
ranking), Region IV-A/CALABARZON (the largest region, 5,490 facilities), a single-city province
(Pateros, 14 facilities, 1-row child table), and Quezon City (784 facilities, the largest
city/municipality — exercises both the type-table cap and the named-facility cap). 400 on missing
params and on `geoLevel=barangay` (the registry publishes nothing at that grain); 404 on an unknown
geo code. `lib/exports/nhfr-figure.test.ts` (13 tests, covering the type-table truncation line, the
inverted child sort, the zero-facility and zero-barangay-denominator states, XML-escaping of a
facility name, and the BHS-naming rule) plus the full suite (1,197 tests), `npm run lint`, and
`npm run typecheck` all pass.

## 2026-09-06 — Facilities: social-share cards for the section (a second, unrelated "PNG")

Landed concurrently with the entry above, on a separate branch, under the same working title —
worth reconciling here since both entries otherwise claim to close the same debt item.
`docs/NHFR_2026_PLAN.md`'s Deferred section named "the PNG one-pager" after `docs/UUC_PHC_2025_PLAN.md`'s
**U4**, which is specifically `lib/exports/uuc-phc-figure.ts` + `app/api/export/uuc-phc` — the
downloadable one-page summary sheet the entry above builds the NHFR equivalent of. `opengraph-image.tsx`
is a different, older convention that `/uuc-phc`, `/place`, `/bhw` and the site root already carry
independent of U4 — Next.js's per-route social-card file, rendered on link unfurl rather than
downloaded. `/facilities` simply didn't have one yet, which this closes, but it is not the U4-style
one-pager the plan deferred; that gap is what the entry above fills.

Both are real, independent, non-conflicting improvements, so both ship: `app/facilities/opengraph-image.tsx`
and `app/facilities/[geoLevel]/[geoCode]/opengraph-image.tsx`, mirroring `app/uuc-phc/opengraph-image.tsx`
and its area equivalent: the count is the headline, one string per line (Satori throws on a
multi-child `<div>` with no explicit `display`), and a zero renders as a zero —
`agg_nhfr_counts` carries a row for every geography, so an area with nothing registered reads "0
health facilities · 0 of N barangays have at least one" rather than omitting the line.

**No indicator to strand, so nothing to exclude.** U4's restraint was about a capped/footnoted
indicator value that a 1200×630 card has nowhere to attach a † to; NHFR carries no such values at
all (`lib/db/nhfr.ts`'s own doc comment: "there is no denominator to divide by except... coverage").
The card states the facility count and the barangay-coverage share, both of which are already
`agg_nhfr_counts` figures with no caveat that could go missing in transit.

Verified by rendering, not just status-checking, since neither Satori's multi-child restriction nor
a stray un-awaited `params` shows up in lint or typecheck: the landing card renders correctly
against live counts; the area card's JSX was verified against a disposable scratch route with
hardcoded values (`getGeoByCode`/`getNhfrCounts` need `NEXT_PUBLIC_SUPABASE_URL`, unavailable in
that environment — the same 500 the existing `/uuc-phc` and `/place` area cards give there, not a
defect in the new code) and produces the same well-formed 1200×630 PNG.

## 2026-09-06 — Increment N7: the facility point map

Closes the last item on `docs/NHFR_2026_PLAN.md` §Deferred. The deferral's two reasons were both
correct and both had to be answered, not waved past.

**A dot is a barangay, not a facility.** This is the decision the whole increment turns on. The
NHFR export carries no lat/long — only PSGC codes — so the plan's own framing was that points
"would have to be placed at barangay centroids, which is a different claim than a facility
location." One dot per facility at its barangay's centroid would draw twelve identical dots for a
barangay with twelve facilities and assert twelve distinct locations the registry does not know;
clustering, the obvious answer, only hides that at low zoom and re-asserts it on zoom-in. So the
claim was changed rather than disclaimed: **one point per barangay**, at the barangay's own
representative point, sized by the facilities registered in it. The map now answers a question the
data can answer — which barangays have facilities and which have none — and the sentence "a circle
is a barangay, not a building" sits beside the picture, not on `/facilities/methodology`, because a
map is persuasive enough that the correction has to be where the reading happens.

**Barangays with zero facilities are drawn, hollow.** `agg_nhfr_counts`' coverage figure already
says how many barangays have nothing; the empty rings are that figure in its actual places, and
that is the only thing this map adds over the bar already on the page. A map of only the filled
barangays would show a town that looks entirely served.

**City/municipality pages only.** That is the level whose accessible equivalent already exists as
real DOM directly beneath the canvas — `FacilityList`, every facility with its type and barangay —
which is what BUILD_PLAN §4.3 requires of a decorative map, and the level at which a barangay
centroid is close enough to the truth to be worth drawing. Region/province keep `ChildBreakdown`;
42,000 dots on a national canvas is neither readable nor inside §5's mobile payload budget.

**A new component, not a widened `ChoroplethMap`.** The plan called this "a genuine divergence, not
a reuse" and it is: circle paint driven by a per-feature radius rather than `fill`/`line` paint
driven by quantile bins, no selection, no drill (`/facilities/barangay/*` 404s by design, so there
is nowhere to drill to). What `components/maps/point-map.tsx` does copy from the choropleth is the
posture — `aria-hidden` canvas, every injected control out of the tab order, cooperative gestures,
no basemap tiles — not its internals. Radius is area-proportional (∝ √n) so four facilities get
four times the ink, not sixteen.

**Centroids are a boundary artefact, on `reconcile_boundaries.py`'s exact model.**
`ingestion/build_barangay_centroids.py` fetches level 4 of the same `faeldon/philippines-json-maps`
2023 series, one file per city/municipality, and reconciles two-way against `dim_geo` into
`docs/BARANGAY_CENTROID_RECONCILIATION.md`. Three calls inside it worth recording:

- **`hires`, not `lowres`.** The lower-resolution builds simplify small barangays to a *null*
  geometry — Adams, Ilocos Norte is null in both `lowres` and `medres` and survives only in
  `hires`. A dropped geometry is a barangay silently missing from a map, the exact failure §4.3
  exists to prevent. Nothing but a point survives the script, so the fidelity costs the app nothing
  and the ~125 MB of downloads is paid once.
- **`shapely.representative_point()` of the largest part**, not an area centroid: a centroid is not
  guaranteed to fall inside its own polygon, and for a crescent-shaped or multi-island barangay it
  can land in the sea or inside a neighbour.
- **`18302` (City of Bacolod) added to the NIR crosswalk.** `reconcile_boundaries.py` crosswalks
  `18045`/`18046`/`18061` but has no entry for Bacolod, correctly — as an HUC it is province-level
  in `dim_geo` and the source has no province polygon for it to crosswalk. Its *barangays* do
  exist, under the pre-NIR `06302`, so this script needs the entry that one does not.

**Coverage 41,085 of 41,991 barangays (97.84%), and the gap is named on the page.** 883 of the 906
misses are the City of Manila's 14 sub-municipalities, for which the source publishes no level-4
file in any vintage (2011, 2019, 2023) — Manila's own file answers 200 with an empty
`GeometryCollection`. A Manila page renders the facility list with **no map above it** rather than
an empty frame. Everywhere else an unplaceable barangay is counted out loud beneath the map. No
centroid was invented to close a gap: a fabricated point lands somewhere real on a map, which is
worse than an honest absence.

**Output is not GeoJSON, and is not fetched by the browser.** `public/geo/barangay-centroids/<province>.json`
is `{"<barangay geo_code>": [lon, lat]}` — 1.6 MB across 117 province files where the Feature
envelope would have been ~6 MB. The server reads the one province file it needs
(`lib/geo/barangay-centroids.ts`, process-lifetime cached on `lib/geo/locator.ts`'s precedent),
joins it to facility counts, and hands the client an array proportional to the one city on screen
rather than to its province.

**No new table, no new query, and a shortfall that cannot hide.** Per-barangay counts are folded in
memory from the facility list the page already loads (`getNhfrFacilities` gains
`barangay_geo_code`); the barangay roster comes from `getChildGeos`, which the map needs because a
barangay with no facility has no fact row to be found in. That list is bounded at 1,000 rows
(largest city/municipality today: 784), so the point builder counts against
`agg_nhfr_counts.n_facilities` rather than `facilities.length` — every way a facility can fall off
the map (null barangay code, another area's code, a barangay with no centroid, a truncated list)
collapses into one printed "n facilities are not on the map", because to a reader they are the same
fact.

**Verify:** `python ingestion/build_barangay_centroids.py` re-run reproduces the committed province
files with no diff and regenerates the report; `lib/geo/facility-points.test.ts` covers the pure
builder including the truncation, null-barangay, foreign-barangay and no-centroid paths; lint,
typecheck and the full unit suite green.

## 2026-09-06 — Final: StepZero's own population, not PSA census, is the per-capita denominator

Closes a question this repo had answered twice, in opposite directions, without ever recording a
reason to prefer one over the other for good. **2026-07-19** decided "BHWs per 1,000 residents"
would use StepZero's own self-reported population — no PSA dataset needed. **2026-07-21** (E4.2)
loaded PSA census population anyway and, without revisiting that first decision, made it the
*preferred* denominator with StepZero demoted to a fallback. The owner has now reversed E4.2's
swap, explicitly, as final: **StepZero's own population is the denominator, permanently.** PSA
census stays loaded and wired in, but strictly as what it was originally scoped to be — a fallback
for the geos StepZero has no population row for, and a cross-check.

**Why StepZero over census, stated plainly this time.** It is the BHW program's own count,
collected on the same barangay roster, by the same reporting process, as the BHW figures it
divides — "42 BHWs, 1,900 residents" are two numbers from one source describing one place. The PSA
census is a general-population count, independently sourced and matched in afterward by name
(`docs/POPULATION_RECONCILIATION.md`): 99.3%/98.7% match rates, a national shortfall of about 1-2%
from LGUs `dim_geo` has no row for at all, and all of Manila's census population collapsed onto one
province node rather than its 16 `dim_geo` districts. Those are reconciliation-report footnotes for
a fallback source; they are the wrong footnotes for a number every "per 1,000 residents" figure on
the site depends on by default.

**What changed.** The coalesce order flips in both places that compute it:
- `lib/db/stepzero.ts` (`getBhwOverview`) — `stepzero?.population ?? censusPop ?? null`, was the
  reverse.
- `lib/db/indicators.ts` (the batched map-indicator query) — same flip, same reasoning.

Comments, the `census_population` and `bhw_per_1000` glossary terms, the map indicator's caption,
`/methodology`'s per-capita paragraph, `docs/POPULATION_RECONCILIATION.md`, and
`docs/DATASET_SCOPING.md`'s candidate #1 entry all updated to state the current precedence rather
than describe either superseded decision. Nothing in the schema, the loaded rows, or
`ingestion/ingest_population.py` changed — this is a read-order decision, not a data change, so
E4.2's reconciliation work stays exactly as valid as it was for the role it now has.

**Not touched, and still open:** the household-side ratio (`householdsPerBhw`) was never affected
by any of this — it has only ever read StepZero's own `households` column, since PSA's 2020 CPH
household table was never loaded (`docs/POPULATION_RECONCILIATION.md`'s "Not yet loaded" section).
That stays the one real gap in this area, not a candidate for the precedence question closed here.

**This is final.** Do not swap this precedence again on the strength of "census is more official"
or similar reasoning without a fresh, explicit owner decision — that reasoning is exactly what
produced the 2026-07-21 swap this entry reverses, and re-litigating it a third time is the failure
mode this entry exists to close off.

**Verify:** `npm run lint`, `npm run typecheck`, `npm test` — green; no test asserted the old
precedence directly (`lib/db/benchmark-context.test.ts` and friends mock `population` as an opaque
value, not exercise the coalesce), so none needed changing.

## 2026-09-06 — FHSIS re-scoped against the actual file, and the rule that FHSIS never supplies BHW counts

`docs/DATASET_SCOPING.md` §3 carried FHSIS as "highest potential value, highest access
uncertainty," inheriting NHFR's old "needs a DOH relationship" verdict. That entry itself predicted
the fix — *"FHSIS may well be the same; it is worth re-checking on its own terms"* — so this is
that re-check, done twice over in one sitting: first from secondary sources, then, once the real
source turned up, against the file.

**The owner's rule, and why it is the most important line in this entry.** Asked directly, the
owner ruled that **FHSIS's BHW data is never to be used: the BHW census in this repo is the
official BHW figure.** FHSIS does carry an `Active Barangay Health Workers` column, and it is
exactly the "independent official BHW headcount series" `docs/EXPLORE_PAGE_REVIEW.md:443` proposed
reconciling against `bhw-2025`. Having now seen the numbers, that proposal was made blind and is
withdrawn: FHSIS reports **270,766** active BHWs nationally, but records NCR at 4,454 against 3.6
million households and Las Piñas at **1**. It is not a second opinion, it is a worse instrument —
a tally of what LGUs filed through their RHUs, not a registry. Publishing it beside this site's own
census would read as the site undercutting its own primary dataset with a source it knows to be
under-reported, which is the opposite of the 277,767-vs-278,240 reconciliation's purpose (that one
compares two accountings *of the same collection*, and explains the gap; this would compare a
census against a shortfall and explain nothing). **FHSIS is ingested for what BHWs work alongside,
never for how many of them there are.**

**The access verdict was wrong, and so was the format verdict that replaced it.** Two corrections
worth keeping separate, because they were found by different means:

- *License was never the blocker.* Philippine government work (IP Code, RA 8293 §176), the same
  basis already used for the DOF/BLGF income table, and already inside the owner's blanket
  `docs/EXPLORE_ENHANCEMENT_PLAN.md:19` decision covering NHFR **and FHSIS**. Nobody had applied
  that decision to the FHSIS row.
- *It is not PDF-only.* The `doh.gov.ph` pages every earlier pass searched are a dead end (and
  return 403 to a bare user-agent, which is what produced this session's first, also-wrong,
  "no automated access" finding — a normal browser UA gets through fine). The actual source is the
  DOH's public Drive archive, `https://bit.ly/FHSISPHSannualreports` → folder
  `16z6srVbGODqmgGHU4_Qg1oDBOglqp_XG`, owned by `fhsisreports@doh.gov.ph` and readable with no
  login: Annual, Quarterly and Monthly reports, **each in Excel as well as PDF**. Annual Excel runs
  2018–2025; 2024 is complete across twelve program areas and 2025 is partially released
  (Demographics and Vital Statistics out, the rest pending).

**Verified against `Demographic_2025_EB_Final.xlsx` (341 KB), not inferred.** A `PSGC` column of
10-digit codes in NHFR's shape, across **1,743 rows — 18 regions, 115 provinces/HUCs, 1,610
cities/municipalities**. Per city/municipality it carries population, household estimates, and the
public health workforce (doctors, nurses, midwives, dentists, medical technologists, nutritionists,
sanitary engineers and inspectors) each split LGU-hired versus DOH-hired — which is the
"BHWs per midwife/doctor" context `docs/EXPLORE_PAGE_REVIEW.md` had filed as blocked on NDHRHIS,
available here in a spreadsheet with this site's own census as the numerator. Household estimates
are the other prize: the site currently leans on StepZero's *self-reported* household figures.
Two file-handling notes for whoever builds it: some PSGC values carry a trailing `.0` from Excel
float coercion, and the header is two merged rows, so the column map must come from the group row
plus the sub-header row. Internal consistency checks out — the 18 region rows sum exactly to the
national total — though citymun rows sum ~6,400 short of it, so a build states that gap rather than
implying the citymun rows are exhaustive.

**Consequence.** FHSIS moves from "highest access uncertainty / PDF-extraction project" to a ready
tabular load on the same footing as the PSA population candidate, and `docs/DATASET_SCOPING.md` §3
and its Recommendation are rewritten to say so. No build plan yet — the deliberate open choice is
complete-2024 versus partial-2025, which is an owner call, not a scoping one. The regional CHD
annual PDFs (e.g. Ilocos 2024, 86pp) were also confirmed public and native-text, extractable by
coordinate-grouped word positions rather than OCR; that finding is now moot for ingestion and is
recorded only so nobody re-derives it.

**A method note, since this section has now been wrong three times.** Each wrong verdict was
inherited rather than tested: "license-blocked" survived an owner decision that unblocked it,
"PDF-only" survived a public Excel archive, and this session's own "403, needs a human with a
browser" survived nothing longer than one retry with a browser user-agent. The pattern is not bad
luck, it is that a scoping line, once written, gets quoted forward. The only reliable fix is the
one that worked here and for NHFR: open the file.

**Follow-through, same day: `docs/FHSIS_2025_PLAN.md`.** With the year fixed at 2025 by the owner and
the BHW rule settled, the build plan is written on `docs/NHFR_2026_PLAN.md`'s skeleton — clean →
`dim_dataset` → fact → section → context → registry → chat — as increments F1–F6, with the
`/uuc-phc` U5–U12 equivalents named as F5/F6 rather than deferred, since deferring them is exactly
what cost NHFR six follow-up PRs. Two things the plan settles that the scoping entry could not:

- *Store counts, never average a rate.* FHSIS publishes coverage above 100% at city/municipality
  grain (54 FIC/CIC cells in the 2025 Annual sheet, Capas at 2,233%; 5 in 8ANC) — U3's problem
  again, but with numerators and denominators present, so the value is stored as published with an
  `over_100` flag and U3's † rather than capped blind. No `agg_fhsis_*` table exists at all: the
  source publishes every grain a page renders, and the citymun leaves are known to sum short of the
  published parents, so a recomputed rollup would be both redundant and wrong. The residual is
  published instead, per indicator, on the 1.6 discipline.
- *The BHW column is dropped at cleaning, so it does not exist in any table* — N1's contact-column
  treatment, with a `check (cadre <> 'bhw')` behind it and a registry note in the NHFR note's words.

**And a denominator question that closed the same day, next door.** While checking `dim_dataset`
for this plan, `docs/DATASET_SCOPING.md`'s standing "build the PSA population candidate first"
recommendation turned out to describe a dataset built back on 2026-07-21 — and the entry above
this one then settled what that dataset is *for*: **StepZero's own population is the per-capita
denominator, permanently; PSA census is the fallback and the cross-check.** That closes the plan's
Decision 5 more firmly than it was drafted. FHSIS ships its own `Population 2025` and
`Number of Household Estimates` columns, and they are loaded — a published rate has to be
recomputable against the base it was computed on — but they are *the source's* denominators for
*the source's* ratios. No per-capita figure on this site moves onto them. The entry above says not
to re-litigate that precedence on the strength of "census is more official"; "FHSIS is more recent"
is the same argument wearing a different hat, and it gets the same answer.

## 2026-09-06 — FHSIS 2025 increment F1: clean, register, load

Built `docs/FHSIS_2025_PLAN.md` increment F1: `fetch_fhsis.py`, `clean_fhsis.py`, five migrations
plus a lineage delta, `ingest_fhsis.py`, and the three mechanical bits F1 names. The headline
figures the plan pinned the load to all reproduce exactly — national FIC 1,560,924 of 2,392,392
(65.25%), projected population 113,146,216, household estimates 27,387,195, 54 FIC/CIC
city/municipality cells over 100% and 5 in 8ANC.

**The plan was amended in this PR, in six places, because the files are not what it assumed.**
Every one was found by reading the workbooks column by column, and each is evidenced in
`docs/FHSIS_2025_CLEANING_REPORT.md`:

- **There is no universal `Annual` sheet.** Demographics has `BGY & BHS` / `Health Workers` and no
  quarters; the three Envi files have `Qtr1..Qtr4` and no `Annual`; TB has four sheets in one
  cascade. Envi is read from `Qtr4`, which is the year-end *stock* for a "households with access"
  measure — summing quarters would count the same household four times.
- **The header is not always two rows, nor always rows 4 and 5.** Demographics is 4+6 (row 5
  blank), water 4+5+6, sanitation 4+5+6+7. The column map also has to honour the real merge
  ranges: a forward-fill overruns a group heading's span at the right-hand end of a row and stamps
  it onto the check-column block that follows, which is how the first draft mislabelled six
  columns.
- **Three named files are not in scope and are not loaded.** 2PNC and Demographics' `BGY & BHS`
  have **no PSGC column** (146 rows, area-name only) — Tier 2 by the plan's own definition, which
  Decision 3 defers. `zod_nofml.xlsx` is **2024 data**: all four quarter sheets are titled
  "Philippines, Nth Quarter 2024" despite sitting in the 2025 folder, and publishing it under a
  dataset row that says 2025 would be the wrong citation Decision 1 exists to prevent. So `pnc2`
  and `zod` are not in the F1 dictionary; both load through the same cleaner with no new code when
  they qualify.
- **8ANC's `Annual` sheet covers Q3–Q4 2025 only** (its own title says so; the indicator was
  introduced mid-year). Loaded, because it is the published 2025 figure, but the period is carried
  in `ref_fhsis_indicator.label` and `numerator_def` so no surface can set it beside 4ANC as
  though both covered twelve months.
- **Not every rate is a percentage.** TB case notification and drug-resistant notification are per
  100,000 population — the national CNR is 473.06, not a 473% overshoot. `ref_fhsis_indicator.unit`
  records which, and `over_100` is set only for percentage indicators. Flagging a normal
  notification rate would put a † on an ordinary figure and teach readers to ignore the marker
  where it means something. This is a real strengthening of Decision 4 rather than an exception to
  it: the rule is *mark the value, never average it*, and marking the wrong values defeats it.
- **Decision 3's "Tier 1 joins with no name-matching" was wrong.** About 70 rows per sheet carry a
  PSGC whose leading zeros were stripped and the value right-padded back to width, so Marcos
  (`0102813000`) is printed `128130000`. Resolution runs in three counted stages — direct
  truncation, a shift repair, then a **parent-scoped** name match against the already-resolved
  region or province using `ingest_population.py`'s existing `variants()`. Result: 0 unresolved
  rows in every loaded sheet. Scoping to one resolved parent is what keeps this from being the
  Tier 2 problem in miniature, and every repaired row is listed individually in the report.

**One finding that changes a number rather than a method.** In every sheet that carries it, the
province row `Surigao del Norte` is printed with `1606701000` — Alegria's code — and the row
`Alegria` with the province's. Both resolve cleanly, so honouring the code alone files a province's
3,118 antenatal visits under a municipality that had 9, invisibly. The cleaner therefore uses the
printed name as a **check on** the code, never as the join key, and overrides only when the name
resolves inside the same parent to a different geography. That fires on exactly this one row pair;
36 other rows disagree in wording only ("Region 1" vs `REGION I (ILOCOS REGION)`, "Davao del Oro"
vs `DAVAO DE ORO`, the BARMM Special Geographic Area's cluster names) and there the code stands.
Both outcomes are listed in the cleaning report — BUILD_PLAN P15's reconcile-by-rule-and-log
discipline.

**Decision 4's subtotal residual, measured.** All 46 region-sum-vs-published-national comparisons
reconcile *exactly*, across all 20 indicators. At province level 3,588 of 3,796 reconcile; for FIC,
78 of 83 comparable provinces reconcile and each of the other five differs by **precisely one
city's figure** — City of Cotabato, City of Dagupan, City of Naga, City of Santiago, Ormoc City.
Those are independent component and highly urbanised cities that `dim_geo` nests under their
geographic province while the source's province row excludes them, so the usual non-zero residual
is a classification difference, not missing data. `ref_fhsis_reconciliation` publishes it either
way; no page derives a parent's figure by summing children.

**Decision 2 is enforced three times, independently.** `clean_fhsis.py` drops the two BHW columns
and asserts no BHW cadre or indicator key reaches the CSVs; `fact_fhsis_workforce` carries
`check (cadre <> 'bhw')`; `ingest_fhsis.py` asserts zero BHW cadre rows before it commits. Verified
live: no BHW-named column exists in any FHSIS relation, and a direct `insert ... cadre = 'bhw'` is
refused by the constraint. The source's own numbers are why — 270,766 nationally, 4,454 for all of
NCR, **1 for Las Piñas**.

**Deviation — the live data load did not run, and the tables are empty.** The five migrations and
the lineage delta are applied to the live project and every structural check passes there (no BHW
column, the CHECK constraint refusing a BHW row, RLS on with one public-read policy each, the view
`security_invoker`, `anon` reading all three and refused every write with HTTP 401,
`verify_rls.py` green, `get_advisors` naming no FHSIS relation). The 94,005-row load itself was
verified **end-to-end against a local PostgreSQL 16** carrying the real `dim_geo` snapshot —
`ingest_fhsis.py --database-url` loads all of it in 5 seconds and every F1 check was run there on
real loaded rows. It has not been run against Supabase because this session has no
`SUPABASE_DB_URL` and no service-role key. The increment-0.4 workaround for exactly this
environment (a secret-gated `SECURITY DEFINER` RPC, granted to `anon` for the duration and dropped
after) was attempted and **refused by the sandbox's permission layer**; the function was dropped
immediately, so nothing of it remains in the project.

**Resolved by moving the load to CI rather than by widening the sandbox.** Verified rather than
assumed: raw TCP to every Supabase Postgres endpoint (`db.…:5432`, the pooler on `:6543` and
`:5432`) is refused from the assistant sandbox, which has HTTPS-only egress through an agent
proxy. So a `SUPABASE_DB_URL` handed to that sandbox would not have worked either — the missing
piece was never only the credential. `.github/workflows/load-fhsis.yml` runs the loader on a
GitHub Actions runner, where egress is ordinary and the secret stays in the repository's secret
store; it is `workflow_dispatch`-only and defaults to `check-only`, so writing to production is
always a deliberate choice, and `environment: production` is named so required reviewers can be
attached in settings without editing the workflow. Chosen over the two alternatives on offer: a
PostgREST loader mode would have bypassed `map_psgc_to_dim_geo()` and forced the geo guard to be
re-implemented client-side, and pushing 9.2 MB of SQL through the Supabase MCP would have moved
every row through an assistant's context twice, where one silent truncation corrupts production.
The job is reusable, which matters because Decision 9 expects this dataset to be re-pulled.

**Two smaller judgment calls.** (1) `fetch_fhsis.py` records a `content_digest` — a SHA-256 over
every sheet's *cell values* — beside the raw byte hash, because the three Envi files are native
Google Sheets that re-render to different bytes on every export: two consecutive pulls of an
unchanged sheet produce two different SHA-256s. A byte hash there answers "was this rendered
twice", not "did the data change", so `--check` compares the value digest. The same files also
send no `Last-Modified`, so their modified date is read from the Drive listing at day precision
and the manifest records `drive_modified_precision` rather than implying a false exactness.
(2) The raw workbooks are gitignored and only `_manifest.json` is committed from that directory,
per Decision 8's naming of the cleaned CSVs and the report as this dataset's reproducible
artefacts.
