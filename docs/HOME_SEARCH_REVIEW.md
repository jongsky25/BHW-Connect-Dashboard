# Home Page & Search Flow Review — Enhancement Plan

A three-lens review (designer · lay person · epidemiologist) of the home page, its "find my barangay" search, and the place profile page the search routes to — concluding in a prioritized enhancement plan that builds on the current pages.

**Status:** reviewed 2026-07-20 against `main` (`e9f4068`). This document proposes; it does not change code. Individual items should land as their own increments with the usual verify steps.

## 1. Scope & method

Surfaces reviewed, following the primary user journey (land on home → search a locality → read its profile):

| Surface            | Files                                                                                                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home page          | `app/page.tsx`, `components/home/stat-hero.tsx`, `components/home/stat-tile.tsx`, `components/home/mini-viz.tsx`, `components/insights/insights-grid.tsx`                                                   |
| Geo search         | `components/home/geo-search.tsx`, `app/api/geo/search/route.ts`, `lib/db/search.ts`, `supabase/migrations/20260719140000_search_geo_function.sql`, `ingestion/build_aggregates.sql` (§8, `agg_geo_summary`) |
| Place profile page | `app/place/[geoLevel]/[geoCode]/page.tsx`, `components/place/profile-header.tsx`, `components/narrative/figure-card.tsx`, `components/explore/*-figure.tsx`                                                 |

Each lens reads the same flow with a different question:

- **Designer** — is the interface legible, honest about state, and free of friction?
- **Lay person** (a BHW, their family, an LGU staffer) — can I find _my_ place and understand what I see without training?
- **Epidemiologist** — are denominators, comparators, and completeness handled the way a technical reader needs?

Findings **build on** `BUILD_PLAN.md` commitments — free-tier hosting, WPSAR figure contract, WCAG 2.1 AA, performance budgets, URL-as-state — and nothing below proposes violating them. Filipino/Tagalog localization was considered and explicitly ruled **out of scope** for this plan (plain-language and glossary fixes remain in scope).

### What already works well (keep these)

- The WPSAR Person/Place/Time caption discipline on every figure (`FigureCard`), including the honest "2025 snapshot" time framing.
- Small-cell suppression with roll-up links ("See the roll-up at _province_") on demographics.
- Template layman headlines on every figure, so the page never depends on AI availability.
- Typo-tolerant search ranking (`websearch_to_tsquery` + `pg_trgm word_similarity`, FTS boosted above fuzzy) — the retrieval layer is solid; the problems are in what gets _returned and rendered_.
- Deep-linkable place pages with per-geo metadata/OpenGraph.

## 2. Designer review

### Search interaction

- **D1 — Results push the page down (layout shift).** The results `<ul>` renders in normal flow (`components/home/geo-search.tsx:79`), so every keystroke that opens/closes the list shifts the KPI grid below it. Dropdowns over content should be absolutely positioned within a relative wrapper.
- **D2 — No pending state.** Between the 250 ms debounce and the response there is no spinner/skeleton; the UI is indistinguishable from "nothing happened."
- **D3 — Errors masquerade as empty results.** The `catch` path sets `results: []` and `hasSearched: true` (`geo-search.tsx:46-51`), so a network failure renders **"No matching places found."** — a false negative presented with full confidence (see also L-lens: a user concludes their barangay isn't covered).
- **D4 — The dropdown never closes.** No blur, outside-click, or Escape handling; the list stays open until the query is cleared.
- **D5 — Undersized primary CTA.** Search is the hero's only action but is a plain `max-w-md` input with no search icon, no example queries, and no visible label (the label is `sr-only`; the placeholder disappears on typing).

### Home layout

- **D6 — The most important caveat is a footnote.** The two-denominator explanation (StepZero headcount vs. validated profiles) lives in a `-mt-4 text-xs` paragraph below the KPI grid (`app/page.tsx:230-238`). It is the single most confusing thing on the page and the least visually weighted.
- **D7 — Uneven KPI grid.** Five cards in a 3-column grid yields a 3+2 layout with no intentional hierarchy beyond `StatHero` being first.
- **D8 — "Enlarge ⤢" is low-discoverability.** The affordance is small muted text (`components/home/stat-tile.tsx:138`); the whole-card click target is good, but nothing signals interactivity until hover.
- **D9 — Honorarium fatigue.** Three honorarium figures (`HonorariumFigure`, `HonorariumAmountFigure`, `HonorariumDistributionFigure`) stack back-to-back with identical card rhythm (`app/page.tsx:244-246`); they read as repetition rather than one story told three ways.

### Place page

- **D10 — Dead end: no search on the place page.** After landing on a place there is no way to search another one without going back to home. The header (`components/layout/header.tsx`) carries no search either.
- **D11 — Flat metadata line.** `profile-header.tsx:64-87` renders totals, coverage, per-1,000 and income class as an undifferentiated wrap of muted text — hard to scan, easy to misread as one sentence.
- **D12 — Quiet actions, mixed card density.** "Compare with other places" / "Explore full breakdowns" are ghost buttons easily missed (`app/place/[geoLevel]/[geoCode]/page.tsx:110-123`); the two big-number cards (Accreditation, Average years of service) sit inconsistently among chart cards.

## 3. Lay person review

- **L1 — Ambiguous results are the #1 failure of the journey.** Thousands of barangays share names — "Poblacion" exists in most municipalities, "San Isidro"/"San Jose" in hundreds. A search returns up to 8 visually identical rows ("Poblacion · Barangay") with **no parent city/province shown**. The data to fix this already exists: `agg_geo_summary.parent_chain` stores region/province/citymun names per geo (`ingestion/build_aggregates.sql:351`), but the `search_geo` function doesn't return it and `geo-search.tsx` doesn't render it. A user cannot pick _their_ Poblacion; worse, they can confidently pick the wrong one and read another town's figures.
- **L2 — Enter does nothing.** The input is not in a form and there is no keyboard selection: no arrow keys, no Enter-to-open-first-result, no ARIA combobox semantics (`role="combobox"`, `aria-expanded`, `aria-activedescendant`). Mobile keyboards show a "search"/go key that is a no-op.
- **L3 — No data signal in results.** The API returns `nTotal` per result (`lib/db/search.ts`) but the UI drops it. Users can't tell a place with 1,200 profiled BHWs from one with none until after they click through.
- **L4 — Search is the only path.** Users who can't spell their barangay (or only know "it's in Quezon province") have no browse route from home. A cascading selector already exists (`components/filters/geo-cascade.tsx`, used on `/explore`) but home doesn't link into it.
- **L5 — Jargon at first paint.** "Accreditation", "validated profiles", "StepZero", "LGU-declared", "honorarium", "N =" all appear above the fold with no inline help. The `GlossaryTerm` component (already used by `AiInsight`) is absent from home KPI captions.
- **L6 — Two totals, one screen.** "Total BHWs" and "Validated profiles" sit side by side with different denominators; the explanation is the D6 footnote. A lay reader sees two competing "how many BHWs" numbers.
- **L7 — Empty query state teaches nothing.** Before typing there are no example searches ("Try _Cebu_, _CALABARZON_, or your barangay") to demonstrate what the box accepts (region nicknames, misspellings tolerated, etc.).

## 4. Epidemiologist review

- **E1 — No comparators anywhere on the place page.** Accreditation %, average years of service, per-1,000 ratio, training coverage — all presented as bare values with no national/regional reference, no peer ranking, no direction ("is 62% accredited good?"). Comparison requires manually opening `/compare`. The first question a technical reader asks — _versus what?_ — is unanswered on every figure.
- **E2 — The per-1,000 gauge implies a target that doesn't exist.** The home gauge scales to `max(5, value × 1.5)` (`app/page.tsx:211`) — i.e., the needle always lands ~2/3 of the way regardless of the value. A gauge is read as progress-toward-a-norm; with an arbitrary max it is decorative at best and misleading at worst. Decision taken for this plan: benchmark against **national/regional averages computed from this dataset** rather than an external DOH ratio target. (The `Gauge` component's `bandMin`/`bandMax` reference-band props exist but are unused — evidence the need was anticipated.)
- **E3 — No child-geo drill-down.** A province page does not list its cities/municipalities; a region page does not list its provinces. Top-down navigation (national → region → province → city/mun → barangay), the standard way an epidemiologist scans for outliers — and the browse path lay users are missing (L4) — doesn't exist; navigation is bottom-up only (breadcrumbs) or sideways via search. Everything needed is already aggregated in `agg_geo_summary` (`geo_name`, `n_total`, `pct_accredited`, `top_training_gap`, `any_honorarium_pct`, `parent_chain`).
- **E4 — Search gives no data-availability warning.** Combined with L3: a user can land on a place with zero validated profiles and meet a wall of "No data available" cards with no upstream warning or automatic pointer to the nearest ancestor with data.
- **E5 — Completeness is computed but never shown.** `agg_data_completeness` (per-field missingness) exists in the schema and ingestion, but place pages surface only coverage % — not which fields are weak for the geo's records. A technical reader assessing, say, the education breakdown has no missingness context.
- **E6 — Export coverage is partial.** On place pages, Accreditation and the demographics figures wire up `ExportMenu`; Training, Honorarium, and Average-years do not (`training-figure.tsx`, `honorarium-figure.tsx` never render one). Home-page figures have no exports at all. For a "purpose-built downloads" product this is an inconsistency a researcher will hit immediately.
- **E7 — Denominator discipline is good — surface it better.** The captions correctly distinguish the StepZero universe from validated profiles, and per-person figures consistently use the profiled denominator. The problem is presentation (D6/L6), not correctness: promote the relationship into a small always-visible explainer ("270,917 profiled of ≈X registered of Y declared"), ideally as a simple bar/funnel diagram.

## 5. Prioritized enhancement plan

Effort: **S** ≤ half a day · **M** ≈ 1–2 days · **L** > 2 days. Each item is an independent increment; P0 items are deliberately DB-light and free-tier-neutral.

### P0 — Search trust & mechanics

| #   | Enhancement                                                                                                                                                                                                                                                                      | Fixes      | Effort | Touches                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------- |
| 1   | **Disambiguate results with the parent chain.** Return `parent_chain` from `search_geo` (new migration replacing the function) and render "Poblacion — Carcar, Cebu · Barangay". Parent line muted, place name emphasized.                                                       | L1, E4     | S      | new migration, `lib/db/search.ts`, `app/api/geo/search/route.ts`, `geo-search.tsx` |
| 2   | **Combobox semantics + keyboard support.** ARIA combobox/listbox pattern; ↑/↓ moves the active option, Enter navigates to it (or the first result), Escape and outside-click/blur close the list.                                                                                | L2, D4     | S      | `geo-search.tsx`                                                                   |
| 3   | **Overlay the dropdown; add pending and error states.** Absolutely-position the list under a `relative` wrapper (no layout shift); show a subtle loading indicator while a request is in flight; render a distinct "Couldn't search — check your connection" message on failure. | D1, D2, D3 | S      | `geo-search.tsx`                                                                   |
| 4   | **Show data availability per result.** Display `nTotal` ("1,234 BHWs profiled") and a muted "no profile data yet" badge when it is null/0.                                                                                                                                       | L3, E4     | S      | `geo-search.tsx`                                                                   |
| 5   | **Search from anywhere.** Reuse `GeoSearch` as a compact variant on place pages (in or under `ProfileHeader`) so the journey never dead-ends.                                                                                                                                    | D10        | S      | `geo-search.tsx` (variant prop), `app/place/[geoLevel]/[geoCode]/page.tsx`         |
| 6   | **Teach the empty state.** Under the input (pre-typing), example chips: "Try _Cebu_ · _CALABARZON_ · your barangay", plus a "or browse by location" link into the explore cascade.                                                                                               | L7, L4     | S      | `geo-search.tsx`, `app/page.tsx`                                                   |

### P1 — Orientation & benchmarks

| #   | Enhancement                                                                                                                                                                                                                                                                                                                       | Fixes          | Effort | Touches                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------ | ---------------------------------------------------------------------------- |
| 7   | **"Places within" drill-down table on place pages** (national/region/province/citymun): child geos with BHW count, % accredited, top training gap, any-honorarium % — sortable, linking to each child's page. Powered entirely by `agg_geo_summary` (one query per page; consider pagination only at the citymun→barangay level). | E3, L4         | M      | new `lib/db` query + `components/place/children-table.tsx`, place page       |
| 8   | **Benchmark strip on place figures.** For each headline indicator, show the same indicator at the region and national levels ("This place 62% · Region VII 71% · Philippines 68%"), reusing the existing `lib/db/indicators` queries at ancestor geos (already fetched cheaply; ancestors are known from breadcrumbs).            | E1             | M      | place page, `figure-card.tsx` (optional `benchmark` slot)                    |
| 9   | **Replace the per-1,000 gauge with a comparator.** Drop the arbitrary-max gauge; show the place's ratio against regional and national ratios (small labeled bar/dot comparator). Applies to the home tile (national context: show the distribution across regions instead) and the place header figure.                           | E2             | M      | `app/page.tsx`, `mini-viz.tsx` (new comparator visual), `profile-header.tsx` |
| 10  | **Promote the two-denominator story.** Replace the D6 footnote with a compact explainer card (funnel: declared → registered → profiled, with counts), and wrap first-use jargon on home KPI captions in `GlossaryTerm`.                                                                                                           | D6, L5, L6, E7 | M      | `app/page.tsx`, new small component, glossary entries                        |
| 11  | **Structure the place header.** Convert the flat metadata line into labeled stat chips (Total BHWs · Profiled (coverage %) · per-1,000 · income class) and give Compare/Explore primary-action weight.                                                                                                                            | D11, D12       | S      | `profile-header.tsx`, place page                                             |

### P2 — Depth & polish

| #   | Enhancement                                                                                                                                                                                                                      | Fixes  | Effort | Touches                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ | ------------------------------------------------------------------ |
| 12  | **Locator-map thumbnail on place pages** (where the place sits within region/country), building on the Phase 1.6 boundary pipeline; ranked-list fallback per BUILD_PLAN §4.3.                                                    | D11    | L      | `components/maps/*`, place page                                    |
| 13  | **Complete export coverage.** `ExportMenu` on Training, Honorarium, and Average-years place figures and on home-page figures; verify each export route supports the indicator.                                                   | E6     | M      | `training-figure.tsx`, `honorarium-figure.tsx`, place & home pages |
| 14  | **Surface completeness.** A "Data quality" note/card on place pages fed by `agg_data_completeness` (worst-missing fields), linking to `/data-quality`.                                                                           | E5     | M      | new `lib/db` query, place page                                     |
| 15  | **Recent searches** (localStorage, client-only) shown on focus before typing; periodically review `usage_events` search logs for zero-result queries to tune ranking.                                                            | L7     | S      | `geo-search.tsx`                                                   |
| 16  | **Home information architecture.** Group the three honorarium figures under one tabbed/segmented card ("Who receives · How much · Distribution"); rebalance the 5-tile KPI grid (e.g., hero spans full width on top, 2×2 below). | D7, D9 | M      | `app/page.tsx`, small wrapper component                            |

### Suggested sequencing

P0 is one coherent increment ("search you can trust") and should ship together — items 1–6 are individually small and mutually reinforcing. P1 items 7–8 deliver the largest analytical value per effort and can follow independently. Item 9 depends on deciding the comparator visual (see item 8's pattern). P2 rides behind existing roadmap work (maps, exports).

## 6. Out of scope / decisions taken

- **Filipino/Tagalog localization** — considered, explicitly excluded from this plan by product decision. Plain-language captions + glossary coverage (items 6, 10) carry the lay-audience burden instead.
- **External DOH staffing-ratio targets** (e.g., household-per-BHW norms) — not adopted; benchmarks use national/regional averages computed from this dataset (item 9), which are defensible without citing a contested external standard.
- **Search backend changes beyond the return shape** — ranking (FTS + trigram) reviewed and found sound; no re-ranking work proposed.
- Anything requiring paid infrastructure — all items above run on the existing free-tier stack and precomputed aggregates.
