# Draft issue for `bettergovph/open-data-visualization`

**Status: draft, not filed.** D1.1 concluded that BetterGov.PH's mapping is not loadable as-is
(`docs/LEGISLATIVE_DISTRICTS_PLAN.md` §4, D1.1). What remains is a licence question plus two
concrete data findings worth reporting back. Filing is not on the critical path for D1.

Filing this is an outward-facing action on a third party's repository and needs the owner's
go-ahead before it is posted.

---

**Title:** Licence for the congressional district mappings, and two data issues in `districts.json`

**Body:**

Hi — thanks for publishing this. We maintain [BHW Connect](https://github.com/jongsky25/bhw-connect-dashboard),
a public dashboard for Barangay Health Worker data in the Philippines. We are adding congressional
district as an analytical dimension, and your sources page describes district mappings covering
256 districts across 85 provinces and 22 cities. Two things, one ask and one contribution.

**1. Licence.** `static/data/districts_generated.json` is the most useful district→LGU mapping we
have found anywhere, and we would like to cite it as a corroboration source against our own
derivation. The repo has no `LICENSE` file, and the README scopes the project to "educational and
research purposes", so we have not used it. Would you consider releasing that file — or the
district mappings generally — under CC0 or CC BY 4.0? We publish our aggregates under CC BY 4.0
and would attribute per row.

**2. Two issues in `static/data/districts.json`**, offered in case they are useful. We think this
file is being read as the district mapping, but it looks like it is derived from project-location
caches (as its own `metadata.note` says) rather than from a district roster:

- **Quezon City's 1st and 3rd Districts contain the identical 115-barangay list**, and the 2nd,
  4th, 5th and 6th each contain the same 5-barangay list. That is 118 distinct barangays against
  Quezon City's actual 142, with most barangays assigned to more than one district. Anything that
  sums a per-barangay quantity by district will multiply-count.
- **`Palo` is listed under Leyte's 4th District.** Palo is in Leyte's 1st, together with Tacloban,
  Alangalang, Babatngon, San Miguel, Santa Fe, Tanauan and Tolosa.

Your `districts_generated.json` has neither problem — it gives Quezon City all 142 barangays with
37 in the 3rd District, and puts Palo in Leyte's 1st. Deriving the district from the
`MEMBER, HOUSE OF REPRESENTATIVES` contest on each precinct return is, as far as we can tell, the
most reliable method available for this, and it is the approach we have adopted ourselves after
finding it in `scripts/extract_districts_from_elections.py`. Credit where it is due.

One note on the published coverage figure, in case it is worth correcting: the "7,418 barangays"
on the sources page matches `city_barangays_mapping.json`, which is a PSGC city→barangay roster
with no district on any row. The barangays actually carrying a district assignment are ~1,800.

Happy to send a PR for any of this if that is easier than an issue.
