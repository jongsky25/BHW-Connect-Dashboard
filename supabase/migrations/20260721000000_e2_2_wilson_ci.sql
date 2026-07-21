-- E2.2: Wilson 95% score-interval columns on the proportion aggregates.
-- Closed-form, computed from the stored success/total counts. Idempotent
-- (create-or-replace / add-column-if-not-exists / recompute-in-place), so it is
-- safe to re-run — it was applied to the live project via the Supabase MCP and
-- is committed here for the canonical migration history.
create or replace function wilson_low(k numeric, n numeric) returns numeric
  language sql immutable as $$
  select case when n is null or n <= 0 then null
    else greatest(0, round(100 * (
      (k + 1.9208) / (n + 3.8416)
      - 1.96 * (n / (n + 3.8416)) * sqrt(k * (n - k) / power(n, 3) + 0.9604 / power(n, 2))
    ), 2)) end;
$$;
create or replace function wilson_high(k numeric, n numeric) returns numeric
  language sql immutable as $$
  select case when n is null or n <= 0 then null
    else least(100, round(100 * (
      (k + 1.9208) / (n + 3.8416)
      + 1.96 * (n / (n + 3.8416)) * sqrt(k * (n - k) / power(n, 3) + 0.9604 / power(n, 2))
    ), 2)) end;
$$;

alter table agg_bhw_counts add column if not exists ci_low numeric, add column if not exists ci_high numeric;
alter table agg_training  add column if not exists ci_low numeric, add column if not exists ci_high numeric;
alter table agg_honorarium add column if not exists ci_low numeric, add column if not exists ci_high numeric;

update agg_bhw_counts set
  ci_low  = wilson_low(n_accredited, n_total),
  ci_high = wilson_high(n_accredited, n_total);

update agg_training set
  ci_low  = wilson_low(n_trained, n_total),
  ci_high = wilson_high(n_trained, n_total);

update agg_honorarium h set
  ci_low  = wilson_low(h.n_receiving, c.n_total),
  ci_high = wilson_high(h.n_receiving, c.n_total)
from agg_bhw_counts c
where c.dataset_id = h.dataset_id and c.geo_code = h.geo_code and c.geo_level = h.geo_level;
