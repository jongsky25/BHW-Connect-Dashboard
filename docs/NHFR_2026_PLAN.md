# NHFR — DOH National Health Facility Registry as dataset #6

## Context

`docs/DATASET_SCOPING.md` §2 names the DOH National Health Facility Registry as a high-value
candidate and marks it **"blocked on a license answer before any ingestion work starts."** That
verdict is stale. Two things have since settled it:

- **An owner decision already recorded in the repo** — `docs/EXPLORE_ENHANCEMENT_PLAN.md:19`:
  *"NHFR/FHSIS: use whatever is publicly available online, with citation — no formal license
  conversation required before use; cite source + retrieval date in `/methodology` and
  `dim_dataset`."* And `docs/EXPLORE_ENHANCEMENT_PLAN.md:351` already specs the increment
  (**E4.5**) down to the target table shape.
- **The owner's confirmation in this session** that the export is public and covered by the FOI
  law.

The data is now in hand: `nhfr_universe_as_of_September_2026.xlsx`, the public
`nhfr.doh.gov.ph` export, retrieved 2026-09-05. The scoping doc's *other* open question — whether
facilities carry clean PSGC codes or free-text addresses needing geocoding ("a real risk of
repeating 1.6's boundary-vintage crosswalk problem") — is answered by direct inspection: **the
codes are clean**. E4.5's fallback ("if the export turns out not to carry clean geo codes, stop at
province-level name matching") is not needed.

**Outcome:** BHW Connect gains its health-infrastructure layer — the facilities that the BHW
workforce works alongside — as a normal dataset increment on the existing path
(ingest → `dim_dataset` → fact → aggregate → section), exactly as `uuc-phc-2025` was built.

**Scope (owner-selected):** core dataset + section. No AI chat, no present mode, no PNG one-pager
in this pass — the `/uuc-phc` U5–U12 equivalents are deliberately deferred (see §Deferred).

---

## What the source actually contains (verified, not assumed)

Single sheet, 32 columns, **44,799 facility records**, all 18 regions.

| Property | Finding |
|---|---|
| Primary key | `Health Facility Code` (`DOH0000000000NNNNN`) — **0 duplicates** across 44,799 rows |
| Region / Province / City-Mun PSGC | **100% populated**, uniformly 10-digit, trailing-zero padded — truncation to `dim_geo`'s 2/5/7 widths is lossless (verified: 0 exceptions) |
| Barangay PSGC | **99.76%** (44,691); 108 rows blank |
| Hierarchy integrity | Every barangay code's first 7 digits match its city/municipality code — **0 mismatches** |
| Distinct geographies | 1,673 city/municipalities; 28,511 distinct barangay *codes*, resolving to 28,490 barangays (of `dim_geo`'s 41,958) — 21 Sulu barangays are printed under both code vintages |
| Facility types | 45 distinct. Barangay Health Station **27,186** (61%), Clinical Laboratory 4,349, Birthing Home 3,565, Rural Health Unit 2,745, Hospital 1,358 |
| Ownership | Government 33,524 / Private 11,275 |
| Licensing Status | blank 28,247 · With License 15,441 · Without License 1,111 — values carry a literal `"Licensing Status:"` prefix needing strip |
| Facility Major Type | Health Facility 44,586 / Health Related Facility 213 |

### The Sulu vintage split — the one real geo trap, and it is already solved

`dim_geo` holds Sulu as `19066…` under region 19 (BARMM). The NHFR export is **internally
inconsistent about Sulu, and differently from how the UUC-PHC workbook was**:

- **152 rows** — `region_name = "REGION IX (ZAMBOANGA PENINSULA)"` with **`19066…`** codes
- **25 rows** — `region_name = "REGION IX (ZAMBOANGA PENINSULA)"` with **`09066…`** codes

So NHFR names Sulu under Region IX (the reverse of the UUC workbook, which named BARMM while
carrying Region IX codes), while its codes straddle both vintages.

**No new crosswalk is needed.** `map_psgc_to_dim_geo()`
(`supabase/migrations/20260721060000_e4_1_psgc_crosswalk.sql:75`) tries `dim_geo` directly first,
then `dim_psgc_crosswalk` — so the 152 `19066…` rows hit `dim_geo` directly and the 25 `09066…`
rows resolve through the **existing** `20260826121200_crosswalk_sulu_region_ix.sql`, which already
seeded all 430 Sulu geos. Both land on `dim_geo`'s BARMM placement.

**Consequence to state on the page, not paper over:** Sulu's 177 facilities roll up under **BARMM**
(`dim_geo`'s placement), while the source's region *name* column says Region IX. This is the same
name-vs-code disagreement `docs/UUC_PHC_2025_PLAN.md` §4 resolved, resolved the same way — honour
the code, through the crosswalk, never by editing `dim_geo`.

---

## Decisions

**1. Slug `nhfr-2026-09`, `status = 'published'`.** NHFR is a live registry, so the slug carries
the snapshot month — this is a point-in-time export, not a periodic publication, and a later
snapshot is a new version rather than a correction. `status` is `'published'`, **never `'active'`**
— `docs/DECISIONS.md` records that seeding a second row `'active'` blanked the site once (E4.3,
#44). `as_of_date = 2026-09-01`; source URL `https://nhfr.doh.gov.ph`; retrieval date 2026-09-05
recorded in `source_name` per the E4.5 citation requirement.

**2. Contact columns are NOT ingested.** This is the plan's one non-obvious call and it is a
privacy one. Of the 20,194 email addresses, **18,413 (91%) are free webmail** — `gmail.com`,
`yahoo.com`, `hotmail.com`, `outlook.com` — i.e. personal addresses of individual midwives and
proprietors (`beverlyespinosasantos@gmail.com`, `julyannsudario28@gmail.com`), not institutional
contacts. Loading them would put ~18,000 personal email addresses into a table published under
CC BY 4.0 with a public REST endpoint. `docs/BUILD_PLAN.md` pitfall **P16** already sets the
precedent for exactly this shape of risk (free-text training details "never leaves raw tables"),
and nothing on any planned page needs them.

**Dropped:** `Email Address`, `Alternate Email Address`, `Landline Number`, `Landline Number 2`,
`Fax Number`, `Official Website`, `Street Name and #`, `Building name and #`, `Zip Code`, and
`Old Health Facility Name 1–3` (6.75% / 0.73% / 0.24% populated). The barangay is the location
granularity every planned figure needs.

**Kept:** facility code (+ short), name, major type, type, ownership (major + the two
sub-classification columns folded into one `ownership_sub`, since they are mutually exclusive by
construction), the four source PSGC codes and names, service capability, bed capacity, licensing
status (prefix-stripped), license validity date.

**3. `geo_code` is city/municipality-grain and `NOT NULL`; `barangay_geo_code` is nullable.**
Every facility has a city/municipality code (100%), so every facility has a guaranteed rollup path;
108 have no barangay. Making the barangay the required key would either drop those 108 or force a
fabricated code. Both geo columns resolve **in SQL** through `map_psgc_to_dim_geo(...)` at load, on
`ingest_uuc_phc.py`'s precedent — so an unresolvable code fails the insert on a `NOT NULL` rather
than silently dropping a facility.

**4. Two aggregates, no cube.** Per `docs/AI_ASSISTANT_PLAN.md` §5 decision #6 — a new dataset
earns materialized aggregates only for what a page actually renders — build exactly:
`agg_nhfr_counts` (one wide row per geo: totals, ownership split, the four headline types, and
barangay coverage) and `agg_nhfr_by_type` (long form, one row per geo × facility type present).
A full geo × type × ownership × licensing cube is not built. Both are computed **in SQL from the
fact table**, idempotent — re-running the migration *is* the refresh procedure, so the aggregate
cannot drift from the facts (`agg_uuc_phc_counts`'s precedent).

**5. No `n<5` suppression.** This is an inventory of *places*, carrying no individual-level
characteristic, and `docs/BUILD_PLAN.md:82` is explicit that "counts of totals … are not
suppressed; only person-characteristic breakdowns are." `agg_uuc_phc_counts` is the direct
precedent — a barangay-membership count with no suppression column. A zero is data: every geo gets
a row, so an area with no facilities reads "0 facilities" rather than "no data".

**6. The load is a live load with a committed cleaned CSV, not a 44,799-row seed migration.**
`ingest_uuc_phc.py` emits a committed seed because 5,987 rows fit in a migration; 44,799 do not
(~10 MB of SQL). Follow `ingest_stepzero.py` instead: `--database-url` live load wrapped in one
transaction, writing an `ingestion_batches` row with a QA report, plus `--emit-sql-dir` batched
output as the offline path. The reproducible committed artefact is the cleaned CSV.

---

## Increments

Each is independently shippable and must pass its Verify before the next starts, per
`docs/BUILD_PLAN.md` §0.

### N1 — Facility fact table, dataset registration, and the load

| Artefact | What it is |
|---|---|
| `ingestion/clean_nhfr.py` | Reads the source `.xlsx`, drops the contact/address columns per Decision 2, strips the `"Licensing Status:"` prefix, truncates the four PSGC codes to `dim_geo` widths, emits `ingestion/data/nhfr_2026_09_cleaned.csv` + a cleaning report |
| `ingestion/data/nhfr_2026_09_cleaned.csv` | Committed machine-readable extract — the only thing the loader trusts |
| `supabase/migrations/<ts>_fact_nhfr_facility.sql` | Table + indexes + RLS, in one statement block |
| `supabase/migrations/<ts>_seed_dim_dataset_nhfr.sql` | The `dim_dataset` row, `on conflict (slug) do nothing` |
| `ingestion/ingest_nhfr.py` | Loader: re-validates the extract, resolves both geo columns via `map_psgc_to_dim_geo`, loads live or emits batched SQL, writes the QA report |

Table shape (following `20260826121000_fact_uuc_phc_barangay.sql` exactly, including the
`enable row level security` + single `for select to anon, authenticated using (true)` policy in the
same migration — never opened then locked later):

```
fact_nhfr_facility
  id bigint generated always as identity primary key
  dataset_id bigint not null references dim_dataset (dataset_id)
  facility_code text not null                 -- DOH0000000000NNNNN, the source's own key
  facility_name text not null
  facility_major_type text not null           -- Health Facility | Health Related Facility
  facility_type text not null                 -- the 45 values
  ownership_major text not null               -- Government | Private
  ownership_sub text                          -- gov + private sub-columns folded
  geo_code text not null references dim_geo (geo_code)         -- citymun, resolved
  barangay_geo_code text references dim_geo (geo_code)         -- nullable: 108 rows
  source_region_psgc / source_province_psgc /
  source_citymun_psgc / source_barangay_psgc text              -- as printed, pre-resolution
  source_region_name / source_province_name /
  source_citymun_name / source_barangay_name text
  service_capability text
  bed_capacity integer not null default 0
  licensing_status text                       -- With License | Without License | null
  license_validity_date date
  unique (dataset_id, facility_code)
```

The loader's checks are **load-blocking**, on `ingest_uuc_phc.py:135-219`'s discipline (a silently
short load is worse than a failed one): row count = 44,799; 0 duplicate facility codes; all four
PSGC columns 10-digit where present; barangay-prefix-matches-citymun on all 44,691; the per-region
counts table above reproduced exactly; exactly 108 rows without a barangay; and **0 rows whose
`geo_code` fails to resolve**.

Also in N1, because it is mechanical and skipping it is what created the U5 debt in the UUC build:
regenerate the lineage seed with `python ingestion/build_kb_lineage.py`, and add the two new
public tables to `PUBLIC_READ_TABLES` in `ingestion/verify_rls.py`. (That list has drifted — the
UUC and district tables were never added either. Fix ours; note the rest.)

**Verify (run live against the loaded table):** 44,799 rows = 44,799 distinct facility codes;
0 unresolved `geo_code`; 108 null `barangay_geo_code`; the 18-region counts reproduce the table
above **with Sulu's 177 under BARMM**; `anon` can select the table and cannot write it.

### N2 — Aggregates

`supabase/migrations/<ts>_agg_nhfr_counts.sql` and `<ts>_agg_nhfr_by_type.sql`, both
`(dataset_id, geo_code, geo_level)`-keyed, computed in SQL by `left join` from `dim_geo` so every
geo gets a row including zeros, at national/region/province/citymun. No barangay-level rows — a
city page reads its own facilities from the fact table directly, as `/uuc-phc` does.

`agg_nhfr_counts` columns: `n_facilities`, `n_government`, `n_private`, `n_bhs`, `n_rhu`,
`n_hospital`, `n_barangays_with_facility`, `n_barangays`. The last two are what make the headline
finding sayable — **28,490 of 41,958 barangays have at least one facility**, so ~13,470 do not.

**Verify:** Σ regions = Σ provinces = Σ citymuns = 44,799; national row = 44,799; no geo where
`n_barangays_with_facility > n_barangays`; `n_government + n_private = n_facilities` everywhere;
`agg_nhfr_by_type` per-geo sums equal `agg_nhfr_counts.n_facilities`; national type counts match a
direct count over the fact table.

### N3 — The `/facilities` section

`lib/db/nhfr.ts` mirroring `lib/db/uuc-phc.ts` in full: `cache()`-wrapped readers resolving
`datasetId` via `getDatasetIdBySlug(DATASET_SLUGS.nhfr)` and returning `null`/`[]` on read failure
rather than throwing; a pure exported row→view mapper for unit tests; `nhfrAreaHref()`;
`NHFR_BRAND_LABEL`; a Person/Place/Time caption helper. Add `nhfr: "nhfr-2026-09"` to
`DATASET_SLUGS` in `lib/db/dataset.ts:70`.

Routes, mirroring `app/uuc-phc/`:

- `app/facilities/layout.tsx` — section title template + slim header (the shared BHW header
  suppresses itself on section routes)
- `app/facilities/page.tsx` — national: total facilities, the ownership split, the type breakdown,
  barangay-coverage figure, region child table
- `app/facilities/[geoLevel]/[geoCode]/page.tsx` — region → province → citymun drill-down; at
  citymun, the actual facility list (name, type, ownership, barangay, licensing status)
- `app/facilities/opengraph-image.tsx` + the per-area one
- `app/facilities/methodology.tsx` — source, retrieval date, the Sulu note, the excluded-columns
  note, and the licensing-status caveat below

**One content rule the page must honour:** `Licensing Status` is blank on 28,247 of 44,799 rows
(63%) — overwhelmingly Barangay Health Stations, which are not licensed facilities. The page must
never render that as "unlicensed". Show licensing only where the source states it, and say what the
blank means.

**Verify:** every level renders against live data — national, a region, a province, a mixed city, a
city with one facility; unknown geo 404s; `/facilities/barangay/*` 404s by design; a11y and the
mobile perf budget per `docs/BUILD_PLAN.md` §5.

### N4 — Cross-dataset context and the doc updates

- A context chip on `/place/*` and `/explore` on `uucContextSentence()`'s precedent
  (`lib/db/uuc-phc.ts:102`) — a *sentence*, not a map layer, because it switches denominator from
  BHW profiles to facilities and a shared colour ramp across two universes is the thing that
  precedent exists to refuse.
- **`docs/DATASET_SCOPING.md` §2 rewritten** — the "blocked on a license answer" verdict replaced
  with the settled basis (`EXPLORE_ENHANCEMENT_PLAN.md:19` + FOI), the geo-join uncertainty
  replaced with the verified finding, and the real figures.
- `/methodology` gains the source + retrieval date; `/roadmap`'s generic "a second dataset" line
  names this one; `docs/DECISIONS.md` gets a dated entry for Decisions 1–6, especially the
  contact-column exclusion.

---

## Deferred (explicitly out of scope, per the owner's scope choice)

The `/uuc-phc` U5–U12 equivalents: `dataset_registry` + `dataset_column` dictionary rows (which are
the *allowlist* for AI chat — `queryDataset` refuses a table with no approved dictionary, so
NHFR is unreachable from chat until this lands), present mode, PNG one-pager, dataset-aware
feedback routing, AI insight slot. Recorded as known debt in `docs/DECISIONS.md` rather than left
implicit — that is precisely the debt the UUC build had to pay back in U5.

A facility **point map** is also deferred: `components/maps/choropleth-map.tsx` is polygon-only
(`fill`/`line` paint driven by quantile bins) and a point layer with clustering is a genuine
divergence, not a reuse. The source also carries no lat/long — only PSGC codes — so points would
have to be placed at barangay centroids, which is a different claim than a facility location.

---

## Verification

1. `python ingestion/clean_nhfr.py` → cleaning report; diff the committed CSV.
2. `python ingestion/ingest_nhfr.py --database-url "$SUPABASE_DB_URL"` → all N1 checks pass, QA
   report row written to `ingestion_batches`.
3. Apply the migrations; run the N1 and N2 Verify queries live via the Supabase MCP tools.
4. `python ingestion/verify_rls.py` → green, including the two new tables.
5. `python ingestion/build_kb_lineage.py` → **no table printed to stderr without a `built-by` edge**.
6. `npm run lint && npm run typecheck && npm test` — with new unit tests for the pure mappers in
   `lib/db/nhfr.ts` (`lib/db/nhfr.test.ts`), following `lib/db/uuc-phc.test.ts`.
7. `npm run dev` and walk the section: national → region → province → citymun → a 404.
8. `mcp__Supabase__get_advisors` clean — no `security_definer_view`, no RLS findings.
