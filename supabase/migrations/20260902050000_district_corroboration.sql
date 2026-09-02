-- Legislative districts, Increment D1.3: what the builder needs that §3's schema did not have.
--
-- Two additions, both consequences of decisions taken AFTER D1.2 wrote the schema from the plan's
-- §3. Recorded here rather than folded into the earlier migration so the order of reasoning stays
-- visible in the history.

-- 1. THE TWO-SOURCE RULE NEEDS SOMEWHERE TO LIVE.
--
-- D1.1 added guardrail 2 -- no district assignment ships on one source alone -- after §3 was
-- written, so geo_district_map had no way to record whether a row is corroborated. Without a
-- column, "corroborated" would be a property of a build log rather than of the row, which is
-- exactly the kind of fact that goes stale silently.
--
-- Deliberately source-agnostic. It says how many independent sources attest a row, not which
-- ones -- COMELEC is today's second opinion, but the rule is about independence, not about
-- COMELEC, and a column named for a source would have to be renamed the first time that changes.
-- Which sources agreed is already recoverable from source_ref and corroborating_source_ref.
alter table geo_district_map
  add column corroboration text not null default 'single_source'
    check (corroboration in ('single_source', 'corroborated', 'conflict'));

-- The second source's revision pointer, in the same 'wikipedia:<page>@<revid>' shape as
-- source_ref, so a corroborated row is checkable from both ends years later.
alter table geo_district_map add column corroborating_source_ref text;

comment on column geo_district_map.corroboration is
  'single_source = one source attests this row and it must not ship (guardrail 2); '
  'corroborated = two independent sources agree; conflict = they disagree and the row is a finding, not a fact.';

-- 2. `whole_parent` IS A REAL MATCH METHOD, AND NOT A NAME MATCH.
--
-- A lone/at-large district covers its entire parent by definition, and Wikipedia reasonably does
-- not enumerate 25 municipalities to say so. The builder expands those itself. Filing the result
-- as 'exact' would claim we matched a name we never saw; filing it as 'manual_override' would
-- claim a human decided each one. It is neither: it is a containment fact, and a reader of
-- /districts/[code] deserves to see which of the two kinds of claim a row rests on, because they
-- fail in different ways. 828 of the current build's 3,043 rows are this kind.
alter table geo_district_map drop constraint geo_district_map_match_method_check;
alter table geo_district_map
  add constraint geo_district_map_match_method_check
  check (match_method in ('exact', 'disambiguated', 'crosswalk', 'manual_override',
                          'public_correction', 'whole_parent'));

comment on column geo_district_map.match_method is
  'How this row was resolved. There is deliberately no fuzzy value: guardrail 1 says an '
  'unresolved LGU is a published finding and a wrongly-matched one is an invisible lie, so the '
  'absence is enforced by this constraint rather than remembered by an implementer.';
