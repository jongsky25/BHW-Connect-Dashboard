# Home Page Redesign Plan

> **Status:** Approved plan — ready for execution.
> **Scope:** Home page (`app/page.tsx`) and the shared primitives it needs.
> This document is the execution hand-off: it names every file to create/modify,
> the design decisions behind them, and how to verify the result.

## Context

The home page opens with a strip of five KPI cards — Total BHWs, Validated
profiles, Accredited, Educational attainment, BHWs per 1,000 residents. Today it
reads as **crowded**: five columns are squeezed onto one row, and the native
`<details>` breakdowns render **expanded inline** — the 9-row Educational-attainment
list especially — turning the "national figures" band into a wall of small text.
Additional problems:

- Headline numbers use Tailwind's default `text-3xl` (**30px**), *not* the app's own
  larger `--text-3xl` token (**2.441rem ≈ 39px**) — figures are smaller than the design
  system intends (`components/home/stat-tile.tsx:20`).
- There is **no way to enlarge** a figure and **no way to switch a chart to a table**.
- The "Spotlight insight" surfaces **only one** insight per day (`lib/db/spotlight.ts`),
  hiding patterns that exist in every category.
- Chart value labels are rendered with **raw `${d.value}`** (`lib/charts/bar-chart.ts:27`)
  — e.g. `5000` instead of `5,000` — the missing-separator problem.

**Goal:** a more visual, less crowded home page where each metric leads with a big,
legible number plus one compact inline visual; any figure can be clicked to enlarge in a
modal that toggles between chart and table and exports; insights appear per-category; and
every number carries a thousands separator.

## Design direction (confirmed)

| Fork | Decision |
|---|---|
| KPI layout | **Hero + supporting grid** — one large "Total BHWs" hero, the other four as a supporting grid; breakdowns never expand inline |
| Per-card visuals | **Yes** — one compact viz per card (donut / mini stacked-bar / ladder bars / gauge) |
| Enlarge + toggle | **Full modal** — native `<dialog>` with backdrop showing enlarged figure + Chart/Table `ViewToggle` + export menu; reusable primitives |
| Insights | **Grid of per-category insight cards**, each computed from real aggregates |

## Design research applied

Patterns from Power BI KPI-card guidance, Setproduct/DataCamp dashboard design, and
Linear/Stripe/Vercel card-grid conventions:

- **F-pattern KPI strip** — strongest attention lands top-left; lead with the single most
  important number (Total BHWs) as a hero, supporting metrics in a scannable grid.
- **Card composition = label + big value + comparison + one small visual** (never three
  visuals). Add exactly one viz per card.
- **Progressive disclosure** — keep the surface clean; move breakdowns / granular data to
  on-demand enlarge (modal), not inline expansion.
- **Chart↔table toggle + drill-down modal** — every figure with tabular data gets a
  minimized on-page view and an enlarged modal with a view switch.
- Card grid `minmax(220px, 1fr)` so columns stay wide enough to hold a visual and never
  crush on mid-size screens.

Sources: [Tabular Editor — KPI card best practices](https://tabulareditor.com/blog/kpi-card-best-practices-dashboard-design),
[Setproduct — Dashboard UI design](https://www.setproduct.com/blog/dashboard-ui-design),
[DataCamp — Effective Dashboard Design](https://www.datacamp.com/tutorial/dashboard-design-tutorial),
[Pencil & Paper — Data dashboard UX patterns](https://www.pencilandpaper.io/articles/ux-pattern-analysis-data-dashboards).

---

## Work items

### 1. Shared primitives (new files)

**`lib/format.ts`** — centralize number formatting (removes duplicated inline helpers).

```ts
export const formatCount = (n: number | null) => (n === null ? "—" : n.toLocaleString());
export const formatPct   = (n: number | null) => (n === null ? "—" : `${n}%`);
export const formatPeso  = (n: number | null) => (n === null ? "—" : `₱${Math.round(n).toLocaleString()}`);
export const formatCompact = (n: number | null) => // 306,835 → "306.8K" for tight labels (Intl compact notation)
```

Replace the inline `formatCount`/`formatPct` in `app/page.tsx:13-19` and the `peso()` in
`components/explore/honorarium-amount-figure.tsx:15-17`. (Only the home-page call sites are
required now; app-wide consolidation of the other ~15 files that duplicate `toLocaleString`
is out of scope.)

**`components/ui/modal.tsx`** (`"use client"`) — reusable enlarge modal on the native
`<dialog>` element (React 19 supports it; no library needed — matches the repo's
"native elements over deps" convention).

```tsx
<Modal open={open} onClose={...} title="Educational attainment">{children}</Modal>
```

- `dialog.showModal()` / `close()` driven by `open`; backdrop via `::backdrop`.
- Close on `Escape` (native), backdrop click, and an explicit × button.
- Focus trap + focus restore come free with `showModal()`.
- Panel reuses the card recipe: `rounded-lg border border-border bg-background`,
  `shadow-xl`, `max-w-2xl w-full`, scrollable body. Model overlay behaviour on the existing
  `components/chat/chat-launcher.tsx` fixed-panel pattern.

**`components/ui/view-toggle.tsx`** (`"use client"`) — two-option segmented control
(Chart | Table) via `useState`, accent recipe (`bg-accent text-accent-foreground` active,
`text-muted` inactive), `role="tablist"` semantics, keyboard-navigable.

**`components/charts/figure-table.tsx`** — renders `BarDatum[]` (`{ label, value }`) as an
accessible `<table>` using the table styling from `app/data-quality/page.tsx:35`
(`w-full text-left text-sm`, `thead border-b border-border bg-surface`). Accepts an optional
`valueFormatter` prop so peso / % / count all separate correctly. Reusable chart→table body.

### 2. Fix missing thousands separators

- **`lib/charts/bar-chart.ts:24-31`** — the `Plot.text` mark uses raw `${d.value}`. Add an
  optional `valueFormat?: (n: number) => string` to `horizontalBarSpec` options, default
  `(v) => v.toLocaleString()`. Thread it through `BarChartClient`
  (`components/charts/bar-chart-client.tsx`) so all bar labels (honorarium ₱ amounts, counts,
  %) render separated; peso/percent figures pass their own formatter.
- Audit note: `app/page.tsx:151` (per-1,000) and education details (`app/page.tsx:60`)
  already separate correctly — the chart labels are the real gap, and fixing the spec covers
  all three home figures at once.

### 3. Enhanced KPI cards + hero layout

Rework `components/home/stat-tile.tsx` into a richer, client-capable card and add a hero
variant:

- **`components/home/stat-hero.tsx`** — large "Total BHWs" hero: value stepped up to
  `text-[3rem] sm:text-[3.5rem]`, label `text-base`, caption, plus a compact **stacked
  mini-bar** of the registration mix (Registered / Registered & accredited / Non-registered)
  using the `--seq-*` ramp. Spans 2 columns.
- **`components/home/stat-tile.tsx`** (extended) — supporting cards. Enlarge the number to
  `text-4xl font-semibold tracking-tight`, add a `visual?: ReactNode` slot and an
  `enlarge?: { title; chartData; tableData; valueFormatter; export? }` prop. Clicking the
  card (or an explicit "Enlarge ⤢" affordance) opens the shared `<Modal>` with the Chart/Table
  `ViewToggle` + export menu. **Remove the inline `<details>` expansion** so nothing crowds the
  strip.

Per-card inline visuals (each colorblind-safe, from `--seq-*`):

| Card | Big number | Inline visual | Enlarge modal content |
|---|---|---|---|
| Total BHWs (hero) | 306,835 | horizontal stacked mini-bar (reg mix) | bar chart / table of the 3 classes |
| Validated profiles | 270,917 | small donut (accredited vs not-yet) | bar / table |
| Accredited | 71.57% | **donut / radial gauge** at 71.57% | bar / table (accredited vs not) |
| Educational attainment | 78% | **9-rung horizontal ladder bars** (compact) | full ladder bar chart / table |
| BHWs per 1,000 | 2.7 | small **gauge** vs a reference band | context table (BHWs, population, ratio) |

Inline visuals stay tiny and non-interactive (pure SVG or a minimal Plot spec); the full
labelled version lives in the modal. Keep hero + 4 cards in a grid that is
`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` with the hero spanning 2, so columns never shrink
to the current 5-across crush. The layout wrapper in `app/page.tsx:119-159` changes from
`lg:grid-cols-5` to this composition; existing data (`overview`, `counts`, `edu`) already
provides everything — **no new queries for the KPI section**.

### 4. Chart/table toggle on the three home figures

The home figures (`CertificationFigure`, `HonorariumFigure`, `HonorariumAmountFigure`) all
wrap `BarChartClient` in a `FigureCard`. Add the toggle without breaking the server-component
figures:

- **`components/charts/figure-view.tsx`** (`"use client"`) — takes `data: BarDatum[]`
  (+ `valueFormatter`, labels), renders either `<BarChartClient>` or `<FigureTable>` behind a
  `<ViewToggle>`, plus an "Enlarge ⤢" button that opens the same view inside `<Modal>`.
- Swap each figure's `<BarChartClient .../>` child for `<FigureView .../>`. `FigureCard` is
  unchanged (it already accepts arbitrary `children` + an `exportMenu` slot); the enlarge
  control can live in its existing header/`exportMenu` area.

### 5. Per-category insights grid

Replace the single rotating spotlight with a grid computed from real aggregates:

- **`lib/db/insights.ts`** (new) — `getHomeInsights()` returning
  `InsightCard[] = { category, headline, caption, metricValue?, href? }`. Reuse the query
  bodies in `lib/db/spotlight.ts` (they already hit `agg_geo_summary` / `agg_training`) and add
  categories so **every** area is represented:
  - Accreditation — region with highest `pct_accredited`
  - Training — largest national training gap (lowest `coverage_pct`)
  - Honorarium — region with highest `any_honorarium_pct`
  - Geography — largest province by `n_total`
  - Education — national "HS graduate or higher" share (from `agg_demographics` education)
  - Workforce — national accreditation rate / per-1,000 headline

  Run them in one `Promise.all`; each returns `null` on empty and is filtered out (mirror the
  fallback logic in `lib/db/spotlight.ts:117-124`).
- **`components/home/insights-grid.tsx`** — renders the cards in
  `grid gap-4 sm:grid-cols-2 lg:grid-cols-3`, each card using the accent-subtle recipe from the
  current spotlight (`app/page.tsx:180-187`): uppercase category eyebrow, `text-base font-medium`
  headline, `text-xs text-muted` caption, optional deep-link to the relevant explore/place page.
  All numbers via `lib/format.ts`.
- Replace the `{spotlight && (...)}` block in `app/page.tsx:179-188` with
  `<InsightsGrid insights={insights} />`. Leave `getSpotlightInsight` in place (still used by
  the AI-insight rotation); do not delete it.

### 6. Typography / sizing pass

- Hero number → `text-[3rem] sm:text-[3.5rem]`; supporting cards → `text-4xl` (up from
  `text-3xl`). Labels `text-sm`→`text-base` where space allows; captions stay `text-xs text-muted`.
- Make the app's `--text-*` scale in `app/globals.css:30-37` actually reachable — reference the
  tokens directly or bump the Tailwind classes to match. Confirm contrast (accent teal is already
  WCAG AA) and that dark mode still reads (tokens auto-switch via `prefers-color-scheme`).

---

## Files to create / modify

**Create**

- `lib/format.ts` — shared number formatters
- `components/ui/modal.tsx` — native `<dialog>` enlarge modal
- `components/ui/view-toggle.tsx` — Chart/Table segmented control
- `components/charts/figure-table.tsx` — `BarDatum[]` → accessible table
- `components/charts/figure-view.tsx` — chart/table toggle + enlarge wrapper
- `components/home/stat-hero.tsx` — hero KPI card
- `components/home/insights-grid.tsx` — per-category insights grid
- `lib/db/insights.ts` — `getHomeInsights()` multi-category aggregate queries

**Modify**

- `app/page.tsx` — hero+grid layout (was `lg:grid-cols-5`), wire enlarge props, swap
  spotlight → insights grid, import formatters from `lib/format.ts`
- `components/home/stat-tile.tsx` — bigger number, `visual` slot, `enlarge` modal, drop inline
  `<details>`
- `lib/charts/bar-chart.ts` — `valueFormat` option, default `toLocaleString`
- `components/charts/bar-chart-client.tsx` — thread `valueFormat` through
- `components/explore/certification-figure.tsx`, `honorarium-figure.tsx`,
  `honorarium-amount-figure.tsx` — swap `BarChartClient` → `FigureView`, pass peso/%/count
  formatters

**Reuse (no change)** — `components/narrative/figure-card.tsx`,
`components/narrative/export-menu.tsx`, `lib/charts/palette.ts` (+ the `--seq-*` ramp),
`components/chat/chat-launcher.tsx` overlay pattern (modal reference),
`app/data-quality/page.tsx` table styling (table reference).

## Data notes

- KPI-section visuals need **no new queries** — `overview`, `counts`, `education` are already
  fetched in `app/page.tsx:66-73` and carry every value.
- Insights grid adds `getHomeInsights()` — reuses existing `agg_geo_summary` / `agg_training` /
  `agg_demographics` tables; all queries dataset-scoped via the existing `getActiveDatasetId()`.
- Keep the server/client boundary clean: data fetching stays in the server component
  (`app/page.tsx`); `Modal` / `ViewToggle` / `FigureView` are `"use client"` leaves that receive
  already-fetched, already-shaped data as props (charts already render client-side).

## Verification

1. `npm run dev` → load `/`. Confirm: hero + 4-card grid (no 5-across crush), numbers visibly
   larger, each card shows one inline visual, nothing expands inline.
2. Click each KPI card and each of the three figures → modal opens; `Escape` / backdrop / ×
   close it and focus returns; the **Chart/Table toggle** switches views; export links present.
3. Inspect a bar chart with large values (honorarium ₱ amounts) → **labels show thousands
   separators** (`₱5,000`, not `₱5000`).
4. Insights grid renders **multiple** category cards, each with a real headline/number; empty
   categories are dropped, not shown blank.
5. `npm run typecheck` && `npm run lint` clean. `npm run test` (vitest) passes; if the home page
   has an e2e spec under `e2e/`, run `npm run test:e2e` for the home flow.
6. Accessibility: keyboard-tab through cards / modal / toggle; screen-reader labels on donut and
   gauge SVGs (`role="img"` + `aria-label`, matching `BarChartClient`); check dark mode
   (`prefers-color-scheme: dark`) and mobile widths (`sm` / `lg` breakpoints).

## Out of scope

- App-wide consolidation of the ~15 other files that duplicate `toLocaleString` helpers
  (introduce `lib/format.ts` now, migrate them later).
- Any non-home route (explore / place / compare) — figures there keep `BarChartClient` until a
  follow-up adopts `FigureView`.
- New backend / aggregate tables; a dark-mode toggle; an animation library.
