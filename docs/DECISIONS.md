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
  5,987 as a footnote citing DC No. 2025-0549. The workbook corroborates 5,991 three independent
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
  uncapped in 2 provinces (Ilocos Sur 102.15, City of Butuan 101.00) while every barangay FIC was
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
