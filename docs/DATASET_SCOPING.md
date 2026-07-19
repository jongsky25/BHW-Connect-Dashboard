# Dataset scoping — candidates for dataset #2

**Status:** proposal, not yet built. BHW Connect's `dim_geo`/`dim_dataset` schema (§4.1 of the build
plan) was designed as shared infrastructure for more than one Philippine public-interest dataset —
this document is the first pass at picking what comes next, per §8 2.6.

Every candidate below is scored on the same three things that actually determine whether it's
buildable on this stack: **license** (can we redistribute derived aggregates under CC BY, same as
`bhw-2025`?), **geo-join** (does it key on PSGC the way `dim_geo` already does, or does it need a
crosswalk?), and **update cadence** (does staying current mean a one-time load or ongoing scraping
work?).

## Candidates

### 1. PSA Census of Population and Housing (barangay population) — recommended

- **What it adds:** population counts per barangay/citymun/province/region. On its own this isn't
  a BHW dataset — its value is entirely as a **denominator**: "BHWs per 1,000 residents" is a much
  more comparable figure across places of wildly different size than a raw headcount, and it's the
  single most-requested kind of context missing from Phase 1 (a barangay captain today can see
  "42 BHWs here" with no sense of whether that's a lot for the place).
- **License:** PSA's OpenSTAT platform publishes under an open-data license — free to use, reuse,
  and redistribute, consistent with the CC BY 4.0 already used for `bhw-2025`.
- **Geo-join:** keys on PSGC, the same code system `dim_geo` already stores (padded to the same
  fixed widths per §3). This is the only candidate here with a join that's expected to be close to
  friction-free — no crosswalk work like the boundary-file vintage mismatch hit in 1.6.
- **Update cadence:** a full Census of Population and Housing runs roughly once a decade (2020 was
  the most recent), with the possibility of a mid-decade update. A one-time load per publication,
  not an ongoing sync — the cheapest candidate to keep current.
- **Effort:** low. Straightforward tabular data, one `agg_*`-style table
  (`agg_population` or folded into `agg_geo_summary`), and one new field on every relevant figure
  ("X per 1,000 residents") rather than a whole new page.

### 2. DOH National Health Facility Registry (NHFR)

- **What it adds:** the master list of health facilities (hospitals, RHUs, barangay health
  stations) with type, level, and location — would let BHW Connect show local health
  infrastructure alongside the BHW workforce that staffs it.
- **License:** unclear. The public NHFR site (`nhfr.doh.gov.ph`) exposes a facility list and lets
  an anonymous visitor filter and export to Excel, but nothing found in this pass states a formal
  reuse/redistribution license the way PSA's OpenSTAT does — would need a direct written
  confirmation from DOH (or an FOI request, as several other agencies' datasets on `foi.gov.ph`
  already require) before publishing derived aggregates under CC BY.
- **Geo-join:** facilities carry a location, but it's not confirmed whether that's already a clean
  PSGC code or a free-text address needing geocoding — a real risk of repeating 1.6's boundary-
  vintage crosswalk problem, this time on facility addresses instead of polygons.
- **Update cadence:** NHFR is a live, continuously-updated registry (not a periodic publication),
  so staying current means either a recurring scrape/export or a formal data-sharing arrangement —
  meaningfully more ongoing effort than a census load.
- **Verdict:** promising content, but blocked on a license answer before any ingestion work starts.

### 3. DOH FHSIS (Field Health Services Information System)

- **What it adds:** facility- and program-level health service indicators (immunization coverage,
  maternal health service delivery, morbidity/mortality) — the richest candidate content-wise,
  and a natural fit alongside a BHW workforce dataset since BHWs are often the ones delivering
  these services.
- **License / access:** no public open-data download portal was found in this pass (DOH's 2025
  guidance, DM 2025-0104, formalizes FHSIS *collection and reporting* but doesn't describe a public
  release channel). Likely requires a direct DOH request, similar to how the `bhw-2025`/
  `bhw-stepzero-2026` source data itself was obtained rather than pulled from an open portal.
- **Geo-join:** unclear without seeing an actual extract — FHSIS is facility-based, so geo
  resolution likely depends on how cleanly facility → barangay mapping is captured.
- **Verdict:** highest potential value, highest access uncertainty. Worth pursuing only after (or
  alongside) an NHFR license conversation, since both would need the same DOH relationship.

### 4. PhilAtlas-style reference sites

- Not a dataset in the same sense as the three above — these are established reference/lookup
  sites for Philippine administrative geography and demographics, useful for **cross-checking**
  figures (e.g. sanity-checking a StepZero drift, as already done for the 277,767 vs. 278,240 DOH
  reconciliation in `/methodology`) rather than as a table to ingest and publish. No action item
  here beyond continuing to use them informally for QA, as the project already implicitly does.

## Recommendation

**Build the PSA population candidate first.** It's the only one with a confirmed open license and
a PSGC join that should require no new crosswalk work, it's a one-time load rather than an ongoing
sync, and "per-capita" framing is a genuine, frequently-requested gap in the current dashboard —
not a speculative nice-to-have. Suggested `dim_dataset` slug: `psa-population-2020`.

NHFR and FHSIS both stay on the roadmap as higher-value, higher-effort follow-ups once DOH access/
licensing questions are resolved — worth raising together, since both would go through the same
relationship.

## Also deferred (documented, not built) — per §8 2.6

- **Barangay-level map polygons (PMTiles).** Phase 1 ships city/municipality-level choropleths
  only (1.6, pitfall P11 — 39K barangay polygons don't fit the free-tier budget as flat GeoJSON).
  The upgrade path is PMTiles: pre-tiled, single-file vector tiles served as static byte-range
  requests (no tile server needed — Vercel's static hosting + a range-request-capable client
  library like `pmtiles`'s MapLibre protocol handler is sufficient), keeping the "free tiers only"
  constraint intact. This needs its own boundary-vintage reconciliation pass (like 1.6, but at
  barangay grain) before it's worth starting.
- **Open API design.** `/api/export/csv` already doubles informally as a public API for
  researchers (§4.4). A proper public API would mean: stable versioned routes under `/api/v1/`,
  documented query parameters (mirroring the existing filter codec in `lib/filters/schema.ts`),
  and a rate limit distinct from the per-session usage-event throttling used for chat (2.4) — sized
  for programmatic callers, not browser sessions. Not built here; flagged as a natural next step
  once there's evidence of real external demand (e.g. via the `/feedback` "suggest a dataset" flow
  this same increment updated `/roadmap` to invite).
