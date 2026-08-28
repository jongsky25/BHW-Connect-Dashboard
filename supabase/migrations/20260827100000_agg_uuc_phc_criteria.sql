-- UUC for PHC 2025 criteria aggregate — how many of an area's listed barangays qualified by each
-- socio-economic route (docs/UUC_PHC_2025_PLAN.md increment U7).
--
-- DOH AO No. 2020-0023 §VI.A lists a barangay only when a physical factor AND a socio-economic
-- factor are both present. The physical factor is not counted here: it holds in every one of the
-- every row by construction, because a barangay below the 25% floor never entered the list, so a
-- count of it is a count of the list. What varies is *which* socio-economic route carried the
-- barangay, and until now that was visible only inside a <details> on one city page at a time.
--
--   n_route_ip         (a) at least 10% of the population are Indigenous Peoples
--   n_route_conflict   (b) armed conflict + displacement together reach 10%, OR the barangay is
--                          designated a conflict-affected (ELCAC) area
--   n_route_four_ps    (c) at least 50% of the population enrolled in 4Ps/CCT
--   n_route_health     (d) worse than the province on at least 4 of the 7 health indicators
--
-- **The routes overlap, and these four columns do not partition n_listed.** A barangay can qualify
-- on three at once; nationally the four counts sum to about 141% of the list. Any renderer of this
-- table must therefore draw four independent shares — never a stacked bar, never a pie, both of
-- which assert a partition that does not exist. components/uuc-phc/route-shares.tsx is the one
-- that does.
--
-- **Criterion (b) is summed, not either/or.** The source marks it met when armed_conf + idp >= 10,
-- which reproduces its own Pass/Fail on every row it scored; reading the order's "or" as either-alone
-- disagrees on 15. Implemented as the file does, with the divergence recorded in
-- docs/UUC_PHC_2025_PLAN.md §1a — the same choice lib/db/uuc-phc-indicators.ts made in U3, so the
-- aggregate and the per-barangay disclosure cannot say different things about the same barangay.
--
-- **Why this aggregate is safe where U3's per-indicator ones were not.** U3 declined to publish
-- indicator aggregates because a mean absorbs the capped ceilings and reports coverage the source
-- does not support: a † marker travels with one rendered value and cannot survive an average. A
-- route count is a count of *classifications*, not of measurements. It never averages a bounded
-- value, so that failure mode does not arise. The one route that touches the capped columns is
-- (d), and it inherits §1a's caveat rather than a new one.
--
-- **(d)'s route uses the source's own score, not a recomputation.** See the health_indicators
-- column note in 20260826150000_fact_uuc_phc_indicators.sql: deriving the score from the published
-- (capped) columns disagrees with the source on 664 rows and leaves 98 listed barangays qualifying
-- on no route at all, which the AO makes impossible. Counting the source's classification is what
-- keeps this column a count of classifications.
--
-- **The health route has its own denominator.** For 226 barangays in 5 provinces the provincial
-- reference cannot support criterion (d) at all — Agusan del Sur's benchmarks are every one
-- exactly 1, Cagayan's every one 0, Nueva Vizcaya and Zamboanga City supplied none, and BARMM's
-- Special Geographic Area recorded fractions rather than percentages. Their listing is not in
-- doubt; the comparison behind route (d) simply cannot be evaluated for them. They are excluded
-- from n_health_evaluable, so a share of the health route is a share of the barangays the route
-- could apply to. The other three routes keep n_listed, which is their real denominator.
--
-- n_not_evaluable is deliberately NOT stored: it is n_listed - n_health_evaluable, and the read
-- layer derives it, keeping one definition in one place — U2's discipline for the share.
--
-- **The not-evaluable test is computed, not a list of province codes.** A province's seven
-- benchmarks are three rates per 1,000 and four coverage percentages; a real set has at least one
-- value well above 1. So "the largest of this barangay's seven benchmarks is null, or is at most
-- 1" identifies a placeholder, a zero-fill or a fraction encoding without naming a province. It
-- selects exactly the 226 barangays in those 5 provinces and nothing else. Hard-coding the codes
-- would go stale the first time a corrected extract arrives; this rule would simply stop firing.
--
-- Note the count is **226, not the 238 that docs/UUC_PHC_2025_PLAN.md §1a and
-- docs/UUC_PHC_2025_CLEANING_REPORT.md §6 both state.** Their own per-province tables read
-- 156 + 50 + 12 + 7 + 1, which is 226; 238 is an addition error carried through both documents and
-- into §9 and §10. Both round to the 4% of the list they also quote. Corrected in those documents
-- by this increment, and computed here rather than typed so it cannot drift again.
--
-- Derived entirely in SQL from fact_uuc_phc_indicators + dim_geo, on U2's precedent: there is no
-- generated seed to drift, and re-running this file recomputes every row. **That is the refresh
-- procedure**, after the fact seed.
create table if not exists agg_uuc_phc_criteria (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),
  geo_code text not null references dim_geo (geo_code),
  geo_level geo_level_enum not null,

  -- Barangays in this area on the 2025 list — the denominator for routes (a), (b) and (c).
  -- Duplicated from agg_uuc_phc_counts so a reader of this table has its own denominator; the
  -- assertion at the foot of this file fails the migration if the two ever disagree.
  n_listed integer not null default 0,

  n_route_ip integer not null default 0,
  n_route_conflict integer not null default 0,
  n_route_four_ps integer not null default 0,

  -- Route (d), counted only among the barangays whose provincial reference can support it.
  n_route_health integer not null default 0,
  -- The health route's denominator: listed barangays whose criterion (d) is evaluable at all.
  n_health_evaluable integer not null default 0,

  unique (dataset_id, geo_code, geo_level)
);

-- Read paths mirror agg_uuc_phc_counts': one area exactly, and every child at a level.
create index if not exists agg_uuc_phc_criteria_geo_idx
  on agg_uuc_phc_criteria (geo_code, geo_level);
create index if not exists agg_uuc_phc_criteria_level_idx
  on agg_uuc_phc_criteria (dataset_id, geo_level);

comment on table agg_uuc_phc_criteria is
  'Per-geo counts of listed barangays qualifying by each socio-economic route of DOH AO No. 2020-0023 §VI.A. The four route counts OVERLAP and do not sum to n_listed — a barangay can qualify on several — so they must be rendered as four independent shares, never stacked or as a pie. Route (d) counts only barangays whose provincial reference can support the comparison: its denominator is n_health_evaluable, not n_listed. See docs/UUC_PHC_2025_PLAN.md §9 U7.';

comment on column agg_uuc_phc_criteria.n_route_conflict is
  'Criterion (b): armed_conf + idp >= 10, or the barangay is ELCAC-designated. The two are summed rather than read as the order''s "or" — that is what reproduces the source''s own Pass/Fail on every row it scored. See docs/UUC_PHC_2025_PLAN.md §1a.';

comment on column agg_uuc_phc_criteria.n_route_health is
  'Criterion (d): the source''s own health_indicators score is at least 4 of 7, counted only among barangays whose provincial reference can support the comparison. Its denominator is n_health_evaluable, never n_listed.';

comment on column agg_uuc_phc_criteria.n_health_evaluable is
  'Listed barangays in this area whose provincial reference can support criterion (d). Nationally 5,761 of 5,987: 226 barangays in 5 provinces carry benchmarks that are placeholders, zeroes, missing or fractions. n_listed - n_health_evaluable is the excluded count, derived in the read layer.';

alter table agg_uuc_phc_criteria enable row level security;

-- Public, aggregate-only (no personal data): anyone may read; no client writes. Same policy shape
-- as agg_uuc_phc_counts.
drop policy if exists "agg_uuc_phc_criteria public read" on agg_uuc_phc_criteria;
create policy "agg_uuc_phc_criteria public read" on agg_uuc_phc_criteria
  for select
  to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------------------------------
-- Populate. Idempotent: recomputes and upserts every row, so re-running after a fact reload is
-- the refresh procedure. The (dataset_id, geo_code, geo_level) unique key makes every row a
-- stable target, so nothing is deleted.
--
-- A row exists for every geo, including those with nothing listed — U2's decision, for U2's
-- reason: omitting them would render "0 of this area's barangays qualified on any route" as
-- "no data", and NCR's zero is a result rather than a gap.
with ds as (
  select dataset_id from dim_dataset where slug = 'uuc-phc-2025'
),
brgy as (
  -- One row per barangay in the country, carrying its route flags where it is listed and zeroes
  -- where it is not. A LEFT JOIN, not an inner one: the zero rows are the point.
  select
    g.citymun_code,
    g.province_code,
    g.region_code,
    (i.geo_code is not null)::int as listed,
    (coalesce(i.ip_pop, 0) >= 10)::int as route_ip,
    -- Criterion (b) is the union of the summed conflict/displacement test and the ELCAC
    -- designation. Nulls read as 0 in the sum, which cannot manufacture a pass: a pass needs 10.
    ((coalesce(i.armed_conf, 0) + coalesce(i.idp, 0) >= 10)
       or coalesce(i.elcac_brgy, false))::int as route_conflict,
    (coalesce(i.four_ps, 0) >= 50)::int as route_four_ps,
    -- Evaluable: the largest of this barangay's seven benchmarks exists and is above 1. greatest()
    -- ignores nulls, so it is null only when the source supplied none of the seven — and the
    -- comparison is then null too, which coalesce resolves to false. That also covers the
    -- barangays this LEFT JOIN found nothing for: not listed is not evaluable.
    coalesce(greatest(i.imr_prov_ref, i.ufmr_prov_ref, i.fic_prov_ref, i.abr_prov_ref,
                      i.pre_natal_prov_ref, i.sba_prov_ref, i.water_prov_ref) > 1,
             false)::int as evaluable,
    coalesce(greatest(i.imr_prov_ref, i.ufmr_prov_ref, i.fic_prov_ref, i.abr_prov_ref,
                      i.pre_natal_prov_ref, i.sba_prov_ref, i.water_prov_ref) > 1
               and i.health_indicators >= 4,
             false)::int as route_health
  from dim_geo g
  left join fact_uuc_phc_indicators i
    on i.geo_code = g.geo_code
   and i.dataset_id = (select dataset_id from ds)
  where g.geo_level = 'barangay'
),
rolled as (
  select 'PH' as geo_code, 'national'::geo_level_enum as geo_level,
         sum(listed)::int as n_listed,
         sum(route_ip)::int as n_route_ip,
         sum(route_conflict)::int as n_route_conflict,
         sum(route_four_ps)::int as n_route_four_ps,
         sum(route_health)::int as n_route_health,
         sum(evaluable)::int as n_health_evaluable
    from brgy
  union all
  select region_code, 'region'::geo_level_enum, sum(listed)::int, sum(route_ip)::int,
         sum(route_conflict)::int, sum(route_four_ps)::int, sum(route_health)::int,
         sum(evaluable)::int
    from brgy group by region_code
  union all
  select province_code, 'province'::geo_level_enum, sum(listed)::int, sum(route_ip)::int,
         sum(route_conflict)::int, sum(route_four_ps)::int, sum(route_health)::int,
         sum(evaluable)::int
    from brgy group by province_code
  union all
  select citymun_code, 'citymun'::geo_level_enum, sum(listed)::int, sum(route_ip)::int,
         sum(route_conflict)::int, sum(route_four_ps)::int, sum(route_health)::int,
         sum(evaluable)::int
    from brgy group by citymun_code
)
insert into agg_uuc_phc_criteria (
  dataset_id, geo_code, geo_level, n_listed,
  n_route_ip, n_route_conflict, n_route_four_ps, n_route_health, n_health_evaluable
)
select (select dataset_id from ds), r.geo_code, r.geo_level, r.n_listed,
       r.n_route_ip, r.n_route_conflict, r.n_route_four_ps, r.n_route_health, r.n_health_evaluable
from rolled r
on conflict (dataset_id, geo_code, geo_level) do update set
  n_listed = excluded.n_listed,
  n_route_ip = excluded.n_route_ip,
  n_route_conflict = excluded.n_route_conflict,
  n_route_four_ps = excluded.n_route_four_ps,
  n_route_health = excluded.n_route_health,
  n_health_evaluable = excluded.n_health_evaluable;

-- ---------------------------------------------------------------------------------------------
-- Assert, after loading, the invariants the page depends on. Each of these is cheap and each has
-- a way of being violated silently by a future edit, which is the test for whether an assertion
-- earns its place. A failure aborts the migration rather than publishing a wrong share.
do $$
declare
  n_bad integer;
begin
  -- 1. This table's denominator must be the one agg_uuc_phc_counts publishes. They are computed
  --    from different fact tables (classification vs. indicators), so agreement is a real check
  --    that every listed barangay has an indicator row and vice versa.
  select count(*) into n_bad
  from agg_uuc_phc_criteria c
  join agg_uuc_phc_counts n
    on n.dataset_id = c.dataset_id and n.geo_code = c.geo_code and n.geo_level = c.geo_level
  where n.n_listed <> c.n_listed;
  if n_bad > 0 then
    raise exception 'agg_uuc_phc_criteria.n_listed disagrees with agg_uuc_phc_counts on % row(s)', n_bad;
  end if;

  select count(*) into n_bad
  from agg_uuc_phc_criteria c
  left join agg_uuc_phc_counts n
    on n.dataset_id = c.dataset_id and n.geo_code = c.geo_code and n.geo_level = c.geo_level
  where n.geo_code is null;
  if n_bad > 0 then
    raise exception '% criteria row(s) have no matching agg_uuc_phc_counts row', n_bad;
  end if;

  -- 2. No route count may exceed the denominator it is a share of, and none may be negative.
  --    This is what makes the rendered percentages safe to draw on a 0–100% track.
  select count(*) into n_bad
  from agg_uuc_phc_criteria
  where n_route_ip > n_listed
     or n_route_conflict > n_listed
     or n_route_four_ps > n_listed
     or n_health_evaluable > n_listed
     or n_route_health > n_health_evaluable
     or least(n_route_ip, n_route_conflict, n_route_four_ps, n_route_health,
              n_health_evaluable, n_listed) < 0;
  if n_bad > 0 then
    raise exception '% row(s) have a route count outside its denominator', n_bad;
  end if;

  -- 3. Each level must roll up to the same national totals. A region/province/citymun that lost
  --    or double-counted a barangay shows up here and nowhere else.
  select count(*) into n_bad
  from (
    select geo_level, sum(n_listed) as l, sum(n_route_ip) as a, sum(n_route_conflict) as b,
           sum(n_route_four_ps) as c, sum(n_route_health) as d, sum(n_health_evaluable) as e
    from agg_uuc_phc_criteria
    group by geo_level
  ) t
  cross join (
    select n_listed as l, n_route_ip as a, n_route_conflict as b, n_route_four_ps as c,
           n_route_health as d, n_health_evaluable as e
    from agg_uuc_phc_criteria where geo_level = 'national'
  ) nat
  where t.l <> nat.l or t.a <> nat.a or t.b <> nat.b
     or t.c <> nat.c or t.d <> nat.d or t.e <> nat.e;
  if n_bad > 0 then
    raise exception '% level(s) do not roll up to the national totals', n_bad;
  end if;
end $$;
