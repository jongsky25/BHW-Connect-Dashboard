-- UUC for PHC 2025 data quality — the cleaning report as a surface (docs/UUC_PHC_2025_PLAN.md U10).
--
-- `docs/UUC_PHC_2025_CLEANING_REPORT.md` §6 is the most important thing written about this dataset
-- and it is invisible to anyone using it. This increment renders it at `/uuc-phc/data-quality`.
--
-- **The page is a claim about our own data, so every figure on it is computed and none is typed.**
-- A hand-written "1,584" drifts the first time the extract is regenerated, and a stale data-quality
-- page is worse than none. That constraint is what decides the shape of everything below:
--
--   * two **views**, not tables, for anything derivable from `fact_uuc_phc_indicators`. A view
--     cannot go stale against the fact table it reads, which is the whole property this page needs.
--     Both are cheap — 5,987 rows, no index required — and both run `security_invoker = true` on
--     `ref_uuc_phc_provincial`'s precedent (plan U5): the fact table's own public-read policy
--     decides access, and the view adds no privilege of its own.
--   * one small **table** for the published-total reconciliation, because its other side is not in
--     our data at all. See its own note.
--
-- Three of the page's four sections need no new object whatsoever, which is worth stating so the
-- next reader does not add one:
--
--   * *what was bounded, per indicator* — `agg_uuc_phc_indicator_dist`'s national rows already
--     carry `bin_capped` per indicator against `n_listed` (plan U9).
--   * *how many barangays cannot support criterion (d), per province* —
--     `agg_uuc_phc_criteria.n_listed - n_health_evaluable` already computes exactly that (plan U7).
--   * *which provinces carry an FIC benchmark no barangay can reach* —
--     `agg_uuc_phc_indicator_dist` province rows where `provincial_ref > value_max` (plan U9).
--
-- `ref_uuc_phc_benchmark_gaps` below exists to add the one thing those cannot express: *why* each
-- province's benchmarks are unusable. "Placeholder, zero-fill, missing or fraction" is four
-- different findings, and a page that collapses them into "unusable" throws away the part the
-- source office would act on.

-- ---------------------------------------------------------------------------------------------
-- 1. The national data-quality facts that are not derivable from the existing aggregates.
--
-- `n_values_capped` could be summed from `agg_uuc_phc_indicator_dist`, and is here anyway so that
-- one read answers the page's lead paragraph; the assertion at the foot of this file fails the
-- migration if the two ever disagree.
--
-- **`n_barangays_capped` is the figure that needs this view.** 1,584 values fall across 1,397
-- barangays, not 1,584 — 167 barangays carry more than one bounded value — and no per-indicator
-- aggregate can count a barangay once. Presenting 1,584 as a barangay count would overstate the
-- affected share of the list by 13%.
--
-- **The score columns recompute what the source office recorded, purely to measure the gap.**
-- `fact_uuc_phc_indicators.health_indicators` is documented as loaded-not-derived: the source
-- scored criterion (d) before cleaning bounded the values, so it cannot be re-derived from the
-- published columns. That is a claim about our own data, so this page has to *show* it rather than
-- assert it — which means performing the derivation the column note warns against, once, and
-- reporting how far off it lands. It is measurement, not substitution: nothing reads these columns
-- as a score, and `agg_uuc_phc_criteria` still counts the source's own classification.
--
-- The recomputation deliberately uses `comparesWorse` alone (a benchmark that exists and does not
-- exceed the indicator's maximum), **not** U9's placeholder rule. That is the derivation the
-- column note characterises, so it is the one whose disagreement is worth quoting. Applying the
-- placeholder rule as well makes the recomputation disagree on *more* rows, not fewer — recorded
-- in docs/DECISIONS.md rather than rendered, because two disagreement figures on one page invites
-- the reader to think one of them is the right way to derive the score. Neither is.
create or replace view ref_uuc_phc_quality
with (security_invoker = true) as
with scored as (
  select
    i.geo_code,
    cardinality(i.capped_indicators) as n_capped,
    i.health_indicators,
    -- comparesWorse, per indicator, in the direction criterion (d) asks it. A null benchmark or
    -- one above the indicator's own maximum contributes nothing, exactly as the read layer's
    -- function returns null rather than false.
    ( coalesce(i.imr_prov_ref       <= 1000 and i.imr       > i.imr_prov_ref,       false)::int
    + coalesce(i.ufmr_prov_ref      <= 1000 and i.ufmr      > i.ufmr_prov_ref,      false)::int
    + coalesce(i.abr_prov_ref       <= 1000 and i.abr       > i.abr_prov_ref,       false)::int
    + coalesce(i.fic_prov_ref       <=  100 and i.fic       < i.fic_prov_ref,       false)::int
    + coalesce(i.pre_natal_prov_ref <=  100 and i.pre_natal < i.pre_natal_prov_ref, false)::int
    + coalesce(i.sba_prov_ref       <=  100 and i.sba       < i.sba_prov_ref,       false)::int
    + coalesce(i.water_prov_ref     <=  100 and i.water     < i.water_prov_ref,     false)::int
    ) as recomputed,
    -- Whether any of the three socio-economic routes carries this barangay without criterion (d).
    ( coalesce(i.ip_pop, 0) >= 10
      or coalesce(i.armed_conf, 0) + coalesce(i.idp, 0) >= 10
      or coalesce(i.elcac_brgy, false)
      or coalesce(i.four_ps, 0) >= 50 ) as other_route
  from fact_uuc_phc_indicators i
  where i.dataset_id = (select dataset_id from dim_dataset where slug = 'uuc-phc-2025')
)
select
  count(*)::int                                              as n_listed,
  count(*) filter (where n_capped > 0)::int                  as n_barangays_capped,
  coalesce(sum(n_capped), 0)::int                            as n_values_capped,
  count(*) filter (where n_capped > 1)::int                  as n_barangays_multi_capped,
  -- Both score columns are counted only over barangays that HAVE a recorded score. Where the
  -- source recorded none there is nothing for the recomputation to disagree with, and counting it
  -- as a disagreement would inflate a figure the page presents as a measured gap. One barangay is
  -- in that position: SUMISIP CENTRAL, which the final-list alignment added from a sheet that
  -- carries no criterion (d) score (20260828180000_uuc_phc_final_list_alignment.sql).
  count(*) filter (where health_indicators is not null
                     and recomputed is distinct from health_indicators)::int
                                                             as n_score_disagreement,
  count(*) filter (where health_indicators is not null
                     and recomputed < health_indicators)::int as n_score_understated,
  -- Listed barangays that would qualify on no route at all if criterion (d) were recomputed —
  -- which DOH AO No. 2020-0023 makes impossible, and which is why the source's own score is the
  -- one that decided this list.
  count(*) filter (where not other_route and recomputed < 4)::int as n_no_route_if_recomputed,
  count(*) filter (where not other_route and coalesce(health_indicators, 0) < 4)::int
                                                             as n_no_route_as_recorded
from scored;

comment on view ref_uuc_phc_quality is
  'One row: the national data-quality facts behind /uuc-phc/data-quality that no per-indicator aggregate can express. n_barangays_capped counts BARANGAYS (1,397), not values (1,584) — 167 barangays carry more than one bounded value, so the two must never be swapped. The score columns recompute criterion (d) from the published columns solely to measure how far that derivation lands from the source''s own recorded score; they are a measurement of the gap, never a score to report, and they count only the barangays that have a recorded score to compare against. See docs/UUC_PHC_2025_PLAN.md §9 U10.';

-- ---------------------------------------------------------------------------------------------
-- 2. Why each province's benchmarks cannot carry criterion (d) — four different findings, kept
--    apart.
--
-- `agg_uuc_phc_criteria` already counts *how many* barangays are excluded per area. What it cannot
-- say is whether the province supplied nothing, supplied zeroes, supplied a placeholder 1, or
-- supplied fractions where percentages were wanted. Those are four different things to fix, and
-- the source office is the one who would fix them, so the page names each.
--
-- **The kinds are computed from the values, never from a list of province codes.** A hard-coded
-- list goes stale the first time a corrected extract arrives; this rule would simply stop firing.
--
-- The FIC row is a *different* finding sharing the same page section: Ilocos Sur and City of
-- Butuan supplied real benchmarks that happen to exceed 100, while every barangay FIC was bounded
-- to 100 (docs/UUC_PHC_2025_CLEANING_REPORT.md §6). Their barangays are not excluded from
-- criterion (d) as a whole — only from its FIC comparison — which is why they are a separate
-- `kind` and not folded in with the 226.
create or replace view ref_uuc_phc_benchmark_gaps
with (security_invoker = true) as
with brgy as (
  select
    i.*,
    g.province_code,
    greatest(i.imr_prov_ref, i.ufmr_prov_ref, i.fic_prov_ref, i.abr_prov_ref,
             i.pre_natal_prov_ref, i.sba_prov_ref, i.water_prov_ref) as top_ref
  from fact_uuc_phc_indicators i
  join dim_geo g on g.geo_code = i.geo_code
  where i.dataset_id = (select dataset_id from dim_dataset where slug = 'uuc-phc-2025')
),
listed_per_province as (
  select province_code, count(*)::int as n_listed_province from brgy group by province_code
),
-- (a) The 226: barangays whose whole benchmark set cannot support criterion (d) at all. U7's rule,
--     verbatim — the largest of the seven is missing, or is at most 1.
placeholder as (
  select
    b.province_code,
    case
      when count(b.top_ref) = 0 then 'no reference supplied'
      when max(b.top_ref) = 0    then 'every value zero'
      when max(b.top_ref) = 1    then 'every value exactly 1'
      else 'fractions where percentages were wanted'
    end as kind,
    count(*)::int as n_affected,
    max(b.top_ref) as witness_value
  from brgy b
  where coalesce(b.top_ref > 1, false) = false
  group by b.province_code
),
-- (b) The 113: a real FIC benchmark that no barangay can reach, because barangay FIC was bounded
--     to 100 and the benchmark was not.
unreachable_fic as (
  select
    b.province_code,
    'FIC benchmark above the 100 ceiling barangay values were bounded to' as kind,
    count(*)::int as n_affected,
    max(b.fic_prov_ref) as witness_value
  from brgy b
  where b.fic_prov_ref > 100
  group by b.province_code
)
select
  gaps.province_code,
  lp.n_listed_province,
  gaps.kind,
  gaps.n_affected,
  gaps.witness_value,
  -- Which of the two findings this row is, so a page can group without matching on prose.
  gaps.finding
from (
  select province_code, kind, n_affected, witness_value, 'criterion_d' as finding from placeholder
  union all
  select province_code, kind, n_affected, witness_value, 'fic_only'    as finding from unreachable_fic
) gaps
join listed_per_province lp on lp.province_code = gaps.province_code;

comment on view ref_uuc_phc_benchmark_gaps is
  'One row per province whose provincial benchmarks carry a data-quality finding, with WHICH finding it is. finding = criterion_d marks the 226 barangays in 5 provinces whose whole benchmark set cannot support criterion (d) (no reference, zeroes, a placeholder 1, or fractions); finding = fic_only marks the 113 barangays in 2 provinces whose real FIC benchmark exceeds the 100 ceiling barangay FIC was bounded to, which affects that one comparison and not the rest. n_affected is barangays, and is not always the province''s whole listed count: in province 09317 only 7 of 8 lack a reference. Computed from the values, never from a list of province codes.';

-- ---------------------------------------------------------------------------------------------
-- 3. The published-total reconciliation — the one figure on the page whose other side is not our
--    data.
--
-- The 2027 Budget Cue Cards p37 publishes *Distribution of UUC for PHC Barangays by Region (as of
-- 2025 per DC No. 2025-0549)*, totalling 5,987 against the workbook's 5,991. Plan §3 records the
-- owner's decision as it stood when this file was written: publish 5,991 and footnote p37's 5,987
-- with its as-of date. U10 renders that footnote as a surface, with the two regions the difference
-- sits in. **That reconciliation has since closed** — the source office's final list carries
-- 5,987, so the dashboard publishes it and this table is empty. See
-- 20260828180000_uuc_phc_final_list_alignment.sql.
--
-- **The figures are parsed from the corpus chunk, never typed into this file.** p37 is loaded in
-- `doc_chunk` (Increment 2.1), so the source is on hand and the comparison is computed rather than
-- transcribed — which is the rule the whole page is built on. A typo in a hand-copied 400 would be
-- indistinguishable from a real discrepancy, and this table's entire purpose is to say which
-- regions really differ.
--
-- **Why a table and not a view.** `doc_source` / `doc_chunk` are service-role only — no anon or
-- authenticated policy — so a `security_invoker` view over them would read as empty for the very
-- caller the page runs as. Parsing once, here, into a public-read table is what makes the figure
-- reachable at all. Re-running this file re-parses, so it is still not a typed constant.
--
-- **Only the rows that differ are stored, and that is deliberate.** `doc_source` marks the cue
-- cards `exposure = 'internal'`; plan §3 approves publishing the *reconciliation* (the total and
-- its as-of date), and U10 asks for the two affected regions. Storing p37's other 15 rows — which
-- match ours to the unit and say nothing — would republish an internal document's table for no
-- reconciliation benefit. The migration still parses and checks all 17, so the two rows below are
-- a computed finding rather than a chosen pair.
create table if not exists ref_uuc_phc_published_delta (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),
  -- 'PH' for the published total, a region code for a region that differs.
  geo_code text not null references dim_geo (geo_code),
  geo_level geo_level_enum not null,
  -- The region label exactly as p37 prints it, so a reader can find the row in the source.
  source_label text not null,
  -- What the cue cards publish for this geography.
  n_published integer not null,
  -- What this dashboard publishes, from agg_uuc_phc_counts.
  n_listed integer not null,
  -- n_listed - n_published. Never zero: only differing rows are stored.
  delta integer not null,
  -- The document and page the published figure was read from, so the citation travels with it.
  source_doc_key text not null,
  source_page integer not null,
  -- The date p37 speaks as of, from doc_source.as_of. The vintage reading in plan §3 turns on it.
  source_as_of date,

  unique (dataset_id, geo_code, geo_level)
);

comment on table ref_uuc_phc_published_delta is
  'The 2025 UUC for PHC published-total reconciliation: every geography where the 2027 Budget Cue Cards p37 figure differs from this dashboard''s. Empty since the final-list alignment: the dashboard publishes the source office''s 5,987, which is p37''s figure, so every geography agrees. Parsed from the doc_chunk copy of p37 rather than transcribed, so a discrepancy here is a real one. The 15 regions that match to the unit are checked by the migration and deliberately not stored: the cue cards are an internal-exposure document and a matching row carries no reconciliation. THE VINTAGE READING IS INFERENCE: p37 is a snapshot "as of 2025 per DC No. 2025-0549" and the workbook file name reads as a later revision, but neither source states this. See docs/UUC_PHC_2025_PLAN.md §3.';

comment on column ref_uuc_phc_published_delta.delta is
  'n_listed - n_published. Positive where this dashboard lists more barangays than the cue cards do. Never zero — matching geographies are not stored.';

alter table ref_uuc_phc_published_delta enable row level security;

drop policy if exists "ref_uuc_phc_published_delta public read" on ref_uuc_phc_published_delta;
create policy "ref_uuc_phc_published_delta public read" on ref_uuc_phc_published_delta
  for select
  to anon, authenticated
  using (true);

-- Populate. Idempotent: re-parses and upserts, so re-running after a corpus or fact reload is the
-- refresh procedure. Rows that have stopped differing are deleted, so a corrected cue card empties
-- the table rather than leaving a stale discrepancy on the page.
with ds as (
  select dataset_id from dim_dataset where slug = 'uuc-phc-2025'
),
doc as (
  select s.key, s.as_of, c.page_from, c.content
  from doc_chunk c
  join doc_source s on s.doc_id = c.doc_id
  where s.key = 'blhsd-2027-budget-cue-cards'
    and c.page_from = 37 and c.page_to = 37
),
-- p37 sets each region name on its own line with the count on the next: "REGION V (BICOL
-- REGION)\n757\n\n". The header row ("REGION\nNUMBER") cannot match because NUMBER is not digits.
pairs as (
  select (m)[1] as label, (m)[2]::int as n
  from doc, regexp_matches(doc.content, '([A-Z][^\n]*)\n(\d+)', 'g') as m
),
published as (
  -- Matched to dim_geo on the printed name. Exact, not fuzzy: p37 uses the PSA region names
  -- verbatim, and all 17 resolve — asserted below, so a renamed region fails the migration rather
  -- than silently dropping a row.
  select g.geo_code, 'region'::geo_level_enum as geo_level, p.label, p.n
  from pairs p
  join dim_geo g on g.geo_level = 'region' and g.geo_name = p.label
  where p.label <> 'TOTAL'
  union all
  select 'PH', 'national'::geo_level_enum, p.label, p.n
  from pairs p
  where p.label = 'TOTAL'
),
compared as (
  select
    pub.geo_code, pub.geo_level, pub.label, pub.n as n_published,
    c.n_listed,
    c.n_listed - pub.n as delta
  from published pub
  join agg_uuc_phc_counts c
    on c.dataset_id = (select dataset_id from ds)
   and c.geo_code = pub.geo_code and c.geo_level = pub.geo_level
)
insert into ref_uuc_phc_published_delta (
  dataset_id, geo_code, geo_level, source_label, n_published, n_listed, delta,
  source_doc_key, source_page, source_as_of
)
select
  (select dataset_id from ds), cmp.geo_code, cmp.geo_level, cmp.label,
  cmp.n_published, cmp.n_listed, cmp.delta,
  (select key from doc), (select page_from from doc), (select as_of from doc)
from compared cmp
where cmp.delta <> 0
on conflict (dataset_id, geo_code, geo_level) do update set
  source_label = excluded.source_label,
  n_published = excluded.n_published,
  n_listed = excluded.n_listed,
  delta = excluded.delta,
  source_doc_key = excluded.source_doc_key,
  source_page = excluded.source_page,
  source_as_of = excluded.source_as_of;

-- A geography that has stopped differing must leave, or the page keeps reporting a closed gap.
delete from ref_uuc_phc_published_delta d
where not exists (
  select 1
  from agg_uuc_phc_counts c
  where c.dataset_id = d.dataset_id and c.geo_code = d.geo_code and c.geo_level = d.geo_level
    and c.n_listed - d.n_published <> 0
);

-- ---------------------------------------------------------------------------------------------
-- Assert, after loading, what the page depends on. A failure aborts the migration rather than
-- publishing a wrong claim about our own data quality — which is the one kind of wrong figure this
-- page cannot afford.
do $$
declare
  n_bad integer;
  n_regions integer;
  n_total integer;
  n_sum integer;
begin
  -- 1. The parse found p37 and read it whole: 17 region rows, every one resolving to dim_geo, and
  --    a TOTAL row that equals their sum. A mis-parse that still balances is not reachable.
  with doc as (
    select c.content from doc_chunk c join doc_source s on s.doc_id = c.doc_id
    where s.key = 'blhsd-2027-budget-cue-cards' and c.page_from = 37 and c.page_to = 37
  ),
  pairs as (
    select (m)[1] as label, (m)[2]::int as n
    from doc, regexp_matches(doc.content, '([A-Z][^\n]*)\n(\d+)', 'g') as m
  )
  select
    (select count(*) from pairs where label <> 'TOTAL'),
    (select sum(n) from pairs where label <> 'TOTAL'),
    (select n from pairs where label = 'TOTAL'),
    (select count(*) from pairs p where p.label <> 'TOTAL'
       and not exists (select 1 from dim_geo g where g.geo_level = 'region' and g.geo_name = p.label))
  into n_regions, n_sum, n_total, n_bad;

  if n_regions <> 17 then
    raise exception 'cue cards p37 parsed % region rows, expected 17', n_regions;
  end if;
  if n_bad > 0 then
    raise exception '% region name(s) on cue cards p37 do not resolve to a dim_geo region', n_bad;
  end if;
  if n_sum is distinct from n_total then
    raise exception 'cue cards p37 regions sum to % but its TOTAL row reads %', n_sum, n_total;
  end if;

  -- 2. The one region p37 does not print must be the one with nothing listed. If a region with
  --    listed barangays ever goes unprinted, the reconciliation below is incomplete and silent.
  select count(*) into n_bad
  from dim_geo g
  join agg_uuc_phc_counts c
    on c.geo_code = g.geo_code and c.geo_level = 'region'
   and c.dataset_id = (select dataset_id from dim_dataset where slug = 'uuc-phc-2025')
  where g.geo_level = 'region'
    and c.n_listed > 0
    and not exists (
      select 1
      from doc_chunk ch join doc_source s on s.doc_id = ch.doc_id,
           regexp_matches(ch.content, '([A-Z][^\n]*)\n(\d+)', 'g') as m
      where s.key = 'blhsd-2027-budget-cue-cards' and ch.page_from = 37 and (m)[1] = g.geo_name
    );
  if n_bad > 0 then
    raise exception '% region(s) with listed barangays are absent from cue cards p37', n_bad;
  end if;

  -- 3. Every stored delta is real and its arithmetic holds against the published aggregate.
  select count(*) into n_bad
  from ref_uuc_phc_published_delta d
  join agg_uuc_phc_counts c
    on c.dataset_id = d.dataset_id and c.geo_code = d.geo_code and c.geo_level = d.geo_level
  where d.delta = 0 or d.n_listed <> c.n_listed or d.delta <> c.n_listed - d.n_published;
  if n_bad > 0 then
    raise exception '% published-delta row(s) do not reconcile against agg_uuc_phc_counts', n_bad;
  end if;

  -- 4. The capping totals agree with the per-indicator aggregate U9 publishes. They are computed
  --    from the same fact table by different routes, so agreement is a real check that neither
  --    counts a value the other misses — and it is the pair a reader will add up by hand.
  select count(*) into n_bad
  from ref_uuc_phc_quality q
  where q.n_values_capped <> (
    select coalesce(sum((select coalesce(sum(x), 0) from unnest(d.bin_capped) x)), 0)
    from agg_uuc_phc_indicator_dist d
    where d.geo_level = 'national'
      and d.dataset_id = (select dataset_id from dim_dataset where slug = 'uuc-phc-2025')
  );
  if n_bad > 0 then
    raise exception 'ref_uuc_phc_quality.n_values_capped disagrees with agg_uuc_phc_indicator_dist';
  end if;

  -- 5. Barangays carrying a bounded value cannot outnumber the values themselves, and the list
  --    cannot be smaller than either. This is what stops the page swapping 1,397 for 1,584.
  select count(*) into n_bad
  from ref_uuc_phc_quality
  where n_barangays_capped > n_values_capped
     or n_values_capped > n_listed * 7
     or n_barangays_capped > n_listed
     or n_barangays_multi_capped > n_barangays_capped;
  if n_bad > 0 then
    raise exception 'ref_uuc_phc_quality capping counts are inconsistent';
  end if;

  -- 6. The benchmark-gap view must account for exactly the barangays agg_uuc_phc_criteria excludes
  --    from route (d), and for exactly the barangays agg_uuc_phc_indicator_dist marks FIC-only.
  --    Three files implementing one rule; this is what stops one of them being edited alone.
  select count(*) into n_bad
  from (
    select coalesce(sum(n_affected), 0)::int as n
    from ref_uuc_phc_benchmark_gaps where finding = 'criterion_d'
  ) g
  cross join (
    select (n_listed - n_health_evaluable)::int as n
    from agg_uuc_phc_criteria
    where geo_level = 'national'
      and dataset_id = (select dataset_id from dim_dataset where slug = 'uuc-phc-2025')
  ) c
  where g.n <> c.n;
  if n_bad > 0 then
    raise exception 'ref_uuc_phc_benchmark_gaps criterion_d total disagrees with agg_uuc_phc_criteria';
  end if;

  select count(*) into n_bad
  from (
    select coalesce(sum(n_affected), 0)::int as n
    from ref_uuc_phc_benchmark_gaps where finding = 'fic_only'
  ) g
  cross join (
    select coalesce(sum(n_listed), 0)::int as n
    from agg_uuc_phc_indicator_dist
    where geo_level = 'province' and indicator = 'fic' and provincial_ref > value_max
      and dataset_id = (select dataset_id from dim_dataset where slug = 'uuc-phc-2025')
  ) d
  where g.n <> d.n;
  if n_bad > 0 then
    raise exception 'ref_uuc_phc_benchmark_gaps fic_only total disagrees with agg_uuc_phc_indicator_dist';
  end if;

  -- 7. The recomputation must be *worse* than the source's own score, never better — that is the
  --    substance of the claim the page makes about health_indicators. If a recomputation ever
  --    left zero barangays routeless while the source's score did too, the column note would need
  --    rewriting rather than rendering.
  select count(*) into n_bad
  from ref_uuc_phc_quality
  where n_no_route_as_recorded <> 0
     or n_no_route_if_recomputed = 0
     or n_score_understated <> n_score_disagreement;
  if n_bad > 0 then
    raise exception 'the criterion (d) recomputation no longer behaves as docs/UUC_PHC_2025_PLAN.md describes';
  end if;
end $$;
