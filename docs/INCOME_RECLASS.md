# LGU income reclassification report (E4.3)

Table: `dim_lgu_income_reclass`. Migration: `supabase/migrations/20260721080000_e4_3_income_reclass.sql`.
Builder / reconciler: `ingestion/build_income_reclass.py` — re-run it against the source PDF + a
`dim_geo` export to refresh the mapping and this report. Reviewed artifact (with source LGU names):
`ingestion/data/income_reclass_2024.csv`.

## What this is for

`dim_geo.income_class` previously carried the LGU income class **as reported in the StepZero
sheets** — an older vintage, roughly the DOF DO 23-08 (2008) schedule. RA 11964 (the Automatic
Income Classification of LGUs Act) replaced the old **six-class** ladder (1st–6th) with **five**
classes (1st–5th) and recomputed every province, city, and municipality from FY2021–2023 average
regular income. **DOF Department Order No. 074-2024** (Annex A) is the authoritative schedule; it
took effect **1 January 2025**.

E4.3 refreshes `dim_geo.income_class` to the DO 074-2024 value, preserves the superseded value in
`dim_geo.income_class_prior`, and records the full per-LGU mapping in `dim_lgu_income_reclass`.
E3.7's income-class equity figure (`agg_by_income_class`) re-runs on the new classes.

## Source & the join problem

The DOF Annex A is a table of `REGION · [PROVINCE ·] LGU NAME · old class (DO 23-08) · new class`.
It carries **no PSGC codes**, and it labels regions with the **pre-NIR** vintage (Negros
Occidental under Region VI, Negros Oriental + Siquijor under Region VII). So the join to `dim_geo`
is **name-based**, province-scoped, and NIR-aware:

1. Resolve the province from the row's region+province text (aliases: "North Cotabato" → dim_geo
   "Cotabato"; "Negros" disambiguated by pre-NIR region VI/VII; "X del" expanded to both Norte/Sur
   when the source dropped the suffix).
2. Fuzzy-match the LGU name within that province (`rapidfuzz` token-sort). Highly-urbanized and
   independent cities (which DOF lists under a mother province but `dim_geo` files as their own
   "province") are matched by name against the HUC set.
3. Accept at score ≥ 88; everything else is an explicit, eyeball-verified override in the builder's
   `OVERRIDES` table (the plan's "manual fixups file") — 45 rows, each annotated.

The public source is an **OCR'd mirror** (`DO_074.2024_with_table.pdf`), so a handful of names carry
OCR noise (e.g. "Piiias" → Piñas, "Sais" → Bais, "Tuba" → Tubo); these are in the overrides.

## Coverage

| grain | classified | total | notes |
|---|---|---|---|
| city / municipality | **1637** | 1651 | 14 unclassified, all expected (below) |
| province | **81** | 82 | Eastern Samar omitted from the source Annex |

Mapping rows loaded: **1724** (1715 Annex A rows − 1 fan-out source + the Manila fan-out; see below).
Distinct `geo_code`s: 1724. Duplicate targets: **0**.

New city/municipality class distribution (DO 074-2024): 1st **785**, 2nd **273**, 3rd **273**,
4th **242**, 5th **64**. (Live `dim_geo` shows a few more per class plus 5 in the 6th slot — those
are the unclassified LGUs below, which retain their prior class.)

## Reconciliation — the 14 unclassified city/municipalities

**6 the source itself leaves unclassified** (kept their prior class; never guessed):

- **Ubay, Bohol** — the Annex prints a literal dash ("–") in the new-class column.
- **Ungkaya Pukan (Basilan); Amai Manabilang, Butig, Malabang, Marantao (Lanao del Sur)** — the
  Annex prints "New" (newly-created / not yet assigned a computed class).

**8 BARMM Special Geographic Areas** (Kapalawan, Old Kaabakan, Kadayangan, Nabalawag, Pahamuddin,
Malidegao, Ligawasan, Tugunan) — the former Cotabato "SGA" barangay-clusters that joined BARMM;
DOF does not classify them as LGUs.

## Reconciliation — provinces

**Eastern Samar** is absent from the Annex A province list (Region VIII shows only Biliran, Leyte,
Northern Samar, Samar, Southern Leyte). Its `dim_geo` province row keeps `income_class` null — a
net non-loss, since provinces carried no income class before E4.3. Its municipalities are
classified normally from the municipalities table.

## Notable source fix-ups (documented, not guessed)

- **Manila** — the Annex has one "Manila City" row (Special → 1st); it fans out to all **10**
  `dim_geo` City-of-Manila district rows (Tondo I/II … Santa Ana), all class 1.
- **Buenavista, Agusan del Norte** — the Annex mislabels this row under "Region XII / Sultan
  Kudarat" (which has **no** Buenavista). The row sits in the Agusan del Norte alphabetical block
  (immediately before Carmen), and Agusan's Buenavista is the only one of the country's five
  Buenavistas otherwise unmatched, so it is mapped there with this note.
- **"New Lucena, Iloilo"** and other `New <Name>` municipalities — the parser initially dropped the
  leading "New" (it matches the class-token "New"); fixed so these resolve directly.

## Validation

The Annex A **old** column (DOF DO 23-08 vintage) was cross-checked against `dim_geo`'s prior
`income_class`: LGU **names align across the board** (confirming correct joins), while the *classes*
differ systematically — `dim_geo`'s prior value is consistently a higher income class than the 2008
column, consistent with real income growth (notably the post-Mandanas NTA increase), not with
mismatches. The new-vs-prior delta is dominated by "unchanged" (1,422 LGUs) with the rest mostly
±1–2 classes — a realistic reclassification, not noise.

## How to regenerate

```
python ingestion/build_income_reclass.py \
    --pdf DO_074.2024_with_table.pdf \
    --dim-geo-json dim_geo.json \        # or --database-url "$DATABASE_URL"
    --out ingestion/data/income_reclass_2024.csv
```

The script prints this reconciliation to stderr. `dim_dataset.status` is `active`; refresh
`as_of_date`/`version` if a newer DOF order supersedes DO 074-2024.
