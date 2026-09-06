# FHSIS 2025 — DOH Field Health Services Information System as a companion dataset

## Context

`docs/DATASET_SCOPING.md` §3 re-scoped this candidate on 2026-09-06 against the actual source, and
three of its long-standing verdicts fell: it is not licence-blocked (Philippine government work,
RA 8293 §176, inside the owner decision at `docs/EXPLORE_ENHANCEMENT_PLAN.md:19`), it is not
PDF-only (DOH publishes it as Excel), and it does carry PSGC codes. What remained was an owner
call — complete-2024 or partial-2025 — and a rule. Both are now settled:

- **Year: 2025.** The owner asked for 2025. Every workbook the first slice below needs is in the
  2025 release; the "partial" gap (as of this writing) is in program areas this plan defers anyway.
- **The rule: FHSIS never supplies a BHW count.** The BHW census in this repo (`bhw-2025`, with
  the StepZero quick-count as the universe) is the official BHW figure. FHSIS's
  `Active Barangay Health Workers` column is a tally of what LGUs filed through their RHUs — NCR
  at 4,454, Las Piñas at **1** — and publishing it beside the census would undercut the census
  with a source known to be under-reported. This plan treats that column the way N1 treated the
  NHFR contact columns: **dropped at cleaning, so it does not exist in any table**, not loaded and
  hidden.

**Outcome:** BHW Connect gains its *services* layer — what the health system actually delivered in
each city/municipality in 2025, alongside the workforce (`/bhw`, `/place`) and the infrastructure
(`/facilities`) — as a normal companion-dataset increment on the path every previous one took:
clean → `dim_dataset` → fact → section → context → registry → chat.

**What this one is for, stated once.** The site's identity is the BHW workforce. FHSIS earns its
place by answering a question the workforce data cannot: *given this many BHWs here, what is the
health system in this place managing to deliver?* Immunisation coverage, antenatal care, safe
water — beside BHW density, per city/municipality. And it closes a loop the site already opened:
`/uuc-phc` publishes FIC, pre-natal, SBA and water for the 5,987 listed barangays, capped and
carrying provincial benchmarks; FHSIS is the same indicator family for **all 1,610 cities and
municipalities**, uncapped, with the numerators and denominators the UUC workbook never had.

---

## What the source actually contains (verified, not assumed)

**The source is a public Drive archive, not the `doh.gov.ph` pages.** `https://bit.ly/FHSISPHSannualreports`
→ folder `16z6srVbGODqmgGHU4_Qg1oDBOglqp_XG`, owned by `fhsisreports@doh.gov.ph`, readable with no
login. Six subfolders — Annual, Quarterly, Monthly, each in Excel and PDF. Annual Excel spans
2018–2025. The 2025 folder holds **~45 workbooks across ten program areas**, some as `.xlsx` and
some as native Google Sheets (exported via `/export?format=xlsx`). Every fact below was read from
the downloaded 2025 files, not from a catalogue.

**The archive is mutable.** `Demographic_2025_EB_Final.xlsx` carries a Drive modified date of
2026-08-24; the 2024 folder was still being touched in late 2025. This is a live folder DOH keeps
adding to, so — like NHFR — what this plan loads is a *snapshot*, and the file id plus modified
date of every workbook goes into the cleaning report. A later pull is a new version.

### Two tiers, which is the fact that shapes everything below

| | Tier 1 — city/municipality, PSGC-keyed | Tier 2 — province/HUC, area-name only |
|---|---|---|
| Rows per annual sheet | ~1,743: 18 regions · 115–121 provinces/HUCs · **1,604–1,610 citymuns** | ~150: 18 regions · ~116 provinces/HUCs · a few extra |
| Key column | `PSGC 10` — 10-digit, the shape NHFR uses | `AREA` — name text, no code |
| Workbooks | **Demographics** (population, households, barangay/RHU/BHS counts, 8 non-BHW cadres split LGU/DOH-hired) · **Childcare / Immunization** (CPAB, BCG, HepB1, DPT-HiB-HepB, OPV, IPV, PCV, MMR, **FIC/CIC**) · **Maternal / ANC** (8ANC, 4ANC, 2PNC, plus prenatal screening files) · **Envi** (basic safe water L1–L3, safely-managed water, sanitation, ZOD) · **Infectious** (TB notified/confirmed/TPT/TSR; HIV/syphilis; leprosy; rabies; schisto; filariasis; STH) · **NCD** and **Oral Health** carry PSGC but publish ~150 rows | **Vital Statistics** (live births M/F, adolescent birth rate <10 / 10–14 / 15–19, mortality) · **Maternal / intrapartum** (deliveries by age band, SBA split physician/nurse/midwife, FBD public/private, birth weight) · **Childcare / nutrition** (breastfeeding <1h, LBW, vitamin A, MNP, MAM/SAM) · **Family Planning** (current users / new & other acceptors / dropouts / demand satisfied, per method × age band) |
| Join | direct on `dim_geo.geo_code` | name-match — the DOF/BLGF problem (`ingest_population.py`'s province-scoped matcher exists) |

**Morbidity** is a third shape: long/tidy, `region · province · category · disease · ICD code` ×
age band × sex, ~4,000 rows, no PSGC.

### Workbook mechanics, all found in the files

- **Every workbook has quarterly and annual sheets** (`Qtr1..Qtr4`, `Annual`; some `Annual_a` /
  `Annual_b` for two halves of one table). This plan loads **Annual** only.
- **Two merged header rows.** Row 4 carries the indicator group, row 5 the sub-column
  (`Male | Female | Total | %`, or `LGU Hired | DOH Hired | Total | Ratio`, or the age bands
  `10-14 | 15-19 | 20-49 | Total`). The column map is built from both rows; a single-row read
  produces blanks.
- **PSGC arrives as an Excel float on some rows** (`1380100000.0`) and as text on others. Normalise
  to a 10-digit string, then truncate to `dim_geo`'s widths exactly as `clean_nhfr.py` does.
- **`DQC` columns are internal QA**, not indicators — "over 100%" flags and source-file checks
  DOH's own staff used. Read them; never load them as data.
- **Sex and age disaggregation is nearly universal.** Immunisation is M/F/Total; maternal care
  and FP are by age band, including **10–14**, i.e. adolescent reproductive-health counts.
- **Coverage above 100% is published as such.** In the 2025 FIC/CIC Annual sheet, 54 of 3,220
  city/municipality percentage cells exceed 100% (Capas, Tarlac: 2,233%); 5 of 6,416 in 8ANC
  (City of Lipa: 150%). This is the exact artefact `docs/UUC_PHC_2025_PLAN.md` U3 had to handle —
  with one decisive difference for us: **FHSIS publishes the numerator and the denominator**, so
  the rate is recomputable and the overshoot is explainable (numerator from service registers,
  denominator a DOH population projection), rather than an opaque source-computed value that had
  to be capped blind.
- **Published subtotals do not always equal the sum of their parts.** In Demographics, the 18
  region rows sum exactly to the national row, but the citymun rows sum ~6,400 short of it. This
  is a property of the source (LGUs missing from the leaf table), and the plan publishes the
  residual per indicator rather than choosing a side silently — the 1.6 discipline.

### Headline figures the load must reproduce

| Figure | Value (2025 Annual) |
|---|---|
| Fully immunised children (FIC), national | **1,560,924 of 2,392,392 · 65.2%** |
| Projected population 2025 (Demographics) | 113,146,216 |
| Household estimates 2025 (Demographics) | 27,387,195 |
| Cities/municipalities with a PSGC row in Demographics | 1,610 |

---

## Decisions

**1. Slug `fhsis-2025`, `status = 'published'`, `geo_join_level = 'citymun'`, `as_of_date = 2025-12-31`.**
The year names an annual publication, so the slug carries the year (`uuc-phc-2025`'s precedent),
not a snapshot month (`nhfr-2026-09`'s — that one is a live registry). `status` is `'published'`,
never `'active'`, for the reason every companion seed restates (E4.3, #44). `source_name` carries
the archive folder, the retrieval date, and the words *"2025 annual release, partial at retrieval"*
— because the citation is the licence basis, and a partial release cited as if complete is a
wrong citation. `geo_join_level` is `citymun`: the finest grain the source publishes.

**2. The BHW column is not ingested — it does not exist in any table.** `clean_fhsis.py` drops
`Active Barangay Health Workers (BHW)` and its ratio column from the Demographics workbook before
anything downstream sees them, exactly as `clean_nhfr.py` drops the contact columns. The loader
asserts that no workforce row carries a BHW cadre. The registry note for `fact_fhsis_workforce`
says, in the words the NHFR note used for contact details: *the BHW cadre does not exist in this
table, not merely hidden* — so the assistant never answers "FHSIS's BHW count is unavailable" as
though something were being withheld. The one derived figure that touches BHWs at all — BHWs per
midwife, per nurse, per doctor — takes its **numerator from `agg_bhw_counts`**, this site's own
census, and only its denominator from FHSIS.

**3. First slice = Tier 1 only, and only five program areas of it.** Demographics (minus BHW),
Immunization, Maternal ANC, Envi, and TB. Three reasons, in order of weight:

- *`docs/AI_ASSISTANT_PLAN.md` §5 decision #6* — a dataset earns tables for what a page actually
  renders, and the section below renders these. Forty-five workbooks loaded because they exist
  would be a warehouse, not a section.
- *The join.* Tier 1 joins on `dim_geo.geo_code` with no name-matching. Tier 2 needs the
  province-scoped matcher and its manual-fixups file, which is real work with a known failure mode
  (`ingest_population.py`'s Manila and Maguindanao residuals). It is deferred, not refused.
- *The story.* FIC, antenatal care and safe water are three of the four criterion-(d) indicators
  `/uuc-phc` already publishes and explains (`/uuc-phc/criteria`). FHSIS at citymun grain is the
  universal counterpart to that targeted list, and the section can say so in one sentence a
  reader already has the vocabulary for. TB is the one addition with no UUC precedent, included
  because it is the program area with the most complete cascade (notified → confirmed → treated →
  outcome) and because BHWs are TB treatment partners.

**4. Store counts, and never average a rate.** This is U3's rule — *mark the value, never average
it* — applied to a source that, unlike the UUC workbook, gives us the parts:

- `fact_fhsis_indicator` stores **numerator, denominator, and the rate as the source printed
  it**, per geo, per indicator, at **every grain the source publishes** (national, region,
  province/HUC, citymun). Rollups are never recomputed from leaves for display, because the source
  publishes its own subtotals and the citymun leaves are known to be incomplete (the ~6,400
  finding above). Instead the loader computes leaf-sum vs published-parent **per indicator** and
  writes the residuals to the cleaning report and to a `ref_fhsis_reconciliation` view, so the gap
  is a stated fact on the methodology page rather than a silent choice.
- A rate above 100% is stored **as published**, with `over_100 = true`. It is not capped: the
  denominator is present, so the reader can be told *why* (1,234 children immunised against a
  projected 1,100 eligible), which is more honest than a ceiling. Every surface renders it with
  U3's † and footnote. No surface ever computes a mean of the rate column; where a page needs an
  area figure it reads the source's own row for that area.
- Sex and age-band breakdowns are loaded (`breakdown` column: `total | male | female | 10-14 |
  15-19 | 20-49`), because the registry and chat need them. **The first slice renders `total` only.**
  Adolescent (10–14) counts at citymun grain are not rendered on any page until the owner says
  otherwise — they are service-event counts DOH itself publishes at this grain, so they are not
  suppressed, but rendering them beside a place name is a separate decision from loading them.

**5. FHSIS's population and household columns are stored as the source's denominators, never
promoted to the site's.** `docs/DATASET_SCOPING.md`'s standing recommendation ("build PSA
population first") was stale when this plan was written — `psa-popcen-2024`, `psa-cph-2020` and
`psa-sae-poverty-2023` are already loaded (`agg_population`, `agg_poverty`), and E4.2 already made
POPCEN 2024 the per-capita denominator. FHSIS's `Population 2025` is a DOH projection carried for
its own ratio arithmetic; its `Number of Household Estimates` likewise. They are loaded because a
published rate must be recomputable against the base it was computed on — and because they are
the denominators of the workforce ratios — but no BHW-per-capita figure anywhere on the site
switches to them. The methodology page names both denominators and which figure uses which.

**6. The identity rule holds: FHSIS never goes on the map.** External variables appear (a) in
their own section, (b) as **Relationships axes** at citymun grain on poverty's exact precedent
(`REL_EXTERNAL_INDICATORS` in `lib/filters/schema.ts`, `REL_EXTERNAL_INDICATOR_META` in
`lib/analysis/map-indicators.ts`, source-stamped caption), and (c) as a **context sentence** on
`/place/*` and `/explore` on `nhfrContextSentence`'s precedent — a sentence, because it switches
universe from BHW profiles to children immunised, and a shared colour ramp across two universes
is what that precedent exists to refuse.

**7. No `n<5` suppression.** These are counts of service events and of posts, not
person-characteristic breakdowns of a registry (`docs/BUILD_PLAN.md` §4.1); `agg_nhfr_counts` and
`agg_uuc_phc_counts` are the precedents. Zero is data: a city with a row and a zero delivered zero,
and the page says so. A city with **no row** in a given workbook (the ~6,400-BHW-shaped gap) is
*not reporting*, and the page says that instead — the two are never conflated, which is why the
table stores what the source published and does not `left join dim_geo` zeros into existence the
way `agg_nhfr_counts` does. That is the one deliberate departure from N2, and it is because the
absence here means something different.

**8. Live load with committed cleaned CSVs, not seed migrations.** Five program areas × ~1,750
rows × several indicators and breakdowns is on the order of 60–80k rows — past the size at which
`ingest_uuc_phc.py`'s committed seed made sense and squarely in `ingest_nhfr.py`'s territory
(`--database-url` live load in one transaction, `ingestion_batches` row with a QA report,
`--emit-sql-dir` as the offline path). The reproducible committed artefacts are the long-format
cleaned CSVs plus the cleaning report, one per program area.

**9. Provenance per workbook, not per dataset.** Because the archive is mutable and the release
partial, the cleaning report records for each workbook: Drive file id, Drive modified date, sheet
read, row count, header signature (the two merged rows, joined), and the >100% count. A future
pull diffs against this. A re-pull that changes any figure bumps `dim_dataset.last_updated_at`
through `bumpDatasetVersion` (`lib/db/dataset-version.ts`, the mechanism `ph-legislative-districts`
uses on an accepted correction) — that timestamp is what the AI caches key on, so a republished
figure cannot leave a stale cached answer in place — and gets a `docs/DECISIONS.md` entry.

---

## Tables

Long format for the indicators — forty-odd indicators wide would be unreadable and unindexable,
and `agg_population`'s one-row-per-source×geo×year shape is the in-repo precedent for a
multi-measure companion. Every table gets RLS enabled and its single public-read policy in the
same migration as `create table`, never opened then locked (0.3 guardrail).

```
ref_fhsis_indicator                           -- hand-written dictionary, seeded in migration
  indicator_key text primary key              -- e.g. 'fic', 'cic', 'anc4', 'anc8', 'pnc2',
                                              --      'water_basic', 'water_safely_managed',
                                              --      'sanitation_basic', 'zod', 'tb_notified',
                                              --      'tb_confirmed', 'tb_tpt', 'tb_tsr_dstb', ...
  program_area text not null                  -- 'immunization' | 'maternal' | 'envi' | 'tb' | ...
  label text not null                         -- "Fully immunised children (FIC)"
  numerator_def text not null                 -- as the workbook's row-4 header states it
  denominator_def text not null               -- "Projected population 0-12 months" etc.
  unit text not null                          -- 'percent (0-100, may exceed)'
  source_workbook text not null               -- the file name in the 2025 folder
  uuc_criterion_d boolean not null default false  -- FIC / pre-natal / water: the UUC overlap

fact_fhsis_indicator
  id bigint generated always as identity primary key
  dataset_id bigint not null references dim_dataset (dataset_id)
  geo_code text not null references dim_geo (geo_code)
  geo_level geo_level_enum not null           -- national | region | province | citymun
  indicator_key text not null references ref_fhsis_indicator (indicator_key)
  breakdown text not null default 'total'     -- total | male | female | 10-14 | 15-19 | 20-49
  numerator integer                           -- as published; null where the sheet is blank
  denominator integer                         -- as published (the projection), nullable
  rate_pct numeric                            -- as published, unrounded; may exceed 100
  over_100 boolean not null default false     -- rate_pct > 100 — rendered with † (U3 rule)
  source_psgc text                            -- the code as printed, pre-normalisation
  source_area_name text                       -- the name as printed; display uses dim_geo
  unique (dataset_id, geo_code, indicator_key, breakdown)

fact_fhsis_workforce                          -- Demographics, minus BHW by construction
  id, dataset_id, geo_code, geo_level         -- as above
  cadre text not null                         -- physician | nurse | midwife | dentist |
                                              -- med_tech | nutritionist | sanitary_engineer |
                                              -- sanitary_inspector     (never a BHW value)
  lgu_hired integer, doh_hired integer, total integer
  population_2025 integer                     -- the source's projection, see Decision 5
  households_2025 integer
  unique (dataset_id, geo_code, cadre)
  check (cadre <> 'bhw')                      -- belt and braces; the cleaner already dropped it

ref_fhsis_reconciliation (view)               -- per indicator: Σ citymun vs published province,
                                              -- Σ province vs published region, Σ region vs
                                              -- national; the residual and which side is short
```

No `agg_fhsis_*` table. The source publishes every grain a page renders, so there is nothing to
compute that would not either duplicate a published row or average a rate (Decision 4).

---

## Increments

Each is independently shippable and must pass its Verify before the next starts. **F5 and F6 are
listed as increments, not as a Deferred section**, because NHFR deferred exactly those and then
paid them back across six PRs (#141–#147); naming them now costs nothing and stops them becoming
debt.

### F1 — Clean, register, load

| Artefact | What it is |
|---|---|
| `ingestion/fetch_fhsis.py` | Pulls the named 2025 workbooks from the Drive folder by file id (`uc?export=download` for `.xlsx`, `/export?format=xlsx` for native Sheets) into `ingestion/data/fhsis_2025/`, recording id + modified date. Committed alongside because the archive is mutable — the same reason `redact_nhfr_source.py` exists |
| `ingestion/clean_fhsis.py` | Per workbook: read the Annual sheet, merge the two header rows into a column map, normalise PSGC, drop DQC columns, **drop the BHW columns**, unpivot to long format, compute `over_100`, emit `ingestion/data/fhsis_2025_<area>_cleaned.csv` and `docs/FHSIS_2025_CLEANING_REPORT.md` (per-workbook provenance, >100% counts, subtotal residuals, unmatched PSGC) |
| `supabase/migrations/<ts>_ref_fhsis_indicator.sql` | Dictionary table + seed rows, RLS |
| `<ts>_fact_fhsis_indicator.sql`, `<ts>_fact_fhsis_workforce.sql` | Tables + indexes + RLS in one block each |
| `<ts>_seed_dim_dataset_fhsis.sql` | The `dim_dataset` row per Decision 1, `on conflict (slug) do nothing` |
| `<ts>_ref_fhsis_reconciliation.sql` | The view |
| `ingestion/ingest_fhsis.py` | Loader on `ingest_nhfr.py`'s shape: re-validates the CSVs, resolves `geo_code` via `map_psgc_to_dim_geo`, live load or `--emit-sql-dir`, QA report to `ingestion_batches` |

The loader's checks are **load-blocking**: every `indicator_key` exists in `ref_fhsis_indicator`;
0 rows whose `geo_code` fails to resolve; 0 rows with cadre `bhw`; the national FIC row reproduces
1,560,924 / 2,392,392; per-workbook row counts match the cleaning report; `over_100` count per
indicator matches the report; and for every indicator the leaf-vs-parent residual is *recorded*
(not required to be zero — see Decision 4).

Also in F1, because skipping it is what created the U5 debt: regenerate the lineage seed with
`python ingestion/build_kb_lineage.py`; add the three new public tables to `PUBLIC_READ_TABLES`
in `ingestion/verify_rls.py`; add `fhsis: "fhsis-2025"` to `DATASET_SLUGS` in `lib/db/dataset.ts`.

**Verify (live):** row counts per table equal the cleaning report; `select count(*) from
fact_fhsis_workforce where cadre = 'bhw'` is 0 and the column list of every FHSIS table contains
no BHW field; the national FIC row matches; `ref_fhsis_reconciliation` shows the Demographics
region-sum residual as 0 and names the citymun shortfall; `anon` can select all three tables and
write none; `python ingestion/verify_rls.py` green.

### F2 — `lib/db/fhsis.ts` and the `/health-services` section

`lib/db/fhsis.ts` mirroring `lib/db/nhfr.ts` in full: `cache()`-wrapped readers resolving
`datasetId` via `getDatasetIdBySlug(DATASET_SLUGS.fhsis)`, returning `null`/`[]` on read failure;
a pure exported row→view mapper for unit tests; `fhsisAreaHref()`; `FHSIS_BRAND_LABEL =
"Health services"`; `FHSIS_RELEASE_LABEL = "FHSIS 2025 (partial release)"`; a Person/Place/Time
caption helper whose N is the area's *eligible population for the indicator on screen*, never a
BHW count. One helper the UUC section already has and this one reuses rather than reinvents:
the † rendering for a bounded value (`components/uuc-phc/barangay-detail.tsx`'s marker and
footnote pair) — here the footnote reads *"the source recorded more services than its projected eligible population;
the true coverage is unknown"*.

Routes, mirroring `app/facilities/`:

- `app/health-services/layout.tsx` — section title template + slim header; add the path to the
  header/footer suppress lists (`components/layout/header.tsx`, `footer-gate.tsx`) and a
  `HEALTH_SERVICES_CRUMB` to `lib/nav/breadcrumbs.ts`
- `app/health-services/page.tsx` — national: FIC, 4ANC/8ANC, basic safe water, TB treatment
  success as four headline coverage figures with their numerators and denominators; the workforce
  ratios (*BHWs per midwife* etc., census numerator); a region table sorted **worst-covered first**
  — `ChildBreakdown`'s reasoning applies unchanged: a raw count re-ranks areas by size, and the
  question is where coverage is lowest
- `app/health-services/[geoLevel]/[geoCode]/page.tsx` — region → province → citymun; at citymun,
  the full indicator list for the area with † where `over_100`, and a *"not reported in 2025"*
  line for any indicator with no row
- `app/health-services/opengraph-image.tsx` + the per-area one
- `app/health-services/methodology/page.tsx` — the archive and retrieval date; **the partial
  release**; the two-tier structure and why Tier 2 is not here; the >100% rule and its footnote;
  which denominator each figure uses (Decision 5); the reconciliation residuals; and the BHW rule
  stated the way `/facilities/methodology` states the licensing rule — as a thing this section
  will not do and why

**Content rules the pages honour:** never a BHW count from this source; never a mean of a rate;
† on every over-100 value with the footnote in view; "not reported" is never rendered as 0; every
figure carries the release label because a reader must know it is 2025-partial.

**Verify:** every level renders live — national, a region, a province, a large city, a
municipality with an over-100 FIC (Capas), a municipality absent from one workbook; unknown geo
404s; `/health-services/barangay/*` 404s by design (the source has no barangay grain); a11y and
the mobile perf budget per `docs/BUILD_PLAN.md` §5; `lib/db/fhsis.test.ts` covers the mapper,
the over-100 flag, the "not reported" vs zero distinction, and the caption's N.

### F3 — Cross-dataset context: chip, Relationships axes, docs

- **Context chip** on `/place/*` and `/explore` — `components/health-services/context-chip.tsx`
  on `NhfrContextChip`'s shape, sentence from `fhsisContextSentence()`: *"65% of eligible
  children here were fully immunised in 2025 (FHSIS, partial release)"*; the zero case renders
  positively; the not-reported case says so; null renders nothing.
- **Relationships axes.** Add `fic_coverage`, `anc4_coverage`, `water_basic_coverage` to
  `REL_EXTERNAL_INDICATORS` and their `REL_EXTERNAL_INDICATOR_META` with the caption
  *"FIC coverage: DOH FHSIS 2025 annual (partial release) · city/municipality"*. Citymun grain
  only, exactly as poverty. A new reader `getChildFhsisRates(geoCodes, indicatorKey)` on
  `getChildPoverty`'s shape; over-100 points are plotted at their value and marked, not clipped.
  A "BHW density vs FIC coverage" insight generator only if |ρ| clears the moderate threshold —
  E4.4's rule, never a story from noise.
- **Docs:** `docs/DATASET_SCOPING.md` §3 marked **BUILT** on §2's precedent; `/methodology` gains
  the source + retrieval date; `/roadmap` names it; `docs/DECISIONS.md` gets a dated entry for
  Decisions 1–9, especially 2 and 4.

**Verify:** the chip renders on a place page with data, a place with a zero, and a place with no
row; the scatter offers the three axes at province view only, with the source caption; the
insight generator declines on a weak correlation (unit test with a shuffled fixture).

### F4 — Registry and lineage

`dataset_registry` + `dataset_column` rows for the three tables, in a delta migration on
`20260905235556_seed_registry_nhfr.sql`'s pattern, with `lib/db/dataset-registry-seed.test.ts`
guarding the canonical file. The `notes_md` for `fact_fhsis_workforce` carries the BHW rule in
capitals the way the NHFR note carries the contact-column and licensing rules; the note for
`fact_fhsis_indicator` says: rates may exceed 100 and `over_100` marks them; **never average
`rate_pct`** — read the published row for the area instead; `breakdown = 'total'` unless the
question asks for a sex or age split; a missing (geo, indicator) pair is *not reported*, not zero;
denominators are DOH projections, not census population, and BHW-per-capita figures on this site
use `agg_population`, not these.

**Verify:** `queryDataset` accepts the three tables; a regression case asks for "how many BHWs
does FHSIS report" and the assistant answers that FHSIS carries no BHW count here and points at
the census; `python ingestion/build_kb_lineage.py` prints no table without a `built-by` edge.

### F5 — The chat surface

`"health-services"` added to `DATASET_SCOPE_IDS`; a `HEALTH_SERVICES_SCOPE` in
`lib/ai/dataset-scope.ts` with a system prompt that restates the four traps (no BHW count; no
mean of a rate; † semantics; not-reported ≠ zero) and `narrativeType: "health_services_overview"`;
`components/health-services/ask-health-services.tsx` on `AskFacilities`' shape, mounted on both
pages with starter questions that include the trap ("Is a 120% FIC figure a data error?").

### F6 — Present mode, AI insight, feedback routing, PNG one-pager

The four `/uuc-phc` U5–U12 equivalents NHFR paid back in #142–#146, done here in one increment
because every precedent now exists: `PresentationProvider`/`PresentationSlide` on both pages;
`AiInsight` with the new `narrativeType`; `{ prefix: "/health-services", slug: DATASET_SLUGS.fhsis }`
in `lib/feedback/dataset.ts`; `lib/exports/fhsis-figure.ts` + `app/api/export/health-services`
on `nhfr-figure.ts`'s shape — coverage bars for the four headline indicators, † preserved, the
release label in the footer, **and the `next.config.ts` `outputFileTracingIncludes` entry added in
the same PR** (the omission #146 found for `/api/export/uuc-phc`).

---

## Deferred (documented, not built in this pass)

- **Tier 2 workbooks** — intrapartum (SBA, FBD, birth weight), vital statistics (ABR, mortality),
  nutrition, family planning, NCD, oral health. Province/HUC grain and name-keyed; needs
  `ingest_population.py`'s matcher plus a fixups file. SBA is the fourth criterion-(d) indicator
  and the first of these worth doing.
- **Morbidity** — ICD-coded, age × sex, province grain. A different shape and a different page
  (leading causes, not coverage); its own plan.
- **Rendering sex and age-band breakdowns**, especially 10–14. Loaded, registered, not rendered —
  an owner decision, not a scoping one.
- **Quarterly sheets and the 2018–2024 series.** A time series is the obvious next thing
  (`Qtr1..Qtr4` are in every workbook; the 2024 folder is complete), and it is where a
  *"coverage fell here between 2024 and 2025"* finding would come from. Its own increment, after
  the annual load has been used.
- **The remaining Tier 1 areas** (HIV/syphilis, leprosy, rabies, schisto, filariasis, STH; the
  antigen-by-antigen immunisation files beyond FIC/CIC; the prenatal screening files) load through
  the same `clean_fhsis.py` with no new code — added as pages need them, per Decision 3.

---

## Verification

1. `python ingestion/fetch_fhsis.py` → the five program areas' workbooks in
   `ingestion/data/fhsis_2025/` with ids and modified dates logged.
2. `python ingestion/clean_fhsis.py` → cleaned CSVs; the cleaning report reproduces the headline
   table above and lists every >100% cell and every subtotal residual.
3. `python ingestion/ingest_fhsis.py --database-url "$SUPABASE_DB_URL"` → all F1 checks pass, QA
   report row written to `ingestion_batches`.
4. Apply the migrations; run the F1 Verify queries live via the Supabase MCP tools — including
   the two that prove the BHW rule structurally (no such column, no such cadre).
5. `python ingestion/verify_rls.py` → green, including the three new tables.
6. `python ingestion/build_kb_lineage.py` → no table printed to stderr without a `built-by` edge.
7. `npm run lint && npm run typecheck && npm test` — with `lib/db/fhsis.test.ts` and
   `lib/exports/fhsis-figure.test.ts` following their NHFR counterparts.
8. `npm run dev` and walk the section: national → region → province → Capas (a † value) →
   a municipality absent from one workbook → a 404.
9. `mcp__Supabase__get_advisors` clean — no `security_definer_view`, no RLS findings.
10. One cross-check, reported not asserted: FHSIS 2025 provincial FIC against
    `ref_uuc_phc_provincial`'s `fic_prov_ref`. They are different years and possibly different
    denominators, so agreement is not required — but the comparison goes in the cleaning report,
    because it is the first time the site has held the same indicator from two sources.
