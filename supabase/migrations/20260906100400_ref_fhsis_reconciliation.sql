-- Σ children vs the published parent, per FHSIS indicator (plan F1, Decision 4).
--
-- FHSIS publishes its own subtotals at every level, and its leaf table does not always add up to
-- them. Rather than choose a side silently — recompute rollups from leaves, or trust the parent
-- and hide the leaves — the plan's 1.6 discipline is to publish the residual. This view is that
-- residual, computed on every read so it cannot go stale against the fact table, which is the
-- whole point: it is a claim about the source's internal consistency, and a stored copy of such
-- a claim is a copy that can silently stop being true.
--
-- **What a non-zero residual actually is**, found by checking rather than assumed: for FIC, 78 of
-- the 83 comparable provinces reconcile with their cities exactly, and each of the other five
-- differs by *precisely* the figure of one city — City of Cotabato, City of Dagupan, City of
-- Naga, City of Santiago, Ormoc City. Those are independent component and highly urbanised
-- cities: dim_geo nests them under their geographic province, and the source's province row
-- excludes them because they report separately. So a negative residual (children exceeding the
-- parent) is usually this, not a data error.
--
-- A province-tier node with no children of its own is not compared with anything. The 33 highly
-- urbanised cities that dim_geo places at province level — City of Makati and the rest — are
-- leaves wearing a parent's level, and the inner join on the child side is what keeps them out
-- of the comparison.
--
-- **This is why no page derives a parent's figure by summing its children.** Every grain is
-- loaded, so the published row for an area always exists; this view exists to explain, on the
-- methodology page, why the two numbers differ when a reader adds them up themselves.
--
-- security_invoker: without it a view runs as its owner and the RLS beneath it never applies to
-- the caller — an ERROR-level Supabase advisor finding (security_definer_view). The body is a
-- read of fact_fhsis_indicator, whose access is decided by that table's own public-read policy;
-- this view adds no privilege of its own. Same convention as ref_uuc_phc_provincial.
--
-- lineage: table:ref_fhsis_reconciliation derived-from doc:docs/FHSIS_2025_CLEANING_REPORT.md
create or replace view ref_fhsis_reconciliation
with (security_invoker = true) as
with child_of as (
  -- The parent each row rolls into, one level up. Derived from dim_geo's own hierarchy rather
  -- than from a prefix of geo_code, so it stays right if the code shapes ever change.
  select
    f.dataset_id,
    f.indicator_key,
    f.breakdown,
    f.numerator,
    case f.geo_level
      when 'citymun' then 'province'
      when 'province' then 'region'
      when 'region' then 'national'
    end::geo_level_enum as parent_level,
    g.parent_code
  from fact_fhsis_indicator f
  join dim_geo g on g.geo_code = f.geo_code
  where f.geo_level <> 'national'
    and f.numerator is not null
)
select
  c.dataset_id,
  c.indicator_key,
  c.breakdown,
  c.parent_level,
  c.parent_code as parent_geo_code,
  p.geo_name as parent_geo_name,
  count(*)::int as child_count,
  sum(c.numerator)::bigint as child_sum,
  parent.numerator::bigint as published_parent,
  -- Positive: the published parent is larger than its children add up to, i.e. the leaf table is
  -- short. Negative: the children exceed the parent, which is the independent-city case above.
  (parent.numerator - sum(c.numerator))::bigint as residual,
  case
    when parent.numerator - sum(c.numerator) = 0 then 'reconciles'
    when parent.numerator - sum(c.numerator) > 0 then 'leaves short of published parent'
    else 'leaves exceed published parent'
  end as finding
from child_of c
join dim_geo p on p.geo_code = c.parent_code
-- The published parent row for the same indicator and breakdown. An inner join, so a parent the
-- source did not publish is not compared against a sum that would then look like a total.
join fact_fhsis_indicator parent
  on parent.dataset_id = c.dataset_id
 and parent.geo_code = c.parent_code
 and parent.indicator_key = c.indicator_key
 and parent.breakdown = c.breakdown
 and parent.numerator is not null
group by
  c.dataset_id, c.indicator_key, c.breakdown, c.parent_level, c.parent_code,
  p.geo_name, parent.numerator;

comment on view ref_fhsis_reconciliation is
  'Per FHSIS indicator and breakdown: the sum of an area''s children against the subtotal the source published for that area, and the residual between them. Computed on every read. A NON-ZERO RESIDUAL IS USUALLY NOT AN ERROR — for FIC, 78 of 83 comparable provinces reconcile exactly and the other five differ by precisely the figure of an independent component or highly urbanised city that dim_geo nests under the province while the source''s province row excludes it. NEVER DERIVE A PARENT''S FIGURE BY SUMMING ITS CHILDREN: every grain is loaded, so read the published row for the area. This view exists to explain the difference to a reader who adds them up, not to correct either side. See docs/FHSIS_2025_CLEANING_REPORT.md.';
