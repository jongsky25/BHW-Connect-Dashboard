-- BHW coverage split by UUC for PHC membership (docs/UUC_PHC_2025_PLAN.md §9 U12b).
--
-- The reason both datasets sit in one dashboard: `fact_uuc_phc_barangay` is barangay-grain and
-- `agg_bhw_stepzero_counts` is built at barangay grain for every one of the 41,958 barangays, so
-- the join key exists and the question "how does BHW coverage compare between the barangays on the
-- 2025 list and every other barangay in the same area" is answerable.
--
-- **This is a consistency check, not a discovery, and the whole design turns on that.** DOH AO No.
-- 2020-0023's physical factor is distance to a health facility, so UUC membership is defined
-- *partly on health-system access*. A gap in BHW coverage between listed and unlisted barangays is
-- therefore partly definitional. Publishing "unserved barangays have fewer BHWs per household" as
-- a finding would be circular — and so, symmetrically, would publishing the opposite. The owner's
-- framing (2026-08-27, recorded in docs/DECISIONS.md) is that the surface asks *is BHW coverage
-- consistent with what the list already implies?*, with the definitional overlap leading the
-- caption and the reportable finding being the **exception** rather than the average gap.
--
-- Three decisions this table makes, all of which change what the figure means:
--
--   1. **"Not listed" is every other barangay in the area, not "assessed and found adequate".**
--      U1 loaded only the listed barangays; the workbook's 9,395 assessed-but-not-listed
--      rows were scoped out and are not in this database at all. So the comparison group is the
--      area's remaining barangays, full stop. Every column below is named `*_other`, never
--      `*_not_listed`, because a reader who sees "not listed" hears "assessed and passed".
--
--   2. **The measure is StepZero's headcount, not the per-person census.** `agg_bhw_counts` is
--      built from `fact_bhw_raw`, i.e. from BHWs who have been *individually profiled*, and it has
--      a barangay row only where at least one has been. Listed barangays are remote and
--      underserved by construction, so they are plausibly also less profiled — splitting a
--      profiled-BHW figure by UUC status would confound BHW supply with profiling progress, which
--      is a second circularity on top of the definitional one. `agg_bhw_stepzero_counts` is a
--      quick-count of every barangay's whole BHW universe, present for all 41,958, and is what the
--      site already uses for `householdsPerBhw` (lib/db/stepzero.ts: "BHWs in the Philippines are
--      assigned to households, so this ratio (not a per-capita rate) is the operative workload
--      measure"). The profiled counts are carried anyway — as `*_n_profiled` — so the page can
--      *state* the coverage difference rather than have it act unseen.
--
--   3. **Ratios are not stored.** Households per BHW, BHWs per barangay, households per barangay
--      and profiling coverage are all derived in the read layer, on the same rule as the UUC
--      section's share: one definition, one place. Everything here is a count.
--
-- The residual is stored, not hidden. `agg_bhw_stepzero_counts`' own area rows do **not** equal
-- the sum of its barangay rows: nationally 306,835 against 306,819, a gap of 16 BHWs and 6,061
-- households, confined to three regions. (The likely cause is StepZero source rows for barangays
-- absent from `dim_geo` — the ~2,689 newer/renumbered PSGC codes lib/db/stepzero.ts already names
-- — which reach the rolled-up levels but have no barangay row to attach to a UUC status.) Any
-- barangay-grain split therefore cannot reproduce the area total, and the honest response is to
-- publish the difference rather than to assert an equality that is false: `unallocated_n_bhw` and
-- `unallocated_households` carry it, listed + other + unallocated equals the area row exactly, and
-- assertion 4 below fails the migration if it ever does not.

-- ---------------------------------------------------------------------------------------------
-- 1. The table.
--
-- Wide (paired `listed_*` / `other_*` columns) rather than two rows per geo. The read granularity
-- is one *comparison* per area — no consumer ever wants one side alone — and the reconciliation
-- that matters most (listed + other + unallocated = the area's own published total) is then a
-- within-row check that both assertion 4 and a reader with the page open can perform. The long
-- form would make the section's central invariant a self-join.
--
-- Four levels, not five: national / region / province / citymun, the same set as every other
-- `agg_uuc_phc_*` aggregate. A barangay is entirely listed or entirely not, so a barangay row
-- would be one populated side and one empty one — a comparison with nothing to compare.
create table if not exists agg_bhw_by_uuc_status (
  id bigint generated always as identity primary key,
  dataset_id bigint not null references dim_dataset (dataset_id),
  geo_code text not null references dim_geo (geo_code),
  geo_level geo_level_enum not null,

  -- The partition itself, from dim_geo. Pure geography: never suppressed, and asserted below to
  -- sum to the area's barangay count and to agree with agg_uuc_phc_counts barangay for barangay.
  n_barangays_listed integer not null default 0,
  n_barangays_other integer not null default 0,

  -- Barangays on each side that actually carry a StepZero row with a BHW count — the denominator
  -- the figures are built from, and the count the suppression rule below tests. Today this equals
  -- the barangay count on both sides (StepZero covers all 41,958); storing it separately is what
  -- makes a future shortfall visible instead of silently narrowing the base.
  n_listed_with_data integer not null default 0,
  n_other_with_data integer not null default 0,

  -- Barangays reporting no BHW at all. A real zero and a finding in its own right, so it is a
  -- count of barangays rather than something the BHW totals absorb.
  n_listed_no_bhw integer not null default 0,
  n_other_no_bhw integer not null default 0,

  -- StepZero's whole BHW universe (registered + registered & accredited + non-registered) and the
  -- households those BHWs are assigned to, summed over each side's barangays. NULL when that side
  -- is suppressed.
  listed_n_bhw integer,
  other_n_bhw integer,
  listed_households bigint,
  other_households bigint,

  -- StepZero's profiling-eligible base (registered + registered & accredited), so the read layer
  -- computes profiling coverage the same way getBhwOverview does rather than inventing a second
  -- definition of the denominator. NULL when that side is suppressed.
  listed_registered_universe integer,
  other_registered_universe integer,

  -- Individually-profiled BHWs (agg_bhw_counts.n_total) on each side. **Context, not an
  -- indicator**: this is what makes the profiling-coverage difference between the two groups
  -- visible, which is the caveat that justifies decision 2 in the header. Nothing on the page
  -- divides it by anything except `*_registered_universe`. NULL when that side is suppressed.
  listed_n_profiled integer,
  other_n_profiled integer,

  -- The area's own StepZero row minus both sides: BHWs and households that are in the published
  -- area total but have no barangay row to attach to a UUC status. See the header. Never
  -- suppressed — it is an area-level data-quality figure about neither group.
  unallocated_n_bhw integer not null default 0,
  unallocated_households bigint not null default 0,

  -- True when that side has 0 < n_*_with_data < 5 and its measures were therefore nulled. See the
  -- suppression note at step 4.
  listed_is_suppressed boolean not null default false,
  other_is_suppressed boolean not null default false,

  -- A side is either wholly published or wholly suppressed; a half-nulled side would let a reader
  -- treat a missing column as a zero.
  constraint agg_bhw_by_uuc_status_listed_suppression_check check (
    listed_is_suppressed = (listed_n_bhw is null)
    and listed_is_suppressed = (listed_households is null)
    and listed_is_suppressed = (listed_registered_universe is null)
    and listed_is_suppressed = (listed_n_profiled is null)
  ),
  constraint agg_bhw_by_uuc_status_other_suppression_check check (
    other_is_suppressed = (other_n_bhw is null)
    and other_is_suppressed = (other_households is null)
    and other_is_suppressed = (other_registered_universe is null)
    and other_is_suppressed = (other_n_profiled is null)
  ),

  unique (dataset_id, geo_code, geo_level)
);

-- The read path is "this one area's comparison", plus "this area's children" for the breakdown.
create index if not exists agg_bhw_by_uuc_status_geo_idx
  on agg_bhw_by_uuc_status (dataset_id, geo_code, geo_level);

comment on table agg_bhw_by_uuc_status is
  'BHW coverage in an area split by whether each barangay is on the 2025 UUC for PHC list. A CONSISTENCY CHECK, NOT A FINDING: UUC membership is defined partly on distance to a health facility (DOH AO No. 2020-0023), so a coverage gap between the two groups is partly definitional and must never be reported as a discovery in either direction. "Other" means every other barangay in the area, NOT "assessed and found adequate" — the assessed-but-unlisted barangays were never loaded. Built from agg_bhw_stepzero_counts (a headcount covering all 41,958 barangays), not from agg_bhw_counts, because profiled-BHW figures would confound BHW supply with profiling progress. Ratios are derived by the reader, never stored. See docs/UUC_PHC_2025_PLAN.md §9 U12b.';

comment on column agg_bhw_by_uuc_status.n_barangays_listed is
  'Barangays in this area on the 2025 UUC for PHC list. Equals agg_uuc_phc_counts.n_listed for the same geo, computed by a different path and asserted equal at load.';
comment on column agg_bhw_by_uuc_status.n_barangays_other is
  'EVERY OTHER barangay in the area — not "assessed and found adequate". The source workbook''s 9,395 assessed-but-unlisted barangays are not loaded (plan U1), so no such group exists in this database. Plus n_barangays_listed, this is the area''s whole barangay count.';
comment on column agg_bhw_by_uuc_status.n_listed_with_data is
  'Listed barangays carrying a StepZero row with a BHW count — the denominator the listed-side figures are built from, and the count the suppression rule tests.';
comment on column agg_bhw_by_uuc_status.n_other_with_data is
  'Other barangays carrying a StepZero row with a BHW count — the denominator the other-side figures are built from, and the count the suppression rule tests.';
comment on column agg_bhw_by_uuc_status.n_listed_no_bhw is
  'Listed barangays reporting zero BHWs. A real zero, never suppressed.';
comment on column agg_bhw_by_uuc_status.n_other_no_bhw is
  'Other barangays reporting zero BHWs. A real zero, never suppressed.';
comment on column agg_bhw_by_uuc_status.listed_n_bhw is
  'StepZero total BHWs (registered + registered & accredited + non-registered) summed over this area''s listed barangays. NULL when the listed side is suppressed. Divide by listed_households for households per BHW — the site''s operative workload measure; never compare it across areas without its denominator.';
comment on column agg_bhw_by_uuc_status.other_n_bhw is
  'StepZero total BHWs summed over this area''s other barangays. NULL when the other side is suppressed.';
comment on column agg_bhw_by_uuc_status.listed_households is
  'Households in this area''s listed barangays, from StepZero. The denominator of households per BHW. NULL when the listed side is suppressed. LISTED BARANGAYS ARE SMALLER ON AVERAGE, so most of any households-per-BHW difference between the two sides is barangay size rather than BHW deployment — divide by n_barangays_listed to see it.';
comment on column agg_bhw_by_uuc_status.other_households is
  'Households in this area''s other barangays, from StepZero. NULL when the other side is suppressed. See listed_households on why barangay size, not deployment, drives most of the difference.';
comment on column agg_bhw_by_uuc_status.listed_registered_universe is
  'StepZero registered + registered & accredited BHWs on the listed side — the profiling-eligible base, and the ONLY denominator listed_n_profiled may be divided by. NULL when suppressed.';
comment on column agg_bhw_by_uuc_status.other_registered_universe is
  'StepZero registered + registered & accredited BHWs on the other side — the profiling-eligible base, and the ONLY denominator other_n_profiled may be divided by. NULL when suppressed.';
comment on column agg_bhw_by_uuc_status.listed_n_profiled is
  'Individually-profiled BHWs (agg_bhw_counts.n_total) on the listed side. CONTEXT, NOT AN INDICATOR: it exists so the page can state how far profiling coverage differs between the two groups, which is why the per-person census is not what this table splits. Never report it as BHW supply. NULL when suppressed.';
comment on column agg_bhw_by_uuc_status.other_n_profiled is
  'Individually-profiled BHWs on the other side. CONTEXT, NOT AN INDICATOR — see listed_n_profiled. NULL when suppressed.';
comment on column agg_bhw_by_uuc_status.unallocated_n_bhw is
  'BHWs in this area''s own StepZero row that are in neither side, because they sit in barangay rows StepZero carries above barangay grain only. 16 nationally, in 3 regions. listed + other + unallocated equals the area total exactly, asserted at load.';
comment on column agg_bhw_by_uuc_status.unallocated_households is
  'Households in this area''s own StepZero row that are in neither side. 6,061 nationally, in 3 regions. See unallocated_n_bhw.';
comment on column agg_bhw_by_uuc_status.listed_is_suppressed is
  'True when 0 < n_listed_with_data < 5 and the listed-side measures were nulled. A PRESENTATION RULE, NOT A DISCLOSURE CONTROL: agg_bhw_stepzero_counts is public at barangay grain, so nothing here is secret. What it prevents is one, two or three barangays being rendered as a group statistic and compared against hundreds.';
comment on column agg_bhw_by_uuc_status.other_is_suppressed is
  'True when 0 < n_other_with_data < 5 and the other-side measures were nulled. See listed_is_suppressed.';

alter table agg_bhw_by_uuc_status enable row level security;

-- Public, aggregate-only (no personal data): anyone may read; no client writes. Same policy shape
-- as agg_uuc_phc_counts, agg_uuc_phc_criteria and agg_uuc_phc_indicator_dist.
drop policy if exists "agg_bhw_by_uuc_status public read" on agg_bhw_by_uuc_status;
create policy "agg_bhw_by_uuc_status public read" on agg_bhw_by_uuc_status
  for select
  to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------------------------------
-- 2. Populate, unsuppressed. Idempotent: recomputes and upserts every row, so re-running after a
-- fact reload is the refresh procedure — the same discipline as the other three UUC aggregates.
--
-- Suppression is applied as a separate pass at step 4, deliberately: the assertions at step 3 then
-- run against complete values, which is a stronger check than anything they could make of a table
-- whose small cells have already been nulled.
--
-- The two sources this table is built from. Stated outright because the generator reads
-- `create table` and `create view` bodies for provenance, and this table is populated by a
-- separate `insert ... select` — a real derivation no DDL statement expresses.
-- lineage: table:agg_bhw_by_uuc_status derived-from table:agg_bhw_stepzero_counts
-- lineage: table:agg_bhw_by_uuc_status derived-from table:fact_uuc_phc_barangay
with uuc as (select dataset_id from dim_dataset where slug = 'uuc-phc-2025'),
stepzero as (select dataset_id from dim_dataset where slug = 'bhw-stepzero-2026'),
profiled as (select dataset_id from dim_dataset where slug = 'bhw-2025'),

-- One row per barangay: its ancestors, its UUC status, its StepZero figures and its profiled
-- count. `listed` is presence in the fact table — membership is presence, there is no decision
-- column (plan U1).
barangay as (
  select
    g.geo_code,
    g.region_code,
    g.province_code,
    g.citymun_code,
    exists (
      select 1 from fact_uuc_phc_barangay f
      where f.geo_code = g.geo_code and f.dataset_id = (select dataset_id from uuc)
    ) as listed,
    s.n_total_bhw,
    s.households,
    -- Mirrors getStepzeroCounts' registeredUniverse: null only when both parts are null, so a
    -- barangay reporting one and not the other is not silently dropped from the base.
    case
      when s.n_registered is null and s.n_registered_accredited is null then null
      else coalesce(s.n_registered, 0) + coalesce(s.n_registered_accredited, 0)
    end as registered_universe,
    coalesce(c.n_total, 0) as n_profiled
  from dim_geo g
  left join agg_bhw_stepzero_counts s
    on s.geo_code = g.geo_code and s.geo_level = 'barangay'
   and s.dataset_id = (select dataset_id from stepzero)
  left join agg_bhw_counts c
    on c.geo_code = g.geo_code and c.geo_level = 'barangay'
   and c.dataset_id = (select dataset_id from profiled)
  where g.geo_level = 'barangay'
),

-- Fan each barangay out to the four levels it rolls up into, exactly as build_aggregates.sql §1
-- does for the BHW census. One pass, four levels.
fanned as (
  -- Columns listed rather than `b.*`: the barangay's own geo_code would collide with the level's
  -- and make every later reference to it ambiguous.
  select
    lvl.geo_level,
    lvl.geo_code,
    b.listed,
    b.n_total_bhw,
    b.households,
    b.registered_universe,
    b.n_profiled
  from barangay b
  cross join lateral (values
    ('citymun'::geo_level_enum, b.citymun_code),
    ('province'::geo_level_enum, b.province_code),
    ('region'::geo_level_enum, b.region_code),
    ('national'::geo_level_enum, 'PH')
  ) as lvl(geo_level, geo_code)
),

split as (
  select
    f.geo_code,
    f.geo_level,
    count(*) filter (where f.listed) as n_barangays_listed,
    count(*) filter (where not f.listed) as n_barangays_other,
    count(*) filter (where f.listed and f.n_total_bhw is not null) as n_listed_with_data,
    count(*) filter (where not f.listed and f.n_total_bhw is not null) as n_other_with_data,
    count(*) filter (where f.listed and f.n_total_bhw = 0) as n_listed_no_bhw,
    count(*) filter (where not f.listed and f.n_total_bhw = 0) as n_other_no_bhw,
    coalesce(sum(f.n_total_bhw) filter (where f.listed), 0) as listed_n_bhw,
    coalesce(sum(f.n_total_bhw) filter (where not f.listed), 0) as other_n_bhw,
    coalesce(sum(f.households) filter (where f.listed), 0) as listed_households,
    coalesce(sum(f.households) filter (where not f.listed), 0) as other_households,
    coalesce(sum(f.registered_universe) filter (where f.listed), 0) as listed_registered_universe,
    coalesce(sum(f.registered_universe) filter (where not f.listed), 0) as other_registered_universe,
    coalesce(sum(f.n_profiled) filter (where f.listed), 0) as listed_n_profiled,
    coalesce(sum(f.n_profiled) filter (where not f.listed), 0) as other_n_profiled
  from fanned f
  group by f.geo_code, f.geo_level
)
insert into agg_bhw_by_uuc_status (
  dataset_id, geo_code, geo_level,
  n_barangays_listed, n_barangays_other,
  n_listed_with_data, n_other_with_data,
  n_listed_no_bhw, n_other_no_bhw,
  listed_n_bhw, other_n_bhw,
  listed_households, other_households,
  listed_registered_universe, other_registered_universe,
  listed_n_profiled, other_n_profiled,
  unallocated_n_bhw, unallocated_households
)
select
  (select dataset_id from uuc),
  s.geo_code, s.geo_level,
  s.n_barangays_listed, s.n_barangays_other,
  s.n_listed_with_data, s.n_other_with_data,
  s.n_listed_no_bhw, s.n_other_no_bhw,
  s.listed_n_bhw, s.other_n_bhw,
  s.listed_households, s.other_households,
  s.listed_registered_universe, s.other_registered_universe,
  s.listed_n_profiled, s.other_n_profiled,
  -- The area's own StepZero row minus both sides. Zero everywhere except the three regions (and
  -- their ancestors) whose barangay rows do not account for the whole area total.
  coalesce(area.n_total_bhw, s.listed_n_bhw + s.other_n_bhw) - (s.listed_n_bhw + s.other_n_bhw),
  coalesce(area.households, s.listed_households + s.other_households)
    - (s.listed_households + s.other_households)
from split s
left join agg_bhw_stepzero_counts area
  on area.geo_code = s.geo_code and area.geo_level = s.geo_level
 and area.dataset_id = (select dataset_id from stepzero)
on conflict (dataset_id, geo_code, geo_level) do update set
  n_barangays_listed = excluded.n_barangays_listed,
  n_barangays_other = excluded.n_barangays_other,
  n_listed_with_data = excluded.n_listed_with_data,
  n_other_with_data = excluded.n_other_with_data,
  n_listed_no_bhw = excluded.n_listed_no_bhw,
  n_other_no_bhw = excluded.n_other_no_bhw,
  listed_n_bhw = excluded.listed_n_bhw,
  other_n_bhw = excluded.other_n_bhw,
  listed_households = excluded.listed_households,
  other_households = excluded.other_households,
  listed_registered_universe = excluded.listed_registered_universe,
  other_registered_universe = excluded.other_registered_universe,
  listed_n_profiled = excluded.listed_n_profiled,
  other_n_profiled = excluded.other_n_profiled,
  unallocated_n_bhw = excluded.unallocated_n_bhw,
  unallocated_households = excluded.unallocated_households,
  -- Re-running must clear a suppression the new data no longer warrants, or a corrected load
  -- would leave a permanently blank cell that reads as a rule rather than as stale state.
  listed_is_suppressed = false,
  other_is_suppressed = false;

-- Drop any geo that has stopped existing between runs, so a shrinking dim_geo empties rows rather
-- than leaving a stale comparison behind (ref_uuc_phc_published_delta's rule).
delete from agg_bhw_by_uuc_status a
where a.dataset_id = (select dataset_id from dim_dataset where slug = 'uuc-phc-2025')
  and not exists (
    select 1 from dim_geo g
    where g.geo_code = a.geo_code and g.geo_level = a.geo_level
  );

-- ---------------------------------------------------------------------------------------------
-- 3. Assertions on the complete values, before suppression nulls anything.
--
-- Every one aborts the migration rather than publish a wrong comparison. Numbered as the docs
-- refer to them.
do $$
declare
  n_bad integer;
  n_rows integer;
begin
  -- 1. Row count and coverage: one row per geo that agg_uuc_phc_counts covers, and no others.
  --    The two aggregates are built from different fact tables, so this also checks they see the
  --    same geography. The expected count is read from that aggregate rather than typed — the
  --    section's rule is that a figure is computed or it is not stated, and 1,788 in a `<>` is a
  --    figure.
  select
    (select count(*) from agg_bhw_by_uuc_status),
    (select count(*) from agg_uuc_phc_counts
      where dataset_id = (select dataset_id from dim_dataset where slug = 'uuc-phc-2025'))
  into n_rows, n_bad;
  if n_rows <> n_bad then
    raise exception 'agg_bhw_by_uuc_status has % rows, agg_uuc_phc_counts has %', n_rows, n_bad;
  end if;

  select count(*) into n_bad
  from agg_uuc_phc_counts c
  where c.dataset_id = (select dataset_id from dim_dataset where slug = 'uuc-phc-2025')
    and not exists (
      select 1 from agg_bhw_by_uuc_status a
      where a.geo_code = c.geo_code and a.geo_level = c.geo_level
    );
  if n_bad > 0 then
    raise exception '% geo(s) in agg_uuc_phc_counts have no agg_bhw_by_uuc_status row', n_bad;
  end if;

  -- 2. The partition agrees with the section's own aggregate, barangay for barangay. Reached by a
  --    different path (dim_geo fan-out vs agg_uuc_phc_counts' own build), so a disagreement means
  --    one of the two is wrong about which barangays are listed.
  select count(*) into n_bad
  from agg_bhw_by_uuc_status a
  join agg_uuc_phc_counts c
    on c.geo_code = a.geo_code and c.geo_level = a.geo_level
   and c.dataset_id = a.dataset_id
  where a.n_barangays_listed <> c.n_listed;
  if n_bad > 0 then
    raise exception '% row(s) disagree with agg_uuc_phc_counts.n_listed', n_bad;
  end if;

  -- 3. The two sides partition the area: listed + other is every barangay in it. This is the
  --    plan's own Verify line, and the thing that makes "other" mean what the dictionary says.
  select count(*) into n_bad
  from agg_bhw_by_uuc_status a
  join agg_uuc_phc_counts c
    on c.geo_code = a.geo_code and c.geo_level = a.geo_level
   and c.dataset_id = a.dataset_id
  where a.n_barangays_listed + a.n_barangays_other <> c.n_barangays;
  if n_bad > 0 then
    raise exception '% row(s) where listed + other <> the area''s barangay count', n_bad;
  end if;

  -- 4. Recombination is exact, including the residual. The plan asks that the split reproduce the
  --    unsplit figure; StepZero's area rows exceed the sum of its barangay rows in three regions,
  --    so the equality holds only with `unallocated_*` in it — which is precisely why that column
  --    is stored rather than the discrepancy swallowed.
  select count(*) into n_bad
  from agg_bhw_by_uuc_status a
  join agg_bhw_stepzero_counts s
    on s.geo_code = a.geo_code and s.geo_level = a.geo_level
   and s.dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-stepzero-2026')
  where a.listed_n_bhw + a.other_n_bhw + a.unallocated_n_bhw is distinct from s.n_total_bhw
     or a.listed_households + a.other_households + a.unallocated_households
        is distinct from s.households;
  if n_bad > 0 then
    raise exception '% row(s) do not recombine to agg_bhw_stepzero_counts', n_bad;
  end if;

  -- 4b. The residual is a shortfall in the barangay rows, never a surplus. A negative would mean
  --     the barangay rows carry BHWs the area row does not, which is a different defect entirely
  --     and must not be published as "unallocated".
  select count(*) into n_bad
  from agg_bhw_by_uuc_status
  where unallocated_n_bhw < 0 or unallocated_households < 0;
  if n_bad > 0 then
    raise exception '% row(s) carry a negative unallocated residual', n_bad;
  end if;

  -- 5. The profiled counts recombine exactly. agg_bhw_counts is fanned out from each BHW's own
  --    barangay, so unlike StepZero its levels roll up with no residual — and if that ever stops
  --    being true, the profiling-coverage caveat on the page is reading a broken denominator.
  select count(*) into n_bad
  from agg_bhw_by_uuc_status a
  join agg_bhw_counts c
    on c.geo_code = a.geo_code and c.geo_level = a.geo_level
   and c.dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025')
  where a.listed_n_profiled + a.other_n_profiled is distinct from c.n_total;
  if n_bad > 0 then
    raise exception '% row(s) do not recombine to agg_bhw_counts.n_total', n_bad;
  end if;

  -- 6. No count exceeds the denominator it belongs to.
  select count(*) into n_bad
  from agg_bhw_by_uuc_status
  where n_listed_with_data > n_barangays_listed
     or n_other_with_data > n_barangays_other
     or n_listed_no_bhw > n_listed_with_data
     or n_other_no_bhw > n_other_with_data
     or listed_registered_universe > listed_n_bhw
     or other_registered_universe > other_n_bhw;
  if n_bad > 0 then
    raise exception '% row(s) carry a count outside its denominator', n_bad;
  end if;

  -- 7. Every level rolls up to the national totals, on all eight measures. Computed once per
  --    level from the same barangay rows, so a level that disagrees means the fan-out is wrong.
  select count(*) into n_bad
  from (
    select geo_level,
      sum(n_barangays_listed) l, sum(n_barangays_other) o,
      sum(listed_n_bhw) lb, sum(other_n_bhw) ob,
      sum(listed_households) lh, sum(other_households) oh,
      sum(listed_n_profiled) lp, sum(other_n_profiled) op
    from agg_bhw_by_uuc_status
    where geo_level <> 'national'
    group by geo_level
  ) lvl
  cross join (
    select n_barangays_listed l, n_barangays_other o,
      listed_n_bhw lb, other_n_bhw ob,
      listed_households lh, other_households oh,
      listed_n_profiled lp, other_n_profiled op
    from agg_bhw_by_uuc_status where geo_level = 'national'
  ) nat
  where lvl.l <> nat.l or lvl.o <> nat.o
     or lvl.lb <> nat.lb or lvl.ob <> nat.ob
     or lvl.lh <> nat.lh or lvl.oh <> nat.oh
     or lvl.lp <> nat.lp or lvl.op <> nat.op;
  if n_bad > 0 then
    raise exception '% level(s) do not roll up to the national totals', n_bad;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Suppression.
--
-- Plan §9 U12b: "suppress any cell whose contributing barangay count is below the §4.1 threshold"
-- — n < 5, and n = 0 stays visible because a true zero reveals nothing about anybody.
--
-- **This is a presentation rule, not a disclosure control, and saying so matters.** BUILD_PLAN.md
-- §4.1's suppression exists because a small demographic cell can identify a person; but it also
-- says in as many words that "counts of totals — e.g. 'this barangay has 3 BHWs' — are not
-- suppressed", and `agg_bhw_stepzero_counts` is public at barangay grain for all 41,958. Anyone
-- can compute this split themselves. What the rule prevents is *this page* rendering one, two or
-- three barangays as a group statistic and setting it beside a group of hundreds — which is a
-- claim about a group, made from something that is not one.
--
-- Only the small side is nulled. The other side of such an area is, to within a few barangays, the
-- area's own published total, so suppressing it too would destroy a real 198-barangay figure to
-- protect a number already on the page above it. What the page must not do — and does not — is
-- draw the comparison when either side is suppressed.
update agg_bhw_by_uuc_status set
  listed_is_suppressed = true,
  listed_n_bhw = null,
  listed_households = null,
  listed_registered_universe = null,
  listed_n_profiled = null
where n_listed_with_data > 0 and n_listed_with_data < 5;

update agg_bhw_by_uuc_status set
  other_is_suppressed = true,
  other_n_bhw = null,
  other_households = null,
  other_registered_universe = null,
  other_n_profiled = null
where n_other_with_data > 0 and n_other_with_data < 5;

-- ---------------------------------------------------------------------------------------------
-- 5. Assertions on the suppression itself.
do $$
declare
  n_bad integer;
begin
  -- 8. Suppression fired exactly where the rule says and nowhere else, in both directions. The
  --    check constraints already guarantee a suppressed side is wholly null; this is the other
  --    half — that a side is suppressed if and only if 0 < contributing barangays < 5.
  select count(*) into n_bad
  from agg_bhw_by_uuc_status
  where listed_is_suppressed <> (n_listed_with_data > 0 and n_listed_with_data < 5)
     or other_is_suppressed <> (n_other_with_data > 0 and n_other_with_data < 5);
  if n_bad > 0 then
    raise exception '% row(s) where suppression does not match the 0 < n < 5 rule', n_bad;
  end if;

  -- 9. An area with nothing listed is not a suppressed area. NCR reads 0 of 1,675, which is data;
  --    if that ever started rendering as suppressed the page would say "withheld" where the
  --    correct answer is "none".
  select count(*) into n_bad
  from agg_bhw_by_uuc_status
  where n_barangays_listed = 0 and listed_is_suppressed;
  if n_bad > 0 then
    raise exception '% area(s) with nothing listed are marked suppressed', n_bad;
  end if;
end $$;
