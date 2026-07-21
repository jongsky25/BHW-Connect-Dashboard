# Poverty reconciliation — PSA Small Area Estimates → agg_poverty (E4.4)

The flagship external dataset of Phase E4. Loads PSA's **Small Area Estimates (SAE) of poverty**
at city/municipality grain into a new `agg_poverty` table, and exposes poverty incidence as an
external variable on the Explore **Relationships** scatter (never on the workforce map — the
identity rule, owner Q1).

## Source

Owner-supplied workbook `ingestion/data/psa_sae_2023_poverty.xlsx` — PSA "**Annex 1. Statistical
Table on 2018, 2021 and 2023 City- and Municipal-Level Poverty Estimates**", one row per
city/municipality with, for each of the three reference years, **poverty incidence**, its
**coefficient of variation**, **standard error**, and **90% confidence interval** (lower/upper).
The single 2023 release carries the 2018 and 2021 figures as back-estimates on consistent
methodology, so all three years share one `dim_dataset` row (`psa-sae-poverty-2023`, `status =
'published'`) and reload idempotently by dataset. The plan named the 2021 SAE; the owner supplied
the newer **2023** release (which includes 2021), so 2023 is the headline vintage and the UI reads
it. Cite: PSA 2023 City- and Municipal-Level SAE of poverty (national government-funded SAE
project). SE is derivable as incidence × CV ÷ 100 (the source's own footnote 1); it is stored as
published rather than recomputed.

The public PSA/FOI pages are bot-blocked from the build environment (the research pass the plan
warned about: PSA 503, FOI 403; HDX carries only the archived **2009** SAE — the wrong vintage), so
the file was supplied directly, exactly as the census workbooks were for E4.2.

## Grain — city/municipality only, no rollup

Poverty incidence is a **rate**, not a count, so it is **not** rolled up to province / region /
national (that would need population weighting PSA does not publish here). `agg_poverty` therefore
holds only `geo_level = 'citymun'` rows, and poverty appears in Relationships only when the places
being compared are cities/municipalities — i.e. a **province** view (children are citymun). This is
a deliberate deviation from the plan's "province/citymun grain" wording; the source stops at
city/municipality. The BHW-density-vs-poverty insight (below) runs at province level for the same
reason.

## Join (PSGC, classic → dim_geo 2020+ series)

The source carries the **classic pre-2020 PSGC** (6-digit, NCR districts as pseudo-provinces —
City of Manila = province `39`; ARMM as region `15`), while `dim_geo` uses the 2020+ series
(Manila = province `806`, BARMM = region `19`, provinces 3-digit). `ingestion/build_poverty.py`
derives dim_geo's province code from the old PSGC, then **name-matches the city/municipality within
that province** (tolerant of the province widening and Manila's district split), with
region-scoped unique-name matching as the fallback. Match methods over the 1,611 source rows:

| method       | rows  | what it resolves |
|--------------|------:|------------------|
| `provname`   | 1,568 | province-code-scoped name match (the bulk) |
| `regionuniq` |    35 | region-scoped unique name (NCR, and the 2022 Maguindanao split whose old province `38` no longer resolves) |
| `provseq`    |     4 | Manila districts by municipality sequence (e.g. source `Tondo` → dim_geo `TONDO I/II`) |
| `override`   |     1 | Parang, Maguindanao del Norte (`1908709`) — collides by name with Sulu's Parang region-wide |

**Coverage: 1,607 / 1,651 dim_geo city/municipalities** carry an estimate (4,821 rows = 1,607 × 3
years). The residual is fully accounted for below — nothing is silently dropped (the 1.6
discipline). Machine-readable detail: `ingestion/_qa_report_poverty.json`.

## Reconciliation residuals (documented, never guessed)

**4 source rows unmatched** — City-of-Manila districts dim_geo folds together and has no separate
node for: **Binondo, San Miguel, Ermita, Intramuros** (dim_geo splits Manila into 10 districts,
the source into 14). Their poverty simply has no dim_geo home.

**44 dim_geo city/municipalities with no estimate**, categorised:

- **34 Highly Urbanized Cities** — the source is **"noHUC"**: HUCs are a separate SAE domain and
  carry no city/municipal-level estimate here (Cebu, Davao, Iloilo, Zamboanga, Cagayan de Oro,
  Bacolod, Cotabato City, Baguio, Angeles, Olongapo, …). **All of Metro Manila outside the City of
  Manila** is HUCs and so is likewise absent.
- **8 BARMM Special Geographic Areas** (dim_geo province `19999` — Kapalawan, Old Kaabakan, …) —
  not enumerated as LGUs in the source.
- **Pateros** (`1381701`) — the sole Metro Manila municipality; the source's NCR coverage is
  Manila's districts only, so it is absent with the rest of Metro Manila.
- **Kalayaan, Palawan** (`1705321`) — matched to dim_geo but has **no estimate any year** ("not
  generated", the source's own footnote 3, a former exclusive military installation).

## Downstream

- `agg_poverty` (RLS: public read, service write — same posture as every `agg_*`; holds public
  city/municipal statistics, no individuals). One row per `(dataset_id, geo_code, sae_year)`.
- **Relationships axis** (`lib/analysis/map-indicators.ts` `REL_EXTERNAL_INDICATOR_META`): poverty
  incidence selectable on either axis, offered only where children are citymun, every rendering
  source-stamped ("Poverty incidence: PSA Small Area Estimates 2023 · city/municipality") with the
  ecological-comparison sentence. The workforce **map** never lists it (`schema.ts` keeps
  `REL_EXTERNAL_INDICATORS` out of `MAP_BASE_INDICATORS`).
- **Insight** `bhw-density-vs-poverty` (`lib/db/insights.ts`): correlates each province's
  city/municipal BHWs-per-1,000-residents (census-denominated, E4.2) against poverty incidence,
  emitting a card **only when |ρ| ≥ 0.4** (moderate) — never a story fabricated from noise. Fires
  for 22 of 118 provinces on the loaded data (mostly a moderate positive link — more BHWs per
  capita where poverty is higher, consistent with program targeting).
- `/methodology#relationships` + `glossary(poverty_incidence)` document the source, the HUC gap,
  and the ecological caveat.

## Reproduce

```
# offline reconciliation (needs a dim_geo dump: ingestion/dim_geo.json)
python ingestion/build_poverty.py --dim-geo-json ingestion/dim_geo.json --verify
# emit idempotent upsert SQL / load directly
python ingestion/build_poverty.py --dim-geo-json ingestion/dim_geo.json --emit-sql-dir OUT
python ingestion/build_poverty.py --database-url "$DATABASE_URL"
```

Loaded live via the Supabase MCP (a temporary `security definer` RPC upsert from JSON, dropped
immediately after) into project `bhw-connect`; verified 4,821 rows, 1,607 citymun, 0 orphan FKs,
incidence range 1.21 %–67.83 % for 2023.
