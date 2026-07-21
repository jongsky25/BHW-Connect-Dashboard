-- E3.6: empirical-Bayes adjusted accreditation rate (approved, owner Q7). A raw
-- percentage from a place with only a handful of profiled BHWs is noisy — one
-- person swings it several points. This column shrinks each small-area raw rate
-- toward its parent's pooled rate by an amount that depends on how few BHWs it has
-- and how much real spread there is between siblings, using a DerSimonian-Laird
-- random-effects (beta-binomial method-of-moments) estimate of the between-area
-- variance A per parent group:
--   v_i = m(1-m)/n_i            (within-area sampling variance)
--   B_i = A / (A + v_i)         (shrinkage weight, 0..1)
--   adjusted_i = m + B_i·(p_i − m)
-- where m is the parent's pooled rate. When siblings show no real spread (A→0) the
-- estimate collapses to the parent rate; a large, precise area (small v_i) keeps
-- almost its raw rate. Computed ONLY at citymun and barangay grain — the levels
-- where small n occurs; region/national keep adjusted_pct NULL and are shown raw.
-- Raw stays the default in the UI; adjusted is an opt-in, always labeled. See
-- /methodology. Idempotent; mirrored in build_aggregates.sql. Applied live via the
-- Supabase MCP.
alter table agg_bhw_counts add column if not exists adjusted_pct numeric;

update agg_bhw_counts set adjusted_pct = null
where dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');

with units as (
  select c.geo_code, c.geo_level, dg.parent_code,
    c.n_total::numeric as n_i, c.n_accredited::numeric as k_i,
    c.n_accredited::numeric / c.n_total as p_i
  from agg_bhw_counts c
  join dim_geo dg on dg.geo_code = c.geo_code and dg.geo_level = c.geo_level
  where c.dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025')
    and c.geo_level in ('citymun', 'barangay')
    and c.n_total > 0 and c.n_accredited is not null
),
grp as (
  select parent_code, geo_level,
    count(*) as g,
    sum(k_i) / nullif(sum(n_i), 0) as m,
    sum(n_i) as sum_n,
    sum(n_i * n_i) as sum_n2
  from units group by parent_code, geo_level
),
tau as (
  select parent_code, geo_level, m, g, sum_n, sum_n2
  from grp where g >= 2 and m > 0 and m < 1
),
dev as (
  select u.geo_code, u.geo_level, u.parent_code, u.p_i, u.n_i, t.m, t.g, t.sum_n, t.sum_n2,
    u.n_i * power(u.p_i - t.m, 2) as weighted_sq
  from units u
  join tau t on t.parent_code = u.parent_code and t.geo_level = u.geo_level
),
between_var as (
  select parent_code, geo_level, m, g, sum_n, sum_n2,
    greatest(0,
      (sum(weighted_sq) - (g - 1) * m * (1 - m))
      / nullif(sum_n - sum_n2 / nullif(sum_n, 0), 0)
    ) as a_var
  from dev
  group by parent_code, geo_level, m, g, sum_n, sum_n2
),
adjusted as (
  select u.geo_code, u.geo_level,
    case
      when (bv.a_var + bv.m * (1 - bv.m) / u.n_i) = 0 then bv.m
      else bv.m + (bv.a_var / (bv.a_var + bv.m * (1 - bv.m) / u.n_i)) * (u.p_i - bv.m)
    end as adj
  from units u
  join dim_geo dg on dg.geo_code = u.geo_code and dg.geo_level = u.geo_level
  join between_var bv on bv.parent_code = dg.parent_code and bv.geo_level = u.geo_level
)
update agg_bhw_counts c
set adjusted_pct = round((100.0 * a.adj)::numeric, 2)
from adjusted a
where c.geo_code = a.geo_code and c.geo_level = a.geo_level
  and c.dataset_id = (select dataset_id from dim_dataset where slug = 'bhw-2025');
