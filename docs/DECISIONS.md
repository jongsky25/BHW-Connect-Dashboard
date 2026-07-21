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
