# UUC for PHC 2025 — Unserved and Underserved Communities (handoff document)

A dedicated dashboard card and section for the **2025 list of Unserved and Underserved
Communities for Primary Health Care**, built from `ingestion/data/Submissions_UUA_2025_filled_1.xlsx`.

**Status:** proposed. Increment U1 is unblocked; U3 is blocked on a units question for the
source office (§5).

**Verdict on scoping: build this outside `AI_ASSISTANT_PLAN.md`.** It is a normal dataset
increment on the path that already exists — ingest → `dim_dataset` → fact → aggregate → card —
exactly as `bhw-profiling-status-2026` was built (`docs/profiling-status-feature.md`). It needs
no registry, no embeddings, and no graph. The AI plan's §5 decision #6 settles the aggregate
question in this dataset's favour: a new dataset ships with facts and a dictionary only, and
earns materialized aggregates *when a dashboard page renders it*. This one renders, so it does.

The **2027 Budget Cue Cards** PDF loaded alongside it is the opposite case and belongs squarely
inside the AI plan — see `AI_ASSISTANT_PLAN.md` §12.

---

## 1. Naming

The two files use three names for one thing. Settle on the policy name:

| Term | Meaning | Where |
|---|---|---|
| **UUC for PHC** | Unserved and Underserved Communities for Primary Health Care | Cue cards p48 — the program's own name |
| UUA | Unserved and Underserved Areas | The Excel's `DECISION` column values |
| GIDA / SEDA | Geographically Isolated and Disadvantaged Areas / Socio-Economically Disadvantaged Areas (urban poor) | Former names, superseded (cue cards p48) |

Policy basis: **DOH AO No. 2020-0023** defines the criteria (§1a below); **DC No. 2025-0549**
issues the 2025 list (cited on cue cards p37).

Proposed slug **`uuc-phc-2025`**, `geo_join_level = 'barangay'`, `as_of_date = 2025-01-01`.
Keep `UUA` only as the raw column value inside the fact table, never in UI copy.

---

## 1a. Where the criteria come from

`ingestion/data/DOH_AO_2020-0023_GIDA_guidelines.pdf` — *Guidelines on Identifying
Geographically-Isolated and Disadvantaged Areas and Strengthening their Health Systems*, signed
27 May 2020 by Sec. Francisco T. Duque III. Issued under RA 11223 (UHC Act) IRR §29.2, which
mandates the DOH to develop guidelines for identifying GIDA barangays; it repeals AO 185 s. 2004.

**This document is why the dataset has the shape it has.** Every assessment column in the
workbook is a criterion from §VI.A, and every threshold below was verified against the file
itself, not inferred.

A barangay qualifies only if **both** a physical **and** a socio-economic factor are present.

**Physical factor** — at least **25%** of sitios/puroks have no access to an RHU or hospital
within **60 minutes** of travel in any form of transport, *including walking*.

**Socio-economic factor** — at least **one** of:

| # | Condition | Workbook column |
|---|---|---|
| a | ≥ 10% of population are IPs | `IP POP` → `IP POPN` |
| b | ≥ 10% affected by armed conflict or internally displaced, **or** the barangay is designated a CTG/LEG area by NICA | `ARMED CONF`, `IDP` → `AC/ IDP`; `ELCAC BRGY` → `ELCAC PASS` |
| c | ≥ 50% of population enrolled in 4Ps/CCT | `4PS` → `4Ps/CCTs` |
| d | Performs worse than the **latest provincial data** on at least **4 of 8** health indicators | the seven `* Prov Ref` / `High or Low*` pairs → `Health Indicators` → `HI` |

The eight indicators under (d) are: Infant Mortality Rate, Under-Five Mortality Rate, Fully
Immunized Child, Adolescent (10–19) Birth Rate, **Contraceptive Prevalence Rate**, proportion of
pregnant women with 4+ pre-natal visits, proportion of deliveries with a skilled birth attendant,
and households with access to improved water supply.

### What this explains

- **The `* Prov Ref` columns are the AO's provincial comparators.** They are not barangay
  measurements and must never be cleaned as if they were — §2 of the cleaning report holds.
- **`Health Indicators` (0–7) is the AO's count under (d)**, and `HI` passes at ≥ 4. Verified: the
  score equals the number of `High or Low*` columns reading `Pass` in all 5,991 rows.
- **`Physical Factor` has a floor of 25 and every row passes**, because the file is the
  *post-selection* list — barangays below 25% never entered it.
- **The units the owner set match the AO's own definitions.** IMR, UFMR and ABR are rates; FIC,
  pre-natal, SBA and water are proportions. The cap-at-100 / cap-at-1,000 split follows the policy,
  not a convention chosen here.

### Two discrepancies worth recording

**FP CU is the AO's Contraceptive Prevalence Rate** — criterion (d)(v). Its removal from the
reconciled file leaves **7 of the AO's 8 indicators**, while the `≥ 4` threshold appears unchanged.
Four-of-seven is a stricter test than four-of-eight. It does not affect this list, which is already
selected, but it matters for the next profiling round and should be settled with BLHSD before then.

**Criterion (b) is implemented as a sum, not an either/or.** The file marks `AC/ IDP` as Pass when
`ARMED CONF + IDP ≥ 10`, matching all 5,991 rows; reading the AO's "or" as either-alone disagrees
on 15. Summing double-counts anyone both conflict-affected and displaced. Minor, but it is an
implementation choice rather than the text of the order.

### Cadence

CHDs and LGUs conduct mandatory profiling **once every three years** (§VI.B.6); BLHSD issues the
official list **annually** (§VI.B.2). So the dataset has two different refresh rhythms — the
underlying profile and the published list — which the dashboard's `as_of_date` should reflect.

---

## 2. What is in the workbook

Ten sheets. Two carry the payload; the rest are working copies that disagree with each other.

**Use these:**

| Sheet | Rows | Content |
|---|---|---|
| `NEW` | 15,386 | Region / province / citymun / barangay + `DECISION`. **UUA 5,991, NOT UUA 9,395.** The classification of record. |
| `2025 LIST` | 6,024 body rows (5,991 with a PSGC) | The 5,991 UUC-for-PHC barangays with 13 indicator columns. |

**Ignore these, and why:**

- **`Analytics`** — every computed cell is `#REF!`. It also measures something else entirely:
  *profiling coverage* against a 40,397-barangay target, which is the concept the
  `bhw-profiling-status-2026` card already serves. Do not ingest it and do not rebuild it here.
- **`PSGC (2)`** (5,602 distinct UUA) and **`PSGC DOC AC`** (5,917 distinct UUA) — lossy copies
  that disagree with `NEW`'s 5,991. `PSGC (2)` holds 15,390 rows but only 13,564 distinct
  barangay codes, so it is duplicated as well as incomplete.
- **`Sheet5`** (40,296 barangays) and **`PSGC`** (43,451) — PSGC masters, superseded by `dim_geo`.
- **`2024 ELCAC (2)`** and **`2021-2024 ELCAC`** — identical to each other, header on row 2, two
  unaligned column blocks side by side. Out of scope for this dataset.

`Sheet1` is a pivot of `NEW` and needs no separate handling.

---

## 3. Reconciliation against the cue cards

Cue cards p37 publishes *Distribution of UUC for PHC Barangays by Region (as of 2025 per DC No.
2025-0549)*. The workbook reproduces it almost exactly — **15 of 17 regions match to the unit**:

| Region | Cue cards p37 | Workbook `NEW` | Δ |
|---|---:|---:|---:|
| BARMM | 400 | 399 | **−1** |
| Region IV-A (CALABARZON) | 195 | 200 | **+5** |
| *Other 15 regions* | *exact match* | *exact match* | 0 |
| **Total** | **5,987** | **5,991** | **+4** |

Two localized discrepancies, no systemic drift.

**The workbook is internally consistent; the deck is the outlier.** Three independent places in
the workbook agree on both contested figures — the `NEW` classification sheet, the row count of
`2025 LIST`, and the `TOTAL` subtotal rows embedded in `2025 LIST` (§4) — all give CALABARZON 200
and BARMM 399. There is no counting artifact on the workbook side to find.

That makes the likeliest reading a **vintage difference**: p37 is a published snapshot "as of 2025
per DC No. 2025-0549", and the file is named `Submissions_UUA_2025_filled_1`, which reads as a
later revision. This is inference from the file name and the internal agreement, not something
either file states — confirm it rather than assuming it.

**Decision — confirmed by the owner:** publish the workbook's **5,991** as the card's figure, and
footnote p37's 5,987 with its circular reference and as-of date. The
deck is what has been briefed to budget audiences, so the footnote is not optional — but a
dashboard should render its own source, and that source corroborates itself three times. Record
the decision and the two affected regions in `DECISIONS.md`, following
`POPULATION_RECONCILIATION.md` and `BOUNDARY_RECONCILIATION.md`.

---

## 4. Geography — joins cleanly, with one known exception

The good news: `dim_geo` holds **41,958 barangays keyed on 10-digit codes**, and `2025 LIST.PSGC`
is already 10-digit. No crosswalk work is needed for the bulk of the file.

*Verified:* a random sample of 150 of the 5,991 codes joined **148/150** against
`dim_geo` at `geo_level='barangay'`. Both misses were Sulu.

**The Sulu exception.** 87 codes carry the prefix `09066` — Sulu under **Region IX**, following
its 2024 removal from BARMM. `dim_geo` still holds Sulu as **`19066`** under region 19 (410
barangays, `psgc_vintage = '2023 series (>=2024 release, includes NIR)'`). The workbook and the
cue cards agree with each other here — p37's Region IX count of 523 includes Sulu — so the
dashboard's geography is the side on the older vintage.

The remap is mechanical: region digits `19` → `09`, province and barangay digits unchanged
(`19066NNBBB` → `09066NNBBB`). **Do it as `dim_psgc_crosswalk` rows, not as a hand-edit of
`dim_geo`.** That table exists for exactly this, and `AI_ASSISTANT_PLAN.md` §3 names it the model
every later entity-resolution problem should follow. A silent `dim_geo` edit would also
retroactively move every existing BHW figure for Sulu between regions.

### The 33 codeless rows — 32 are not barangays

An earlier draft of this document recorded "~33 rows with a barangay name but no PSGC, needing
codes or exclusion." That was wrong, and the correction matters for the loader.

**32 of the 33 are layout, not data**: 16 region-header rows (region name in column A, everything
else empty) and 16 `TOTAL <count>` subtotal rows embedded between the regional blocks. A loader
that reads `2025 LIST` as a flat table ingests all 32 as barangays. Skip any row whose column A is
`TOTAL` or whose PSGC and citymun are both empty.

Those subtotal rows are useful in their own right — they are the workbook stating its own regional
counts, and §3 uses them as a third independent check.

**One row is a genuine missing code:** `SORSOGON / PILAR / SAN ANTONIO`. It cannot be resolved
automatically — PSGC has **two** barangays named SAN ANTONIO in Pilar, Sorsogon (`0506213047` and
`0506213048`), neither already present in the list, and the workbook carries no field that
distinguishes them. This one needs the source office. It is 1 barangay in 5,991.

---

## 5. The indicators are not ready to publish

`2025 LIST` carries 13 indicator columns. Five are clean; **eight are not**.

| Column | Observed range | Read |
|---|---|---|
| Physical Factor (% of puroks >1hr from RHU) | 0 – 100 | clean, percentage |
| IP POP | 0 – 100 | clean, percentage |
| ARMED CONF | 0 – 100 | clean, percentage |
| IDP | 0 – 100 | clean, percentage |
| 4PS | 0 – 100 | clean, percentage |
| IMR | 0 – **3,000** | out of range |
| UFMR | **−2** – **3,000** | out of range, negative |
| FIC | 0 – **18,088** | out of range |
| ABR | **−2** – **1,429** | out of range, negative |
| FP CU | 0 – **11,072** | out of range |
| Pre-natal | 0 – **1,950** | out of range |
| SBA | **−1** – 300 | out of range, negative |
| Water | **−1** – **9,594** | out of range, negative |

**This is not a scatter of typos.** Counting how many of the 5,991 barangays exceed 100 in each
column shows the problem is structural:

| Column | > 100 | share | < 0 | Maximum |
|---|---:|---:|---:|---|
| FP CU | 1,043 | 17.4% | 0 | 11,072 — San Isidro, City of San Jose del Monte, Bulacan |
| Water | 902 | 15.1% | 1 | 9,594 — Demang, Sadanga, Mountain Province |
| FIC | 457 | 7.6% | 0 | 18,088 — Villamiemban, Cordon, Isabela |
| Pre-natal | 211 | 3.5% | 0 | 1,950 — Borlongan, Dipaculao, Aurora |
| ABR | 100 | 1.7% | 6 | 1,429 — Nadawisan, Cataingan, Masbate |
| UFMR | 80 | 1.3% | 7 | 3,000 — Sua, Masantol, Pampanga |
| IMR | 60 | 1.0% | 0 | 3,000 — Sua, Masantol, Pampanga |
| SBA | 29 | 0.5% | 1 | 300 — Guitol, Santa Elena, Camarines Norte |

Two hypotheses worth putting to the source office directly, since they imply different fixes:

1. **Mixed units inside one column.** At 17% and 15%, FP CU and Water look like some encoders
   entered a raw count and others a percentage of the same denominator. If so the column is
   recoverable — with the denominator, per row.
2. **Negatives are "no data" sentinels.** The `−1` and `−2` values are few (15 in total across
   four columns) and sit exactly where a sentinel convention would put them. If confirmed they
   map to NULL, not to a value.

Neither is safe to assume. Publishing these columns unresolved would put unexplainable figures on
a public page — and silently coercing 17% of a column would be worse.

**This does not block the card.** The classification (*which* barangays are UUC for PHC) is
clean, is the part the cue cards actually publish, and is the part with a policy citation. Ship
that first; hold the indicators for U3 pending a per-column units confirmation from the source
office.

---

## 6. Proposed increments

Mirrors `bhw-profiling-status-2026`. Each is independently shippable and must pass its Verify.

**U1 — Classification, national.**
`dim_dataset` row (`uuc-phc-2025`); `fact_uuc_phc_barangay` (`geo_code`, `decision`,
`source_region/province/citymun/barangay` as given); `dim_psgc_crosswalk` rows for the 87 Sulu
codes. Loader `ingestion/ingest_uuc_phc.py`, generating a seed migration, following
`ingest_encoding_status.py`. The loader must **skip the 32 layout rows** (§4) — column A `TOTAL`,
or PSGC and citymun both empty — and hold back the single unresolved San Antonio row.

*Verify:* 5,990 UUA rows loaded (5,991 less the held-back San Antonio) + 9,395 NOT UUA; **every**
`geo_code` resolves in `dim_geo` after the crosswalk — this is where §4's 150-row sample becomes
an exhaustive check; regional counts reproduce the §3 table exactly; and the loader's per-region
counts equal the workbook's own embedded `TOTAL` rows, which is a check the source data provides
for free.

**U2 — Aggregates and the card.**
`agg_uuc_phc_counts` keyed `(dataset_id, geo_code, geo_level)` with barangay → citymun →
province → region → national rollups, mirroring `agg_bhw_stepzero_counts`. Card renders count
of UUC-for-PHC barangays, share of all barangays in the area, and child-area drill-down.
*Verify:* national == Σ regions == 5,991; province == Σ its citymuns; spot-checks against p37.

**U3 — Indicators.** Blocked on §5. Adds the 13 columns to the fact table plus per-indicator
aggregates only for those a page renders.

**U4 — PNG one-pager.** Optional; reuses `@resvg/resvg-js` and
`lib/exports/profiling-status-figure.ts`.

**Placement.** Own section `/uuc-phc` with the same national → region → province → citymun
drill-down, since this is a targeting dataset rather than a BHW measure. It is also a natural
overlay/filter on `/explore` — worth doing, but after U2, not inside it.

**Storage.** 5,991 fact rows and ~1,800 aggregate rows is well under 1 MB. This dataset is not a
scaling concern; the §5 opt-in aggregate discipline of the AI plan still applies to it, and the
596 MB-against-500 MB Free-plan position is unchanged by it either way.

---

## 7. Open questions

**Settled by the owner:**

- **Sulu's region** — confirmed. Place Sulu in Region IX per the source and the cue cards, recorded
  as `dim_psgc_crosswalk` rows, never as a `dim_geo` edit.
- **Codeless rows** — include rather than exclude, and find the codes. §4 resolves this: 32 of the
  33 were never barangays, and the loader skips them as layout. The one real row remains below.
- **Hosting clearance** for the cue cards corpus — cleared. `AI_ASSISTANT_PLAN.md` §12.5 updated.

- **Indicator bounds** — settled. Water, Pre-natal, SBA and FIC are coverage percentages capped at
  100; IMR, UFMR and ABR are rates per 1,000 capped at 1,000. Applied and reported in
  `UUC_PHC_2025_CLEANING_REPORT.md`. The negatives question is moot — the reconciled file had
  already removed them.
- **`SORSOGON / PILAR / SAN ANTONIO`** — resolved to `0506213048`. **All 5,991 barangays now carry
  a PSGC code**, so §4's last geography gap is closed and nothing is held back from U1.
- **FP CU** — confirmed dropped. The dataset carries 12 indicators, not 13.
- **Pass/Fail columns** — not to be used. All 15 are dropped from the cleaned dataset.
- **`#N/A` reference values** — left blank.
- **The published total** — **5,991**, with cue cards p37's 5,987 as a footnote citing DC No.
  2025-0549 (§3).

**No questions remain open.** U1 and U3 are both unblocked.

**One thing to carry into the build, not a question:** capped values are indistinguishable from
genuine ones once rendered. 886 Water and 456 FIC values now read as exactly 100%. The
`Values capped` column separates them, and any aggregate over those two indicators must exclude
or footnote the capped rows — at 15% of barangays for Water, it is large enough to move a national
figure. See `UUC_PHC_2025_CLEANING_REPORT.md` §6.

---

*Follows the conventions in `BUILD_PLAN.md` §5 and the per-increment logging of `DECISIONS.md`.
If any statement here conflicts with `BUILD_PLAN.md`, that document governs.*
