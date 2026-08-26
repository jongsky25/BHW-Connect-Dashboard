-- UUC for PHC 2025 indicators — the measurements behind the list (plan U3).
--
-- Separate from fact_uuc_phc_barangay by design: that table is the *record* (which barangays are
-- on the 2025 list), this one is the *evidence* (the values each barangay was assessed on). The
-- list stands on its own — U1 and U2 render it without any of this — and these values carry
-- caveats the membership does not.
--
-- 12 indicators, not the source's 13: FP CU (the AO's Contraceptive Prevalence Rate) was dropped
-- by the source office before reconciliation. See docs/UUC_PHC_2025_CLEANING_REPORT.md §1.
--
-- **capped_indicators is the point of this table's design.** 1,584 values across 1,397 barangays
-- were recorded outside any possible range (Water as high as 9,594%, FIC 18,088) and were bounded
-- during cleaning — Water/Pre-natal/SBA/FIC at 100 as coverage percentages, IMR/UFMR/ABR at 1,000
-- as rates per 1,000. Once bounded, 886 Water and 456 FIC values read as exactly 100% with nothing
-- to distinguish them from barangays genuinely at full coverage. This column names, per barangay,
-- which of its indicators were bounded, so a rendered value can carry that fact with it. Without
-- it the values are not publishable; with it they are, one barangay at a time.
--
-- That is also why this increment adds **no aggregates**. A marker travels with a single value; it
-- cannot survive a mean or a median. Any future aggregate over Water or FIC must exclude or
-- footnote the capped rows — at 15% of barangays for Water, they are enough to move a national
-- figure — so the aggregate is deliberately left unbuilt rather than built unmarked.
--
-- **The provincial reference columns are stored per barangay on purpose.** Criterion (d) of DOH AO
-- No. 2020-0023 asks whether a barangay performs worse than its province, so the benchmark is read
-- alongside the value on every read path; keeping it on the row makes that a single-row lookup
-- with no join. The canonical one-row-per-province form is the ref_uuc_phc_provincial view below,
-- derived from these columns rather than maintained beside them; the seed migration asserts, after
-- loading, that no province carries two different reference values, so the two cannot disagree.
create table if not exists fact_uuc_phc_indicators (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),
  geo_code text not null references dim_geo (geo_code),

  -- Unconstrained numeric, not numeric(p,s): 15 source values carry three decimal places
  -- (an ABR of 48.912, an IMR of 4.347), and a scale of 2 would round them at insert. Rounding
  -- is a display decision, made in the UI; the table stores what the source supplied.
  --
  -- Qualifying factors (AO §VI.A). Percentages of the barangay's puroks or population.
  -- physical_factor has a floor of 25 in every row: below that a barangay never entered the list.
  physical_factor numeric,
  ip_pop numeric,
  armed_conf numeric,
  idp numeric,
  four_ps numeric,
  -- Designated a conflict-affected barangay. Source encodes 0/1.
  elcac_brgy boolean,

  -- Health indicators under criterion (d). IMR/UFMR/ABR are rates per 1,000 and may legitimately
  -- exceed 100; FIC/pre-natal/SBA/water are coverage percentages bounded at 100.
  imr numeric,
  ufmr numeric,
  fic numeric,
  abr numeric,
  pre_natal numeric,
  sba numeric,
  water numeric,

  -- The provincial benchmarks criterion (d) compares against. NULL where the source supplied #N/A.
  imr_prov_ref numeric,
  ufmr_prov_ref numeric,
  fic_prov_ref numeric,
  abr_prov_ref numeric,
  pre_natal_prov_ref numeric,
  sba_prov_ref numeric,
  water_prov_ref numeric,

  -- Which of this barangay's indicators were bounded during cleaning, by column name. Empty for
  -- the 4,594 barangays whose values were all in range.
  capped_indicators text[] not null default '{}',

  unique (dataset_id, geo_code)
);

create index if not exists fact_uuc_phc_indicators_geo_idx on fact_uuc_phc_indicators (geo_code);

comment on table fact_uuc_phc_indicators is
  'Per-barangay indicator values behind the 2025 UUC for PHC list, with the provincial benchmarks criterion (d) compares against. capped_indicators names the values bounded during cleaning — a bounded value is indistinguishable from a genuine one without it. See docs/UUC_PHC_2025_CLEANING_REPORT.md.';

alter table fact_uuc_phc_indicators enable row level security;

drop policy if exists "fact_uuc_phc_indicators public read" on fact_uuc_phc_indicators;
create policy "fact_uuc_phc_indicators public read" on fact_uuc_phc_indicators
  for select
  to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------------------------------
-- The provincial reference, one row per province, derived rather than stored.
--
-- Keyed on dim_geo's province_code, never on the source's province *names*: 9 of the source's 88
-- name groups do not match dim_geo (the HUCs — Puerto Princesa, Zamboanga, Davao, Butuan, Iligan,
-- Cagayan de Oro, Isabela — plus BARMM's Special Geographic Area and one blank). Going through the
-- barangay codes reuses the geography U1 verified exhaustively and matches nothing by string.
--
-- That regrouping also corrects the source's own count. It presents 88 province groups, but two of
-- them are Zamboanga City: 7 barangays filed under a *blank* province name with no reference at
-- all, and 1 filed under "CITY OF ZAMBOANGA" with a full set. dim_geo files all 8 under province
-- 09317, so there are **87 provinces**, not 88.
--
-- **n_with_reference is why this view is not a plain max().** Reference values are all-or-nothing
-- per barangay (5,934 carry all seven, 57 carry none), and in exactly one province — 09317, that
-- same Zamboanga City — only 1 of 8 listed barangays carries one. A bare max() would report that
-- single value as the province's benchmark and read as complete, quietly making criterion (d) look
-- evaluable for 7 barangays the source leaves unevaluable. Exposing the count alongside the value
-- keeps the gap visible. Consumers comparing a barangay to its province should read the barangay's
-- own *_prov_ref column, which is NULL exactly where the source supplied none.
--
-- max() is safe for the value itself: the seed migration asserts that no province carries two
-- different reference values (verified — 0 do), so where a value exists it is unambiguous.
create or replace view ref_uuc_phc_provincial as
select
  g.province_code,
  count(*)::int as n_listed_barangays,
  -- Any one column is a valid witness: coverage is all-or-nothing per barangay.
  count(i.water_prov_ref)::int as n_with_reference,
  max(i.imr_prov_ref) as ref_imr,
  max(i.ufmr_prov_ref) as ref_ufmr,
  max(i.fic_prov_ref) as ref_fic,
  max(i.abr_prov_ref) as ref_abr,
  max(i.pre_natal_prov_ref) as ref_pre_natal,
  max(i.sba_prov_ref) as ref_sba,
  max(i.water_prov_ref) as ref_water
from fact_uuc_phc_indicators i
join dim_geo g on g.geo_code = i.geo_code
group by g.province_code;

comment on view ref_uuc_phc_provincial is
  'One row per province (87): the benchmarks criterion (d) of DOH AO No. 2020-0023 tests barangays against. Derived from fact_uuc_phc_indicators. n_with_reference vs n_listed_barangays exposes partial coverage — in province 09317 only 1 of 8 barangays carries a reference.';
