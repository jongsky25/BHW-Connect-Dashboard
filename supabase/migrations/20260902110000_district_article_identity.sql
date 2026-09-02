-- Legislative districts, Increment D1.3j: two ways a member's own article proves its identity.
--
-- THE PROBLEM. 23 members stayed unresolved because Wikipedia and PSA spell the same place
-- differently, and guardrail 1 forbids closing that by similarity. Rightly so -- three of the 23
-- are not spellings at all but RENAMINGS, where the two names have nothing in common:
--
--     Wikipedia "Banguingui"      is PSA's TONGKIL
--     Wikipedia "Datu Montawal"   is PSA's PAGAGAWAN
--     Wikipedia "Leon B. Postigo" is PSA's BACUNGAN
--
-- No name rule could ever resolve those, and a fuzzy one would have got them WRONG rather than
-- merely failed -- which is the case for guardrail 1 restated: the near-miss is where a wrong
-- match is least visible, not most excusable.
--
-- THE FIX. Identity is taken from the linked article's CONTENTS, never its title.
--
-- `psgc_identifier` -- the article states a PSGC code, in {{PH brgy table}} rows or a PSA citation
-- URL (muncode=042123000). A code is an identifier; nothing is inferred from it. A code that
-- resolves outside the scoped province is REFUSED rather than reinterpreted: General Salipada K.
-- Pendatun's article cites an ARMM-era code for a place now in the Bangsamoro, and quietly
-- accepting a stale identifier is how a confident wrong answer gets made.
--
-- `barangay_roster` -- the article lists the place's barangays and exactly one candidate in the
-- scoped province has that barangay set. Two municipalities of one province do not share their
-- barangay names, so this is identity by contents. It is not a similarity score in disguise:
-- acceptance needs both a high match and a clear margin over the runner-up, and in the real build
-- every accepted match scores 0.81-1.00 against a runner-up of 0.00-0.33 while the one case that
-- must be refused scores 0.08. Any threshold across a wide band gives the same answer.
--
-- WHAT IT STILL REFUSES, which is the part that shows the guards are real. "Talitay" resolves to
-- nothing: dim_geo files TALITAY under Maguindanao del NORTE while the article is scoped to
-- Maguindanao del Sur, so the right answer is not among the candidates and no threshold should
-- invent one. It is reported, as an unresolved member always is.
alter table geo_district_map drop constraint geo_district_map_match_method_check;
alter table geo_district_map
  add constraint geo_district_map_match_method_check
  check (match_method in ('exact', 'disambiguated', 'crosswalk', 'manual_override',
                          'public_correction', 'whole_parent', 'independent_city',
                          'whole_citymun', 'psgc_identifier', 'barangay_roster'));

comment on column geo_district_map.match_method is
  'How this row was resolved. There is deliberately no fuzzy value: guardrail 1 says an '
  'unresolved LGU is a published finding and a wrongly-matched one is an invisible lie, so the '
  'absence is enforced by this constraint rather than remembered by an implementer. '
  'psgc_identifier = the member''s own article states a PSGC code identifying it. '
  'barangay_roster = the member''s own article lists barangays matching exactly one candidate in '
  'the scoped province -- identity by contents, used where the two sources disagree on the name.';
