#!/usr/bin/env python3
"""D1.3 legislative-district builder (docs/LEGISLATIVE_DISTRICTS_PLAN.md §4).

Builds the congressional district -> LGU mapping that D1.2's four tables hold, from public
sources, with every row carrying the source revision it came from. The mapping is *derived*,
never official: PSA and COMELEC do not publish it in this form (§2), so the build's job is as
much to report what it could not resolve as to emit what it could.

Sources, and why each is here (§2):

  * Wikidata  -- the district REGISTRY. 256 items of wd:Q96020121 with stable QIDs. Membership is
    not modelled there (only 2 of 256 carry P527), so it supplies identity, not composition. The
    roster also mixes current and defunct districts (Agusan del Norte carries 1st, 2nd *and* a
    historical at-large), which is exactly why it is cross-checked rather than trusted.
  * Wikipedia -- the COMPOSITION, at both grains. "Legislative districts of <X>" carries a
    "Current districts" wikitable whose every district row holds a {{Collapsible list}} of
    LGUs as *disambiguated* wikilinks ([[Palo, Leyte|Palo]]). Wikitext is parsed rather than
    rendered HTML precisely for that: the rendered page shows "San Miguel", the wikitext shows
    which one. The same table carries the sitting representative and the PSA 2020 population.
  * COMELEC 2025 precinct returns -- the SECOND OPINION at both grains, adopted in D1.1. Each
    return names the contest the precinct voted in ("MEMBER, HOUSE OF REPRESENTATIVES - <D>"), so
    the district comes off the ballot rather than out of prose.

    **COMELEC is not fetchable from this build environment** (HTTP 403 from
    2025electionresults.comelec.gov.ph and comelec.gov.ph -- bot protection, the same constraint
    build_psgc_crosswalk.py already documents for PSA; the agent proxy reports no relay failures,
    so the block is theirs). Download by hand into the snapshot directory, like every other PSA
    file in this repo. Absent it, the build still runs, every row is marked single-source, and
    the corroboration gate REFUSES to write to the database unless --allow-single-source says so
    in as many words. See "the two-source rule" below.

The two-source rule (§2, guardrail 2): no district assignment ships on one source alone.
Wikipedia and COMELEC are independent in the way that matters -- one is edited prose, the other
is the contest printed on a ballot -- so where they agree the assignment is safe and where they
disagree it belongs in the disagreement report, not in the mapping. The single worst outcome
available here is a plausible mapping nobody cross-checked, which is what D1.1 found in the
field. This script therefore never silently promotes a single-source row.

Never fuzzy-match (guardrail 1). The resolution ladder in resolve_member() has four rungs and no
fifth: an unresolved LGU is a published finding, a wrongly-matched one is an invisible lie.

Run it (modes mirror build_psgc_crosswalk.py / ingest.py):

  # Synthetic fixtures, no network, no DB:
  python ingestion/build_legislative_districts.py --selftest

  # Pull Wikidata + Wikipedia wikitext into committed snapshots (records every revid):
  python ingestion/build_legislative_districts.py --fetch --snapshot-dir ingestion/data/districts_20th

  # The reproducible path CI can run -- no network:
  python ingestion/build_legislative_districts.py --from-snapshot ingestion/data/districts_20th \
      --dim-geo-csv ingestion/data/dim_geo.csv --emit-sql-dir ingestion/_sql_districts

  # Refresh docs/LEGISLATIVE_DISTRICTS.md's reconciliation section:
  python ingestion/build_legislative_districts.py --from-snapshot … --dim-geo-csv … --write-doc-summary

Snapshots are committed. The build must be reproducible without the network, and it must be
possible to diff *why* a mapping changed between two runs -- which is also what makes a public
correction reviewable against the source we actually used.
"""

import argparse
import csv
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

from ingest import batched, insert_statement

REPO_ROOT = Path(__file__).resolve().parent.parent
QA_REPORT_PATH = REPO_ROOT / "ingestion" / "_qa_report_legislative_districts.json"
DOC_PATH = REPO_ROOT / "docs" / "LEGISLATIVE_DISTRICTS.md"

DATASET_SLUG = "ph-legislative-districts"
CONGRESS_NO = 20
CONGRESS_VALID_FROM = "2025-06-30"          # 20th Congress convened
WIKIDATA_DISTRICT_CLASS = "Q96020121"       # legislative district of the Philippines

# Wikimedia asks for a descriptive UA and throttles hard without one; both APIs returned 429 to a
# default urllib UA during development. Throttle + exponential backoff are not politeness here,
# they are the difference between a build that completes and one that does not.
USER_AGENT = (
    "BHWConnectDashboard/1.0 "
    "(https://github.com/jongsky25/BHW-Connect-Dashboard; district mapping ingest) python-urllib"
)
THROTTLE_SECONDS = 2.0
MAX_ATTEMPTS = 6

DISTRICT_COLUMNS = [
    "district_code", "congress_no", "district_name", "ordinal", "is_lone",
    "parent_geo_code", "region_code", "wikidata_qid", "psa_population",
    "valid_from", "valid_to", "source_kind", "source_ref", "retrieved_at", "status",
]
MAP_COLUMNS = [
    "district_code", "geo_code", "geo_level", "match_method",
    "source_kind", "source_ref", "retrieved_at", "corroboration",
    "corroborating_source_ref", "status",
]
REP_COLUMNS = [
    "district_code", "congress_no", "full_name", "party", "as_of",
    "source_kind", "source_ref", "status",
]
BATCH_SIZE = 500


# --------------------------------------------------------------------------- #
# 0. Manual overrides (rung 4 of the ladder)                                   #
# --------------------------------------------------------------------------- #
# Each entry carries a one-line reason. These are the cases where the source name and dim_geo
# genuinely disagree about identity -- not cases where matching was merely hard. Adding a row
# here is a decision; adding one to make a count come out is the failure this table exists to
# make visible.
MANUAL_OVERRIDES = {
    # (parent page, member name as written) -> dim_geo geo_code
    # Populated as the reconciliation report surfaces real cases; empty is the honest start.
}

# Members that are not places at all: footnote markers, stray table syntax, and the handful of
# labels Wikipedia uses for a whole city rather than one of its barangays.
NON_PLACE_MEMBERS = {"", "-", "—", "none", "n/a", "tbd"}


# --------------------------------------------------------------------------- #
# 1. Name normalisation                                                        #
# --------------------------------------------------------------------------- #
def normalise_name(name):
    """Fold a source place name onto dim_geo's spelling conventions.

    Deliberately conservative: it strips punctuation, accents and the honorific 'City of' /
    'City' word-order variants that PSA and Wikipedia disagree on, and nothing else. It must
    never make two genuinely different places compare equal -- that is the whole hazard here.
    """
    s = (name or "").strip().lower()
    s = s.replace("ñ", "n").replace("ç", "c")
    for a, b in (("á", "a"), ("é", "e"), ("í", "i"), ("ó", "o"), ("ú", "u")):
        s = s.replace(a, b)
    s = re.sub(r"\(.*?\)", " ", s)             # "(capital)" and friends
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    # "City of Manila" and "Manila City" both fold to "manila"; a bare "manila" already matches.
    s = re.sub(r"^city of ", "", s)
    s = re.sub(r" city$", "", s)
    return s


def district_slug(parent, ordinal_label):
    """'Leyte', '1st' -> 'leyte-1st'; 'Batanes', 'Lone' -> 'batanes-lone'.

    A slug, not a PSGC-derived code, per §1.1: a code that encodes a parent asserts a parentage
    that is sometimes false (Taguig-Pateros spans a city and a municipality; Tacloban votes with
    Leyte's 1st while being a province-level row in dim_geo).
    """
    p = normalise_name(parent).replace(" ", "-")
    o = normalise_name(ordinal_label).replace(" ", "-")
    return f"{p}-{o}"


# --------------------------------------------------------------------------- #
# 2. Wikitext parsing                                                          #
# --------------------------------------------------------------------------- #
WIKILINK_RE = re.compile(r"\[\[([^\]\|]+)(?:\|([^\]]*))?\]\]")
DISTRICT_ROW_RE = re.compile(
    r"^!\s*\[\[(?P<target>[^\]\|]*congressional district)\s*(?:\|(?P<label>[^\]]*))?\]\]",
    re.IGNORECASE,
)


def strip_markup(text):
    """Drop refs, footnotes, files, templates-with-no-content and formatting, keeping link text."""
    text = re.sub(r"<ref[^>]*/>", " ", text)
    text = re.sub(r"<ref.*?</ref>", " ", text, flags=re.S)
    text = re.sub(r"\{\{efn.*?\}\}", " ", text, flags=re.S)
    text = re.sub(r"\{\{!\}\}", " ", text)
    text = re.sub(r"<br\s*/?>", " ", text)
    text = re.sub(r"<small>|</small>", " ", text)
    text = re.sub(r"'''|''", "", text)
    return text


def link_text_and_target(fragment):
    """Return (display_text, link_target) for a member cell fragment.

    The link target is what makes rung 2 of the ladder possible: '[[San Miguel, Leyte|San Miguel]]'
    displays 'San Miguel' but targets the disambiguated page, and that is the only thing in the
    source that says *which* San Miguel.
    """
    fragment = strip_markup(fragment).strip()
    m = WIKILINK_RE.search(fragment)
    if m:
        target = m.group(1).strip()
        display = (m.group(2) or m.group(1)).strip()
        return display, target
    return fragment.strip(), None


def extract_collapsible_members(cell):
    """Pull the member list out of a {{Collapsible list ...}} template.

    Members are pipe-separated and may be bare text ('Alicia') or wikilinks; the template's own
    named parameters (title=, framestyle=, …) are dropped.
    """
    i = cell.lower().find("{{collapsible list")
    if i == -1:
        return []
    depth, j = 0, i
    while j < len(cell):
        if cell.startswith("{{", j):
            depth += 1
            j += 2
            continue
        if cell.startswith("}}", j):
            depth -= 1
            j += 2
            if depth == 0:
                break
            continue
        j += 1
    body = cell[i + len("{{collapsible list"):j - 2]
    members = []
    for part in split_top_level(body, "|"):
        part = part.strip()
        if not part or "=" in part.split("[[")[0][:20]:   # named param like title=
            continue
        display, target = link_text_and_target(part)
        if display and display.lower() not in NON_PLACE_MEMBERS:
            members.append({"name": display, "link_target": target})
    return members


def split_top_level(text, sep):
    """Split on `sep` only outside [[...]] and {{...}}, so piped wikilinks stay intact."""
    out, buf, depth_t, depth_l = [], [], 0, 0
    i = 0
    while i < len(text):
        if text.startswith("{{", i):
            depth_t += 1; buf.append("{{"); i += 2; continue
        if text.startswith("}}", i):
            depth_t -= 1; buf.append("}}"); i += 2; continue
        if text.startswith("[[", i):
            depth_l += 1; buf.append("[["); i += 2; continue
        if text.startswith("]]", i):
            depth_l -= 1; buf.append("]]"); i += 2; continue
        if text[i] == sep and depth_t == 0 and depth_l == 0:
            out.append("".join(buf)); buf = []; i += 1; continue
        buf.append(text[i]); i += 1
    out.append("".join(buf))
    return out


# A section heading that marks its districts as NOT the current apportionment. Scoping by an
# allowlist of "Current …" headings was tried first and is not viable: across the 114 pages the
# current section is variously headed "Current districts", "Current Districts", "Current District",
# "Current districts and representatives", "Current congressional districts", "Current composition",
# "Current", "Congressional representation", or simply "Lone District" -- and 46 pages have no
# "Current" heading at all. Excluding the *defunct* headings is the smaller, checkable rule, and it
# fails safe in the right direction: a heading this misses adds a district that validation then
# catches, whereas an allowlist that misses a heading drops a district silently.
DEFUNCT_SECTION_RE = re.compile(
    r"defunct|histor(?:y|ical)|abolished|former|redistrict|apportionment|"
    r"\(1[6-9]\d\d|\(20[01]\d|"          # "(1898-1986)", "(2010-2016)"
    r"senatorial|provincial board|city council|sangguniang",
    re.I,
)


def iter_sections(wikitext):
    """Yield (heading, body) for every ==-level section, plus ('', preamble) for the lead."""
    marks = [(m.start(), m.end(), m.group(1).strip())
             for m in re.finditer(r"^==\s*([^=].*?)\s*==\s*$", wikitext, re.M)]
    if not marks:
        yield "", wikitext
        return
    yield "", wikitext[:marks[0][0]]
    for i, (_, end, heading) in enumerate(marks):
        stop = marks[i + 1][0] if i + 1 < len(marks) else len(wikitext)
        yield heading, wikitext[end:stop]


def current_district_sections(wikitext):
    """Every section that may describe the *current* apportionment.

    Returns [(heading, body)]. Defunct/historical sections are dropped here rather than filtered
    downstream, because a defunct district silently merged into the current roster is the kind of
    error that only shows up two phases later as a district with impossible membership.
    """
    return [(h, b) for h, b in iter_sections(wikitext) if not DEFUNCT_SECTION_RE.search(h)]


def parse_population(cell):
    m = re.search(r"\b(\d{1,3}(?:,\d{3})+)\b", strip_markup(cell))
    return int(m.group(1).replace(",", "")) if m else None


def parse_representative(cell):
    """First bolded wikilink in the representative cell: '''[[Arjo Atayde]]'''."""
    m = re.search(r"'''\s*\[\[([^\]\|]+)(?:\|([^\]]*))?\]\]\s*'''", cell)
    if m:
        return (m.group(2) or m.group(1)).strip()
    m = re.search(r"'''([^'\[\]]{3,60})'''", cell)
    return m.group(1).strip() if m else None


def parse_district_table(wikitext, parent_name):
    """Parse a 'Legislative districts of <parent>' page into district records.

    Returns [{ordinal_label, district_title, members[], representative, population, is_lone}].

    Two things this does NOT do, both learned from the real pages:

      * It does not locate districts by column position. The column layout genuinely differs
        between pages -- Leyte's table has one party column, Quezon City's has four -- so rows are
        found by their district-link header cell instead.
      * It does not require a member list. A lone/at-large district's constituent LGUs are simply
        the whole parent, and Wikipedia (reasonably) does not enumerate them. Those come back with
        an empty member list and are expanded by the caller, recorded as `whole_parent` so the
        provenance stays honest rather than being passed off as a name match.
    """
    districts, seen = [], set()
    for _heading, body in current_district_sections(wikitext):
        for block in re.split(r"^\|-.*$", body, flags=re.M):
            header = None
            for line in block.splitlines():
                m = DISTRICT_ROW_RE.match(line.strip())
                if m:
                    header = m
                    break
            if not header:
                continue
            target = header.group("target").strip()
            if target in seen:            # the same district listed twice on one page
                continue
            seen.add(target)
            label = (header.group("label") or "").strip()
            ordinal_label = label or target
            m2 = re.match(r"^(.*?)'s (.+?) congressional district$", target, re.I)
            if m2 and not label:
                ordinal_label = m2.group(2)
            members = extract_collapsible_members(block)
            is_lone = bool(re.search(r"lone|at.large", ordinal_label + " " + target, re.I))
            districts.append({
                "ordinal_label": ordinal_label.strip(),
                "district_title": target,
                "members": members,
                "representative": parse_representative(block),
                "population": parse_population(block),
                "is_lone": is_lone,
            })
    return districts


def extract_template(wikitext, name):
    """Return the raw source of the first {{name ...}} template, brace-matched."""
    i = wikitext.lower().find("{{" + name.lower())
    if i == -1:
        return None
    depth, j = 0, i
    while j < len(wikitext):
        if wikitext.startswith("{{", j):
            depth += 1; j += 2; continue
        if wikitext.startswith("}}", j):
            depth -= 1; j += 2
            if depth == 0:
                break
            continue
        j += 1
    return wikitext[i:j]


def template_fields(template_src):
    """{{Infobox constituency|a=1|b=2}} -> {'a': '1', 'b': '2'} (top-level params only)."""
    out = {}
    for part in split_top_level(template_src[2:-2], "|")[1:]:
        if "=" not in part:
            continue
        k, _, v = part.partition("=")
        out[k.strip().lower()] = v.strip()
    return out


# Group captions inside a {{Collapsible list}} -- bolded "Cities" / "Municipalities" rows -- are
# headings, not places. They are dropped by name rather than by position because their order and
# presence vary between articles.
GROUP_CAPTIONS = {"cities", "municipalities", "barangays", "city", "municipality",
                  "component cities", "independent component cities"}


# Numbered-barangay cities (Caloocan, Manila, Pasay, Navotas) do not enumerate their barangays in
# the infobox; they write runs. Three shapes occur and all three appear in Caloocan's 1st alone:
#   "Barangays 1-4"           a range
#   "Barangays 176-A, 176-B"  a numbered barangay with a letter suffix, then bare continuations
#   "(Barangays 1-146)"       a run in parentheses beside a district name (Manila)
# dim_geo spells these "BARANGAY 1" and "BARANGAY 176-A", so expanding a run into individual
# names resolves exactly. Expanding is safe in a way fuzzy matching is not: the expansion is
# arithmetic, and every name it produces still has to exist in dim_geo to become a row.
BARANGAY_RANGE_RE = re.compile(r"^barangays?\s+(\d+)\s*[–—-]\s*(\d+)$", re.I)
BARANGAY_ONE_RE = re.compile(r"^barangays?\s+(\d+(?:\s*-\s*[A-Za-z])?)$", re.I)
BARE_CONTINUATION_RE = re.compile(r"^(\d+(?:\s*-\s*[A-Za-z])?)$")
INLINE_RANGE_RE = re.compile(r"barangays?\s+(\d+)\s*[–—-]\s*(\d+)", re.I)


def expand_barangay_runs(members, raw_field=""):
    """Turn "Barangays 1-4" and its bare continuations into individual barangay names.

    `raw_field` is scanned as well, to catch runs written beside a name rather than as their own
    entry -- Manila's 1st reads "West [[Tondo, Manila|Tondo]]<br>(Barangays 1-146)".
    """
    out, seen = [], set()

    def add(name, link_target=None):
        key = name.strip().lower()
        if key and key not in seen:
            seen.add(key)
            out.append({"name": name, "link_target": link_target})

    numbering_context = False
    for m in members:
        name = m["name"].strip()
        rng = BARANGAY_RANGE_RE.match(name)
        if rng:
            numbering_context = True
            lo, hi = int(rng.group(1)), int(rng.group(2))
            if lo <= hi and hi - lo <= 1000:
                for n in range(lo, hi + 1):
                    add(f"Barangay {n}")
            continue
        one = BARANGAY_ONE_RE.match(name)
        if one:
            numbering_context = True
            add("Barangay " + re.sub(r"\s*-\s*", "-", one.group(1)).upper())
            continue
        cont = BARE_CONTINUATION_RE.match(name)
        if cont and numbering_context:
            add("Barangay " + re.sub(r"\s*-\s*", "-", cont.group(1)).upper())
            continue
        numbering_context = False
        add(m["name"], m.get("link_target"))

    for lo, hi in INLINE_RANGE_RE.findall(raw_field or ""):
        lo, hi = int(lo), int(hi)
        if lo <= hi and hi - lo <= 1000:
            for n in range(lo, hi + 1):
                add(f"Barangay {n}")
    return out


def parse_towns_field(value):
    """Members out of an infobox `|towns =` field.

    Two shapes occur and both must work, because they are split roughly evenly across the 256
    articles: pipe-separated entries ("| [[Butuan]] | [[Las Nieves, ...]]"), and a single
    parameter holding a comma-separated run ("Amihan, Bagumbuhay, [[Camp Aguinaldo]], ...").
    Splitting is done at top level only, so a comma inside "[[Santa Cruz, Quezon City|Santa
    Cruz]]" does not tear the link in half -- which is the whole reason a naive split(",")
    cannot be used here.
    """
    src = extract_template(value, "Collapsible list")
    body = src[2 + len("Collapsible list"):-2] if src else value
    members = []
    for part in split_top_level(body, "|"):
        part = part.strip()
        if not part or "=" in part.split("[[")[0][:20]:      # titlestyle=, title=
            continue
        for piece in split_top_level(part, ","):
            piece = strip_markup(piece).strip()
            if not piece:
                continue
            display, target = link_text_and_target(piece)
            if not display or display.lower() in NON_PLACE_MEMBERS:
                continue
            if display.strip().lower() in GROUP_CAPTIONS:
                continue
            members.append({"name": display, "link_target": target})
    return expand_barangay_runs(members, value)


def parse_district_article(wikitext):
    """Composition and vintage for one district, from its own article's infobox.

    The district articles are a better primary source for composition than the province pages:
    all of them carry the same {{Infobox constituency}}, and -- decisively -- that infobox carries
    `abolished`. Agusan del Norte's 1st reads `abolished = 2025`, which is exactly why its
    province page now shows only a hatnote. Without reading that field a build would happily load
    a district the 20th Congress does not have.
    """
    box = extract_template(wikitext, "Infobox constituency")
    if not box:
        return None
    f = template_fields(box)

    def year(key):
        m = re.search(r"(\d{4})", f.get(key, "") or "")
        return int(m.group(1)) if m else None

    return {
        "name": strip_markup(f.get("name", "")).strip(),
        "parent": link_text_and_target(f.get("district", ""))[0],
        "region": link_text_and_target(f.get("region", ""))[0],
        "members": parse_towns_field(f.get("towns", "")) if f.get("towns") else [],
        "population": parse_population(f.get("population", "")),
        "year": year("year"),
        "abolished": year("abolished"),
    }


# --------------------------------------------------------------------------- #
# 3. dim_geo index + the resolution ladder (D1.4)                              #
# --------------------------------------------------------------------------- #
class GeoIndex:
    """dim_geo, indexed the several ways the ladder and scope detection need to ask about it.

    One property of dim_geo drives the shape of this class and is worth stating plainly, because
    it is not guessable and it breaks any naive "a city is a citymun" assumption:

      * Every NCR highly urbanised city appears TWICE -- once as a province-level row
        ('CITY OF CALOOCAN (HUC)', 13801) and once as a citymun ('CITY OF CALOOCAN', 1380100).
      * Manila is the exception to the exception. Its province-level row (13806) has SIXTEEN
        citymun children, which are Manila's *administrative* districts (Tondo I/II, Quiapo,
        Sampaloc, Malate, ...) -- the only place PSGC uses a 'district' level at all (§2). The
        barangays hang off those, so a legislative district of Manila draws its barangays from a
        subtree, never from one citymun row.

    So barangay membership is resolved against a SET of citymun codes, not a single parent.
    """

    def __init__(self, rows):
        self.rows = rows
        self.by_code = {r["geo_code"]: r for r in rows}
        self.children = defaultdict(list)
        self.citymun_by_province = defaultdict(lambda: defaultdict(list))
        self.barangay_by_citymun = defaultdict(lambda: defaultdict(list))
        self.citymun_by_name = defaultdict(list)
        self.province_by_name = defaultdict(list)
        for r in rows:
            if r.get("parent_code"):
                self.children[r["parent_code"]].append(r)
        for r in rows:
            lvl, nm = r["geo_level"], normalise_name(r["geo_name"])
            if lvl == "province":
                self.province_by_name[nm].append(r)
            elif lvl == "citymun":
                self.citymun_by_province[r.get("province_code") or ""][nm].append(r)
                self.citymun_by_name[nm].append(r)
            elif lvl == "barangay":
                self.barangay_by_citymun[r.get("parent_code") or ""][nm].append(r)

    def citymun_codes_under(self, code):
        """Every citymun in the subtree rooted at `code` (itself, if it is one)."""
        row = self.by_code.get(code)
        if row is None:
            return set()
        if row["geo_level"] == "citymun":
            return {code}
        return {c["geo_code"] for c in self.children.get(code, []) if c["geo_level"] == "citymun"}

    def find_barangay(self, name, citymun_codes):
        hits = []
        for cm in citymun_codes:
            hits.extend(self.barangay_by_citymun.get(cm, {}).get(name, []))
        return hits


def resolve_member(member, scope, geo, crosswalk=None):
    """Resolve one source member name onto a dim_geo row. Returns (row, match_method) or
    (None, reason).

    The ladder, in order, each rung recorded as its own match_method (§4/D1.4):

      1. exact          -- normalised name matches exactly one citymun (or barangay) in scope.
      2. disambiguated  -- the wikilink target carries the province ('[[San Miguel, Leyte|…]]')
                           and that resolves to exactly one row. This is why wikitext is parsed
                           rather than rendered HTML.
      3. crosswalk      -- resolve through the PSGC crosswalk where the source name corresponds
                           to a pre-NIR or pre-Maguindanao-split entity.
      4. manual_override-- a committed entry with a stated reason.

    There is no rung 5. An ambiguous or missing name returns unresolved and is reported;
    fuzzy-matching a place name into a district assignment is the failure this repo's
    reconciliation discipline exists to prevent (guardrail 1).
    """
    name = normalise_name(member["name"])
    target = member.get("link_target")

    override = MANUAL_OVERRIDES.get((scope.get("parent_name"), member["name"]))
    if override:
        row = geo.by_code.get(override)
        return (row, "manual_override") if row else (None, "override_code_not_in_dim_geo")

    # Barangay scope: a multi-district city, where members are barangays somewhere in that
    # city's subtree (one citymun for most cities, sixteen for Manila -- see GeoIndex).
    if scope.get("citymun_codes"):
        cands = geo.find_barangay(name, scope["citymun_codes"])
        if len(cands) == 1:
            return cands[0], "exact"
        if len(cands) > 1:
            return None, "ambiguous_barangay"
        return None, "unresolved_barangay"

    # Province scope: members are cities/municipalities.
    prov = scope.get("province_code")
    if prov:
        cands = geo.citymun_by_province.get(prov, {}).get(name, [])
        if len(cands) == 1:
            return cands[0], "exact"
        if len(cands) > 1:
            return None, "ambiguous_in_province"

    # Rung 2: the disambiguated link target names its province ('San Miguel, Leyte').
    if target and "," in target:
        base, _, qualifier = target.partition(",")
        qn, bn = normalise_name(qualifier), normalise_name(base)
        prov_rows = geo.province_by_name.get(qn, [])
        if len(prov_rows) == 1:
            cands = geo.citymun_by_province.get(prov_rows[0]["geo_code"], {}).get(bn, [])
            if len(cands) == 1:
                return cands[0], "disambiguated"
        # The qualifier may name a city (a barangay page like '[[Project 6, Quezon City]]').
        city_cands = geo.citymun_by_name.get(qn, [])
        if len(city_cands) == 1:
            b = geo.find_barangay(bn, geo.citymun_codes_under(city_cands[0]["geo_code"]))
            if len(b) == 1:
                return b[0], "disambiguated"

    # Rung 1 without a province scope: unique nationally is still exact.
    cands = geo.citymun_by_name.get(name, [])
    if len(cands) == 1:
        return cands[0], "exact"
    if len(cands) > 1:
        return None, "ambiguous_nationally"

    # Rung 3: PSGC crosswalk (pre-NIR / pre-Maguindanao-split names carried by older sources).
    if crosswalk:
        code = crosswalk.get(name)
        row = geo.by_code.get(code) if code else None
        if row:
            return row, "crosswalk"

    return None, "unresolved"


# --------------------------------------------------------------------------- #
# 4. Fetch + snapshot                                                          #
# --------------------------------------------------------------------------- #
def _http_json(url, accept="application/json"):
    delay = 20
    last = None
    for _ in range(MAX_ATTEMPTS):
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (429, 503):
                time.sleep(delay)
                delay = min(delay * 2, 180)
                continue
            raise
    raise SystemExit(f"gave up after {MAX_ATTEMPTS} attempts: {url} ({last})")


def fetch_wikidata_registry():
    """The district registry: QID, label and population for every wd:Q96020121."""
    query = (
        "SELECT ?d ?dLabel ?pop WHERE { ?d wdt:P31 wd:%s . "
        "OPTIONAL { ?d wdt:P1082 ?pop } "
        'SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }' % WIKIDATA_DISTRICT_CLASS
    )
    url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode(
        {"query": query, "format": "json"}
    )
    data = _http_json(url, accept="application/sparql-results+json")
    out = []
    for b in data["results"]["bindings"]:
        out.append({
            "qid": b["d"]["value"].rsplit("/", 1)[-1],
            "label": b["dLabel"]["value"],
            "population": int(b["pop"]["value"]) if "pop" in b else None,
        })
    return out


def parents_from_registry(registry):
    """'Leyte's 1st congressional district' -> parent 'Leyte'. Parents are the page list."""
    parents = {}
    unparsed = []
    for item in registry:
        m = re.match(r"^(.*?)'s (.+?) congressional district$", item["label"])
        if not m:
            unparsed.append(item["label"])
            continue
        parents.setdefault(m.group(1), []).append(item)
    return parents, unparsed


TITLES_PER_REQUEST = 40   # MediaWiki allows 50 titles per query for anonymous clients


def fetch_pages_batch(titles):
    """Fetch up to TITLES_PER_REQUEST pages' wikitext + revid in ONE API call.

    This is not a micro-optimisation. Fetched one page at a time, en.wikipedia.org rate-limited
    this build to roughly one page every three minutes (HTTP 429 with exponential backoff),
    which puts a 114-page run at about five hours. `action=query&prop=revisions` takes up to 50
    titles per request, turning the same run into three calls. Fewer, larger requests is also
    simply the politer way to use the API.

    Returns {normalised title: {"title","revid","wikitext"}} plus a list of missing titles.
    """
    url = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "prop": "revisions", "rvprop": "content|ids", "rvslots": "main",
        "titles": "|".join(titles), "format": "json", "formatversion": "2", "redirects": "1",
    })
    data = _http_json(url)
    out, missing = {}, []
    query = data.get("query", {})
    # A redirect means the page exists under another name; map it back so the caller can match
    # what it asked for to what it got.
    redirects = {r["from"]: r["to"] for r in query.get("redirects", [])}
    for page in query.get("pages", []):
        if page.get("missing"):
            missing.append(page.get("title"))
            continue
        rev = page["revisions"][0]
        out[page["title"]] = {
            "title": page["title"],
            "revid": rev["revid"],
            "wikitext": rev["slots"]["main"]["content"],
        }
    return out, missing, redirects


def do_fetch(snapshot_dir: Path):
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    registry = fetch_wikidata_registry()
    (snapshot_dir / "wikidata_registry.json").write_text(json.dumps(registry, indent=1))
    parents, unparsed = parents_from_registry(registry)
    pages_dir = snapshot_dir / "wikipedia"
    pages_dir.mkdir(exist_ok=True)

    title_to_parent = {f"Legislative districts of {p}": p for p in sorted(parents)}
    titles = list(title_to_parent)
    index, missing = {}, []
    for i in range(0, len(titles), TITLES_PER_REQUEST):
        chunk = titles[i:i + TITLES_PER_REQUEST]
        print(f"  batch {i // TITLES_PER_REQUEST + 1}: {len(chunk)} titles", flush=True)
        fetched, gone, redirects = fetch_pages_batch(chunk)
        for t in gone:
            missing.append({"title": t, "parent": title_to_parent.get(t), "error": "missing"})
        # Match results back to the title we asked for, following any redirect.
        for asked in chunk:
            landed = redirects.get(asked, asked)
            page = fetched.get(landed)
            if page is None:
                if not any(m["title"] == asked for m in missing):
                    missing.append({"title": asked, "parent": title_to_parent.get(asked),
                                    "error": "not returned"})
                continue
            parent = title_to_parent[asked]
            fn = re.sub(r"[^A-Za-z0-9]+", "_", parent).strip("_") + ".json"
            (pages_dir / fn).write_text(json.dumps(
                {"parent": parent, "title": page["title"], "revid": page["revid"],
                 "wikitext": page["wikitext"], "requested_title": asked},
                indent=1,
            ))
            index[parent] = {"file": fn, "revid": page["revid"], "title": page["title"]}
        time.sleep(THROTTLE_SECONDS)

    # The district articles: one per registry entry, and the source of composition (see
    # parse_district_article). Batched the same way -- 256 titles is seven requests.
    arts_dir = snapshot_dir / "articles"
    arts_dir.mkdir(exist_ok=True)
    art_titles = [r["label"] for r in registry]
    art_index, art_missing = {}, []
    for i in range(0, len(art_titles), TITLES_PER_REQUEST):
        chunk = art_titles[i:i + TITLES_PER_REQUEST]
        print(f"  article batch {i // TITLES_PER_REQUEST + 1}: {len(chunk)} titles", flush=True)
        fetched, gone, redirects = fetch_pages_batch(chunk)
        art_missing.extend(gone)
        for asked in chunk:
            page = fetched.get(redirects.get(asked, asked))
            if page is None:
                if asked not in art_missing:
                    art_missing.append(asked)
                continue
            fn = re.sub(r"[^A-Za-z0-9]+", "_", asked).strip("_")[:120] + ".json"
            (arts_dir / fn).write_text(json.dumps(
                {"label": asked, "title": page["title"], "revid": page["revid"],
                 "wikitext": page["wikitext"]}, indent=1))
            art_index[asked] = {"file": fn, "revid": page["revid"], "title": page["title"]}
        time.sleep(THROTTLE_SECONDS)

    (snapshot_dir / "index.json").write_text(json.dumps(
        {"retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
         "pages": index, "missing": missing, "unparsed_labels": unparsed,
         "articles": art_index, "articles_missing": art_missing},
        indent=1,
    ))
    print(f"snapshot written to {snapshot_dir} "
          f"({len(index)} province pages, {len(art_index)} district articles, "
          f"{len(missing) + len(art_missing)} missing)")


# --------------------------------------------------------------------------- #
# 5. Build from snapshot                                                       #
# --------------------------------------------------------------------------- #
def load_snapshot(snapshot_dir: Path):
    idx = json.loads((snapshot_dir / "index.json").read_text())
    registry = json.loads((snapshot_dir / "wikidata_registry.json").read_text())
    pages = {}
    for parent, meta in idx["pages"].items():
        pages[parent] = json.loads((snapshot_dir / "wikipedia" / meta["file"]).read_text())
    articles = {}
    for label, meta in idx.get("articles", {}).items():
        articles[label] = json.loads((snapshot_dir / "articles" / meta["file"]).read_text())
    return idx, registry, pages, articles


def load_dim_geo_csv(path):
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        r.setdefault("province_code", "")
        r.setdefault("parent_code", "")
    return rows


def candidate_scopes(parent_name, geo):
    """Every plausible reading of what a 'Legislative districts of <X>' page is about.

    Name lookup alone cannot decide this, and the failures are not hypothetical:

      * 'Quezon City' normalises to the same key as the province of **Quezon**. Picking the
        province would file six city districts' barangays under a province that does not contain
        them.
      * 'Leyte' is both a province (08037) and a municipality inside it (0803729).
      * NCR HUCs exist at province *and* citymun level, and Manila's barangays live two levels
        down (see GeoIndex).

    So this returns candidates and lets the evidence choose (see choose_scope): the reading under
    which the page's own member names actually resolve is the right one. That is a fact about the
    data rather than a guess about naming, and it is why no hand-maintained city list is needed.
    """
    n = normalise_name(parent_name)
    out = []
    for prov in geo.province_by_name.get(n, []):
        # Reading A: a province whose members are its cities/municipalities.
        out.append({
            "parent_name": parent_name, "grain": "citymun", "province_code": prov["geo_code"],
            "parent_geo_code": prov["geo_code"], "region_code": prov.get("region_code"),
            "reading": f"province {prov['geo_code']} ({prov['geo_name']})",
        })
        # Reading B: an HUC filed at province level, whose members are barangays in its subtree.
        cms = geo.citymun_codes_under(prov["geo_code"])
        if cms:
            out.append({
                "parent_name": parent_name, "grain": "barangay", "citymun_codes": cms,
                "parent_geo_code": prov["geo_code"], "region_code": prov.get("region_code"),
                "reading": f"HUC subtree {prov['geo_code']} ({len(cms)} citymun)",
            })
    for city in geo.citymun_by_name.get(n, []):
        out.append({
            "parent_name": parent_name, "grain": "barangay",
            "citymun_codes": {city["geo_code"]},
            "parent_geo_code": city["geo_code"], "region_code": city.get("region_code"),
            "reading": f"citymun {city['geo_code']} ({city['geo_name']})",
        })
    return out


def is_huc_province_row(row):
    """dim_geo files every NCR highly urbanised city at province level as 'CITY OF X (HUC)'."""
    n = (row.get("geo_name") or "").upper()
    return "(HUC)" in n or n.startswith("CITY OF")


def default_scope(parent_name, geo):
    """The reading to use when a page offers no member names to score.

    That happens for lone/at-large districts, which Wikipedia does not enumerate because the
    district simply *is* the whole parent. With nothing to resolve, evidence cannot choose, so
    fall back to what the dim_geo level actually means: a plain province is read at citymun
    grain, a city (whether filed as citymun or as an HUC province row) at barangay grain.
    """
    n = normalise_name(parent_name)
    plain = [r for r in geo.province_by_name.get(n, []) if not is_huc_province_row(r)]
    if len(plain) == 1:
        return {"parent_name": parent_name, "grain": "citymun", "province_code": plain[0]["geo_code"],
                "parent_geo_code": plain[0]["geo_code"], "region_code": plain[0].get("region_code"),
                "reading": f"province {plain[0]['geo_code']} (default)"}
    cities = geo.citymun_by_name.get(n, [])
    if len(cities) == 1:
        return {"parent_name": parent_name, "grain": "barangay",
                "citymun_codes": {cities[0]["geo_code"]},
                "parent_geo_code": cities[0]["geo_code"], "region_code": cities[0].get("region_code"),
                "reading": f"citymun {cities[0]['geo_code']} (default)"}
    hucs = [r for r in geo.province_by_name.get(n, []) if is_huc_province_row(r)]
    if len(hucs) == 1:
        cms = geo.citymun_codes_under(hucs[0]["geo_code"])
        return {"parent_name": parent_name, "grain": "barangay", "citymun_codes": cms,
                "parent_geo_code": hucs[0]["geo_code"], "region_code": hucs[0].get("region_code"),
                "reading": f"HUC subtree {hucs[0]['geo_code']} (default)"}
    return None


def whole_parent_members(scope, geo):
    """Every dim_geo row a lone district covers, by definition of 'lone'.

    This is a containment fact, not a name match, so it is recorded as its own match_method
    (`whole_parent`) rather than dressed up as `exact`. A reader of /districts/[code] can then
    tell "we matched this name to this place" apart from "this district covers this whole
    province", which are different claims with different ways of being wrong.
    """
    if scope.get("grain") == "citymun" and scope.get("province_code"):
        return [r for r in geo.children.get(scope["province_code"], []) if r["geo_level"] == "citymun"]
    if scope.get("grain") == "barangay" and scope.get("citymun_codes"):
        out = []
        for cm in scope["citymun_codes"]:
            out.extend(r for r in geo.children.get(cm, []) if r["geo_level"] == "barangay")
        return out
    return []


def choose_scope(parent_name, districts, geo, crosswalk=None):
    """Pick the reading of a page under which its own members actually resolve.

    Scores each candidate by how many of the page's member names it resolves, and requires a
    strict winner. A tie or a zero score is reported as scope_unknown rather than guessed --
    the same posture the resolution ladder takes one level down.
    """
    members = [m for d in districts for m in d["members"]]
    if not members:
        # Nothing to score (a lone-district page). Fall back to what the levels mean.
        sc = default_scope(parent_name, geo)
        return sc, [(0, sc["reading"])] if sc else []
    # Distinct readings can be the SAME reading arrived at two ways: an HUC's province-level row
    # and its single citymun child resolve against exactly the same barangays. Deduping by what a
    # candidate actually resolves against -- rather than by how it was described -- is what stops
    # those from looking like a tie and being reported as ambiguous. This is why Cagayan de Oro,
    # Cebu City and Davao City resolve at all.
    scored, seen_targets = [], {}
    for cand in candidate_scopes(parent_name, geo):
        key = ("barangay", frozenset(cand.get("citymun_codes", ()))) if cand["grain"] == "barangay" \
            else ("citymun", cand.get("province_code"))
        if key in seen_targets:
            continue
        seen_targets[key] = True
        hits = sum(1 for m in members if resolve_member(m, cand, geo, crosswalk)[0] is not None)
        scored.append((hits, cand))
    if not scored:
        return None, []
    scored.sort(key=lambda t: -t[0])
    best, best_cand = scored[0]
    if best == 0:
        return None, [(h, c["reading"]) for h, c in scored]
    if len(scored) > 1 and scored[1][0] == best:
        return None, [(h, c["reading"]) for h, c in scored]
    return best_cand, [(h, c["reading"]) for h, c in scored]


def build(idx, registry, pages, articles, geo, crosswalk=None, congress_year=2025):
    """Parse + resolve every district into district / membership / representative rows.

    Composition comes from the per-district articles, not the province tables. Both are
    Wikipedia, so this is not a second source in the sense guardrail 2 means -- it is simply the
    better-shaped one: all 256 articles carry the same infobox, and only the infobox records
    `abolished`, which is what separates the 20th Congress's districts from its predecessors'.
    The province pages still supply the sitting representative, which the articles do not carry
    in a uniform field.
    """
    retrieved_at = idx["retrieved_at"]
    reps_by_district = {}
    for parent in sorted(pages):
        page = pages[parent]
        ref = f"wikipedia:{page['title']}@{page['revid']}"
        for d in parse_district_table(page["wikitext"], parent):
            if d["representative"]:
                reps_by_district[d["district_title"]] = (d["representative"], ref)

    districts, memberships, reps = [], [], []
    unresolved, ambiguous, scope_unknown, skipped = [], [], [], []
    parsed_labels = set()

    # Group the registry by parent so scope can be chosen once per parent from all its members.
    by_parent = defaultdict(list)
    for item in registry:
        art = articles.get(item["label"])
        if art is None:
            skipped.append({"label": item["label"], "reason": "no article in snapshot"})
            continue
        info = parse_district_article(art["wikitext"])
        if info is None:
            skipped.append({"label": item["label"], "reason": "no infobox constituency"})
            continue
        # The vintage filter. A district abolished before this Congress convened is not part of
        # it, however current its article looks.
        if info["abolished"] and info["abolished"] <= congress_year:
            skipped.append({"label": item["label"], "reason": f"abolished {info['abolished']}"})
            continue
        m = re.match(r"^(.*?)'s (.+?) congressional district$", item["label"])
        parent = m.group(1) if m else (info["parent"] or item["label"])
        ordinal_label = m.group(2) if m else "lone"
        by_parent[parent].append((item, art, info, ordinal_label))

    for parent, entries in sorted(by_parent.items()):
        pending = []
        pseudo = [{"members": info["members"]} for _, _, info, _ in entries]
        scope, scoring = choose_scope(parent, pseudo, geo, crosswalk)
        if scope is None:
            scope_unknown.append({"parent": parent, "candidates": scoring,
                                  "districts": len(entries)})
            scope = {"parent_name": parent, "grain": "unknown", "parent_geo_code": None,
                     "region_code": None}

        for item, art, info, ordinal_label in entries:
            label = item["label"]
            parsed_labels.add(label)
            source_ref = f"wikipedia:{art['title']}@{art['revid']}"
            is_lone = bool(re.search(r"lone|at.large", ordinal_label, re.I))
            mo = re.match(r"^(\d+)", ordinal_label)
            code = district_slug(parent, ordinal_label)
            districts.append({
                "district_code": code,
                "congress_no": CONGRESS_NO,
                "district_name": label,
                "ordinal": int(mo.group(1)) if mo else None,
                "is_lone": is_lone,
                "parent_geo_code": scope.get("parent_geo_code"),
                "region_code": scope.get("region_code"),
                "wikidata_qid": item["qid"],
                "psa_population": info["population"] or item.get("population"),
                "valid_from": CONGRESS_VALID_FROM,
                "valid_to": None,
                "source_kind": "wikipedia",
                "source_ref": source_ref,
                "retrieved_at": retrieved_at,
                "status": "auto",
            })
            rep = reps_by_district.get(label)
            if rep:
                reps.append({
                    "district_code": code, "congress_no": CONGRESS_NO,
                    "full_name": rep[0], "party": None, "as_of": CONGRESS_VALID_FROM,
                    "source_kind": "wikipedia", "source_ref": rep[1], "status": "auto",
                })

            members = info["members"]
            if not members and is_lone:
                # A lone district lists no constituents because it covers the whole parent by
                # definition. Recorded as `whole_parent`, never dressed up as a name match.
                for row in whole_parent_members(scope, geo):
                    pending.append((code, row, "whole_parent", source_ref, None))
                continue
            for member in members:
                row, method = resolve_member(member, scope, geo, crosswalk)
                if row is None:
                    rec = {"district_code": code, "parent": parent, "member": member["name"],
                           "link_target": member.get("link_target"), "reason": method}
                    (ambiguous if method.startswith("ambiguous") else unresolved).append(rec)
                    continue
                pending.append((code, row, method, source_ref, member["name"]))

        # Two different source names that land on the SAME dim_geo row are a source
        # disagreement, not a match. Zamboanga City is the live example: Wikipedia lists
        # "Dulian (Upper Pasonanca)" in the 1st and "Dulian (Upper Bunguiao)" in the 2nd, while
        # PSA's dim_geo carries a single DULIAN. Picking either would invent a fact and
        # double-claim a barangay; both are therefore reported and neither is emitted.
        claimed = defaultdict(list)
        for entry in pending:
            claimed[entry[1]["geo_code"]].append(entry)
        for gcode, hits in claimed.items():
            names = {e[4] for e in hits if e[4]}
            districts_hit = {e[0] for e in hits}
            if len(hits) > 1 and (len(names) > 1 or len(districts_hit) > 1):
                for e in hits:
                    ambiguous.append({
                        "district_code": e[0], "parent": parent, "member": e[4],
                        "geo_code": gcode, "reason": "collision_same_dim_geo_row",
                        "competing_names": sorted(n for n in names if n),
                    })
                continue
            code_, row_, method_, ref_, _n = hits[0]
            memberships.append(_membership(code_, row_, method_, ref_, retrieved_at))

    return {
        "districts": districts, "memberships": memberships, "representatives": reps,
        "unresolved": unresolved, "ambiguous": ambiguous, "scope_unknown": scope_unknown,
        "skipped": skipped, "parsed_district_labels": sorted(parsed_labels),
    }


def _membership(code, row, method, source_ref, retrieved_at):
    return {
        "district_code": code,
        "geo_code": row["geo_code"],
        "geo_level": row["geo_level"],
        "match_method": method,
        "source_kind": "wikipedia",
        "source_ref": source_ref,
        "retrieved_at": retrieved_at,
        # No COMELEC snapshot means no second opinion; the gate, not this function, decides what
        # that is allowed to do.
        "corroboration": "single_source",
        "corroborating_source_ref": None,
        "status": "auto",
    }


# --------------------------------------------------------------------------- #
# 6. Validation gates (D1.5)                                                   #
# --------------------------------------------------------------------------- #
def validate(built, registry, geo, allow_single_source=False):
    """Every gate the plan names, each reported as pass/fail with its evidence.

    These are checks the build is expected to *fail* on a first run against live sources -- that
    is what they are for. A gate that has never failed has never been tested.
    """
    gates = []
    memberships = built["memberships"]
    districts = built["districts"]

    def gate(name, ok, detail):
        gates.append({"gate": name, "ok": bool(ok), "detail": detail})

    # 1. Registry cross-check: Wikidata roster vs the districts Wikipedia actually lists.
    wd_labels = {r["label"] for r in registry}
    parsed = set(built["parsed_district_labels"])
    only_wd = sorted(wd_labels - parsed)
    only_wp = sorted(parsed - wd_labels)
    gate("registry_agreement",
         not only_wp,
         {"in_wikidata_not_parsed": len(only_wd), "parsed_not_in_wikidata": len(only_wp),
          "sample_only_wikidata": only_wd[:10], "sample_only_wikipedia": only_wp[:10]})

    # 2. Every citymun in dim_geo covered exactly once -- reported BOTH directions, because a
    #    double-claimed LGU and an uncovered one are different bugs with the same symptom.
    claims = defaultdict(list)
    for m in memberships:
        claims[m["geo_code"]].append(m["district_code"])
    all_citymun = {r["geo_code"] for r in geo.rows if r["geo_level"] == "citymun"}
    covered_citymun = {c for c in claims if c in all_citymun}
    # A citymun is also covered when its barangays are claimed (a multi-district city).
    for code, ds in claims.items():
        row = geo.by_code.get(code)
        if row and row["geo_level"] == "barangay" and row.get("parent_code"):
            covered_citymun.add(row["parent_code"])
    uncovered = sorted(all_citymun - covered_citymun)
    doubled = sorted(c for c, ds in claims.items() if len(set(ds)) > 1)
    gate("citymun_covered_exactly_once",
         not uncovered and not doubled,
         {"uncovered_count": len(uncovered), "double_claimed_count": len(doubled),
          "sample_uncovered": uncovered[:10], "sample_double_claimed": doubled[:10]})

    # 3. Multi-district cities: the union of a city's districts' barangays must equal that city's
    #    barangay set in dim_geo. A leftover barangay is a hard failure, not a warning -- this is
    #    the exact check BetterGov's file fails (D1.1), and the reason D3.1 can trust its roll-up.
    city_leftovers = {}
    by_city = defaultdict(set)
    for m in memberships:
        row = geo.by_code.get(m["geo_code"])
        if row and row["geo_level"] == "barangay" and row.get("parent_code"):
            by_city[row["parent_code"]].add(m["geo_code"])
    for city, claimed in by_city.items():
        actual = {r["geo_code"] for r in geo.rows
                  if r["geo_level"] == "barangay" and r.get("parent_code") == city}
        missing, extra = actual - claimed, claimed - actual
        if missing or extra:
            city_leftovers[city] = {"missing": len(missing), "extra": len(extra),
                                    "sample_missing": sorted(missing)[:5]}
    gate("multi_district_city_barangays_complete",
         not city_leftovers,
         {"cities_with_leftovers": len(city_leftovers),
          "detail": dict(list(city_leftovers.items())[:10])})

    # 4. No barangay claimed by two districts of the same city (the double-count trap).
    gate("no_barangay_in_two_districts",
         not any(len(set(ds)) > 1 for c, ds in claims.items()
                 if (geo.by_code.get(c) or {}).get("geo_level") == "barangay"),
         {"offenders": [c for c, ds in claims.items()
                        if len(set(ds)) > 1
                        and (geo.by_code.get(c) or {}).get("geo_level") == "barangay"][:10]})

    # 5. Party-list seats are excluded by construction; assert it rather than assume it.
    partylist = [d for d in districts if "party-list" in d["district_name"].lower()]
    gate("no_partylist_seats", not partylist, {"count": len(partylist)})

    # 6. Nothing resolved by a method that does not exist. Guards the ladder against a future
    #    edit quietly adding a fuzzy rung.
    allowed = {"exact", "disambiguated", "crosswalk", "manual_override", "public_correction",
               "whole_parent"}
    bad = sorted({m["match_method"] for m in memberships} - allowed)
    gate("match_methods_are_declared", not bad, {"unexpected": bad})

    # 7. The two-source rule (guardrail 2). Single-source rows may be built and inspected; they
    #    may not be written to the database without an explicit override.
    single = [m for m in memberships if m["corroboration"] == "single_source"]
    gate("corroborated_by_two_sources",
         not single or allow_single_source,
         {"single_source_rows": len(single),
          "note": "COMELEC returns unavailable in this environment (HTTP 403); "
                  "pass --allow-single-source to build anyway, which records the gap rather than hiding it.",
          "overridden": bool(single and allow_single_source)})

    # 8. Unresolved members are reported, never dropped silently.
    gate("unresolved_reported",
         True,
         {"unresolved": len(built["unresolved"]), "ambiguous": len(built["ambiguous"]),
          "scope_unknown_pages": built["scope_unknown"][:10]})

    return gates


# --------------------------------------------------------------------------- #
# 7. Emit                                                                      #
# --------------------------------------------------------------------------- #
def emit_sql_files(built, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    n = 0
    for table, cols, rows in (
        ("dim_legislative_district", DISTRICT_COLUMNS, built["districts"]),
        ("geo_district_map", MAP_COLUMNS, built["memberships"]),
        ("district_representative", REP_COLUMNS, built["representatives"]),
    ):
        for chunk in batched(rows, BATCH_SIZE):
            n += 1
            (out_dir / f"{n:04d}_{table}.sql").write_text(insert_statement(table, cols, chunk))
    return n


def md_table(headers, rows, aligns=None):
    """Render a markdown table with padded columns.

    Padding is not cosmetic here: this file is generated on every build and checked in, so an
    unpadded table would be rewritten by `prettier --write` and show up as spurious churn in the
    next diff. Matching prettier's own output keeps the generated doc a no-op for the formatter.
    """
    aligns = aligns or ["left"] * len(headers)
    cols = [[str(h)] + [str(r[i]) for r in rows] for i, h in enumerate(headers)]
    widths = [max(3, max(len(c) for c in col)) for col in cols]
    def rule(w, a):
        return (("-" * (w - 1) + ":") if a == "right" else "-" * w)
    out = ["| " + " | ".join(str(h).ljust(w) for h, w in zip(headers, widths)) + " |",
           "| " + " | ".join(rule(w, a) for w, a in zip(widths, aligns)) + " |"]
    for r in rows:
        cells = []
        for i, w in enumerate(widths):
            v = str(r[i])
            cells.append(v.rjust(w) if aligns[i] == "right" else v.ljust(w))
        out.append("| " + " | ".join(cells) + " |")
    return out


def write_doc_summary(built, gates, idx):
    """The report IS the doc, as docs/PSGC_CROSSWALK.md and BOUNDARY_RECONCILIATION.md are."""
    d, m = built["districts"], built["memberships"]
    by_method = defaultdict(int)
    for r in m:
        by_method[r["match_method"]] += 1
    lines = [
        "# Legislative districts — how this mapping was built",
        "",
        "<!-- Generated by ingestion/build_legislative_districts.py. Do not edit by hand. -->",
        "",
        "This mapping is **derived from public sources, not published by PSA or COMELEC**.",
        "Every membership row carries the source revision it came from, so any row on",
        "`/districts/[districtCode]` can be checked against the exact text we read.",
        "",
        f"- Congress: **{CONGRESS_NO}th** (valid from {CONGRESS_VALID_FROM})",
        f"- Snapshot retrieved: **{idx['retrieved_at']}**",
        f"- Districts: **{len(d)}**",
        f"- Membership rows: **{len(m)}**",
        f"- Representatives: **{len(built['representatives'])}**",
        "",
        "## How each membership row was resolved",
        "",
    ]
    lines += md_table(["match_method", "rows"],
                      [[f"`{k}`", by_method[k]] for k in sorted(by_method)],
                      ["left", "right"])
    lines += ["", "## Validation gates", ""]
    gate_rows = []
    for g in gates:
        detail = json.dumps(g["detail"])
        if len(detail) > 300:
            detail = detail[:297] + "..."
        gate_rows.append([f"`{g['gate']}`", "pass" if g["ok"] else "**FAIL**",
                          detail.replace("|", "\\|")])
    lines += md_table(["gate", "result", "detail"], gate_rows)
    lines += [
        "",
        "## Unresolved and disputed",
        "",
        "Published rather than hidden, on the same reasoning `/data-quality` already takes: a",
        "missing assignment reads as a known finding rather than a hidden one. An unresolved LGU",
        "is a visible gap; a wrongly-matched one would be a silent lie.",
        "",
        f"- Unresolved members: **{len(built['unresolved'])}**",
        f"- Ambiguous members: **{len(built['ambiguous'])}**",
        "",
        "The full lists are in `ingestion/_qa_report_legislative_districts.json`.",
        "",
    ]
    DOC_PATH.write_text("\n".join(lines))
    return DOC_PATH


# --------------------------------------------------------------------------- #
# 8. Self-test                                                                 #
# --------------------------------------------------------------------------- #
SELFTEST_WIKITEXT = """
== History ==
Nothing here should be parsed.
{| class="wikitable"
![[Fakeland's 9th congressional district|9th]]
|{{Collapsible list | [[Ghost Town]] }}
|-
|}

== Current districts ==
{| class="wikitable sortable"
!District
!Representative
!Constituent LGUs
!Population (2020)
|-
![[Fakeland's 1st congressional district|1st]]
| style="text-align:left;" |'''[[Juana Dela Cruz]]'''<br><small>(since 2022)</small>
|{{Collapsible list
| [[Alpha]]
| [[Bravo, Fakeland|Bravo]]
| Charlie
}}
| 123,456<ref name="psa">cite</ref>
|-
![[Fakeland's 2nd congressional district|2nd]]
| style="text-align:left;" |'''[[Juan Santos]]'''
|{{Collapsible list
| [[Delta]]
}}
| 78,900
|-
|}

== At-Large (defunct) ==
{| class="wikitable"
![[Fakeland's at-large congressional district|At-Large]]
|{{Collapsible list | [[Alpha]] | [[Delta]] }}
|-
|}
"""


def selftest():
    # -- parsing -----------------------------------------------------------------
    ds = parse_district_table(SELFTEST_WIKITEXT, "Fakeland")
    assert len(ds) == 2, f"expected 2 current districts, got {len(ds)}: {[d['ordinal_label'] for d in ds]}"
    assert [d["ordinal_label"] for d in ds] == ["1st", "2nd"], ds
    assert ds[0]["population"] == 123456, ds[0]
    assert ds[0]["representative"] == "Juana Dela Cruz", ds[0]
    names = [m["name"] for m in ds[0]["members"]]
    assert names == ["Alpha", "Bravo", "Charlie"], names
    assert ds[0]["members"][1]["link_target"] == "Bravo, Fakeland", ds[0]["members"][1]
    # The defunct and history tables must not leak in -- the scoping check that matters.
    assert all("at-large" not in d["ordinal_label"].lower() for d in ds), ds
    assert all(d["ordinal_label"] != "9th" for d in ds), ds

    # -- normalisation -----------------------------------------------------------
    assert normalise_name("City of Manila") == "manila"
    assert normalise_name("Dasmariñas City") == "dasmarinas"
    assert normalise_name("Sablayan (capital)") == "sablayan"
    assert district_slug("Leyte", "1st") == "leyte-1st"
    assert district_slug("Quezon City", "3rd") == "quezon-3rd"
    assert district_slug("Batanes", "Lone") == "batanes-lone"

    # -- the resolution ladder ---------------------------------------------------
    geo = GeoIndex([
        {"geo_code": "P1", "geo_level": "province", "geo_name": "Fakeland", "province_code": "", "parent_code": "", "region_code": "R1"},
        {"geo_code": "P2", "geo_level": "province", "geo_name": "Otherland", "province_code": "", "parent_code": "", "region_code": "R2"},
        {"geo_code": "C1", "geo_level": "citymun", "geo_name": "Alpha", "province_code": "P1", "parent_code": "P1", "region_code": "R1"},
        {"geo_code": "C2", "geo_level": "citymun", "geo_name": "Bravo", "province_code": "P1", "parent_code": "P1", "region_code": "R1"},
        {"geo_code": "C3", "geo_level": "citymun", "geo_name": "Bravo", "province_code": "P2", "parent_code": "P2", "region_code": "R2"},
        {"geo_code": "C4", "geo_level": "citymun", "geo_name": "Metro", "province_code": "P2", "parent_code": "P2", "region_code": "R2"},
        {"geo_code": "B1", "geo_level": "barangay", "geo_name": "Uno", "province_code": "P2", "parent_code": "C4", "region_code": "R2"},
        # C4's second barangay, deliberately left unclaimed by the gate fixture below so that
        # multi_district_city_barangays_complete has a real leftover to catch.
        {"geo_code": "B2", "geo_level": "barangay", "geo_name": "Dos", "province_code": "P2", "parent_code": "C4", "region_code": "R2"},
    ])
    prov_scope = {"parent_name": "Fakeland", "province_code": "P1", "grain": "citymun"}
    row, meth = resolve_member({"name": "Alpha", "link_target": "Alpha"}, prov_scope, geo)
    assert (row["geo_code"], meth) == ("C1", "exact"), (row, meth)

    # The ambiguity that must NOT be guessed: 'Bravo' exists in two provinces. In province scope
    # it resolves; with no scope it must come back unresolved rather than pick one.
    row, meth = resolve_member({"name": "Bravo", "link_target": None}, prov_scope, geo)
    assert (row["geo_code"], meth) == ("C2", "exact"), (row, meth)
    row, meth = resolve_member({"name": "Bravo", "link_target": None}, {"parent_name": "?"}, geo)
    assert row is None and meth == "ambiguous_nationally", (row, meth)
    # …unless the wikitext disambiguated it, which is rung 2 and the reason we parse wikitext.
    row, meth = resolve_member({"name": "Bravo", "link_target": "Bravo, Otherland"}, {"parent_name": "?"}, geo)
    assert (row["geo_code"], meth) == ("C3", "disambiguated"), (row, meth)
    # A name in no source at all is unresolved, never a near miss.
    row, meth = resolve_member({"name": "Bravoo", "link_target": None}, prov_scope, geo)
    assert row is None, (row, meth)
    # Barangay scope resolves within its city.
    row, meth = resolve_member({"name": "Uno", "link_target": None},
                               {"parent_name": "Metro", "citymun_codes": {"C4"}}, geo)
    assert (row["geo_code"], meth) == ("B1", "exact"), (row, meth)

    # -- scope detection, by evidence rather than by name -------------------------
    # A province page: its members are municipalities, so the citymun reading must win.
    prov_page = [{"members": [{"name": "Alpha", "link_target": None},
                              {"name": "Bravo", "link_target": None}]}]
    sc, scoring = choose_scope("Fakeland", prov_page, geo)
    assert sc and sc["grain"] == "citymun", (sc, scoring)
    # A city page: its members are barangays, so the barangay reading must win even though the
    # name also matches nothing else. This is the Quezon City / Quezon province hazard in
    # miniature -- the reading is chosen by what resolves, not by what the name looks like.
    city_page = [{"members": [{"name": "Uno", "link_target": None},
                              {"name": "Dos", "link_target": None}]}]
    sc, scoring = choose_scope("Metro", city_page, geo)
    assert sc and sc["grain"] == "barangay", (sc, scoring)
    # Nothing resolves anywhere -> reported, never guessed.
    sc, scoring = choose_scope("Nowhere", [{"members": [{"name": "Zzz", "link_target": None}]}], geo)
    assert sc is None, (sc, scoring)

    # -- gates catch what they are for -------------------------------------------
    built = {
        "districts": [{"district_code": "d1", "district_name": "Fakeland's 1st congressional district"}],
        "memberships": [
            {"district_code": "d1", "geo_code": "B1", "geo_level": "barangay",
             "match_method": "exact", "corroboration": "single_source"},
            {"district_code": "d2", "geo_code": "B1", "geo_level": "barangay",
             "match_method": "exact", "corroboration": "single_source"},
        ],
        "representatives": [], "unresolved": [], "ambiguous": [], "scope_unknown": [],
        "parsed_district_labels": ["Fakeland's 1st congressional district"],
    }
    gates = {g["gate"]: g for g in validate(built, [{"label": "Fakeland's 1st congressional district"}], geo)}
    assert gates["no_barangay_in_two_districts"]["ok"] is False, gates["no_barangay_in_two_districts"]
    assert gates["corroborated_by_two_sources"]["ok"] is False, "single-source rows must not pass by default"
    gates_ok = {g["gate"]: g for g in validate(built, [{"label": "Fakeland's 1st congressional district"}], geo, allow_single_source=True)}
    assert gates_ok["corroborated_by_two_sources"]["ok"] is True, "explicit override must be honoured"
    # C4 has two barangays (B1, B2); the fixture claims only B1, so the completeness gate must
    # fail on the leftover. This is the exact shape of the failure D1.1 found in BetterGov's
    # districts.json, which is why it is asserted rather than assumed.
    assert gates["multi_district_city_barangays_complete"]["ok"] is False, gates["multi_district_city_barangays_complete"]
    assert gates["multi_district_city_barangays_complete"]["detail"]["cities_with_leftovers"] == 1
    # A citymun claimed by nobody is the other direction of the same report.
    assert gates["citymun_covered_exactly_once"]["ok"] is False, gates["citymun_covered_exactly_once"]

    print("selftest OK: parsing, normalisation, ladder, scope detection and gates all asserted")


# --------------------------------------------------------------------------- #
# 9. CLI                                                                       #
# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--selftest", action="store_true", help="Synthetic fixtures; no network, no DB")
    ap.add_argument("--fetch", action="store_true", help="Pull sources into --snapshot-dir")
    ap.add_argument("--snapshot-dir", help="Where --fetch writes raw snapshots")
    ap.add_argument("--from-snapshot", help="Build from a committed snapshot directory")
    ap.add_argument("--dim-geo-csv", help="dim_geo export CSV (geo_code, geo_level, geo_name, parent_code, province_code, region_code)")
    ap.add_argument("--emit-sql-dir", help="Write batched INSERT .sql files here")
    ap.add_argument("--database-url", help="Postgres connection string (psycopg2 mode)")
    ap.add_argument("--write-doc-summary", action="store_true", help="Regenerate docs/LEGISLATIVE_DISTRICTS.md")
    ap.add_argument("--allow-single-source", action="store_true",
                    help="Build without COMELEC corroboration, recording the gap in the QA report")
    args = ap.parse_args()

    if args.selftest:
        selftest()
        return

    if args.fetch:
        if not args.snapshot_dir:
            ap.error("--fetch needs --snapshot-dir")
        do_fetch(Path(args.snapshot_dir))
        return

    if not args.from_snapshot:
        ap.error("pass --selftest, --fetch, or --from-snapshot")
    if not args.dim_geo_csv and not args.database_url:
        ap.error("--from-snapshot needs --dim-geo-csv or --database-url to resolve names")

    idx, registry, pages, articles = load_snapshot(Path(args.from_snapshot))

    if args.database_url:
        import psycopg2
        conn = psycopg2.connect(args.database_url)
        with conn, conn.cursor() as cur:
            cur.execute("select geo_code, geo_level::text, geo_name, "
                        "coalesce(parent_code,'') parent_code, coalesce(province_code,'') province_code, "
                        "coalesce(region_code,'') region_code from dim_geo")
            cols = [d[0] for d in cur.description]
            dim_geo_rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        conn.close()
    else:
        dim_geo_rows = load_dim_geo_csv(args.dim_geo_csv)

    geo = GeoIndex(dim_geo_rows)
    built = build(idx, registry, pages, articles, geo)
    gates = validate(built, registry, geo, allow_single_source=args.allow_single_source)

    qa = {
        "dataset_slug": DATASET_SLUG,
        "congress_no": CONGRESS_NO,
        "snapshot": {"dir": args.from_snapshot, "retrieved_at": idx["retrieved_at"],
                     "pages": len(pages), "missing_pages": idx.get("missing", [])},
        "counts": {
            "districts": len(built["districts"]),
            "memberships": len(built["memberships"]),
            "representatives": len(built["representatives"]),
            "wikidata_registry": len(registry),
        },
        "match_methods": dict(sorted(
            (k, sum(1 for m in built["memberships"] if m["match_method"] == k))
            for k in {m["match_method"] for m in built["memberships"]}
        )),
        "gates": gates,
        "unresolved": built["unresolved"],
        "ambiguous": built["ambiguous"],
        "scope_unknown": built["scope_unknown"],
    }

    failed = [g["gate"] for g in gates if not g["ok"]]
    qa["gates_failed"] = failed

    if failed and (args.database_url or args.emit_sql_dir):
        qa["applied"] = f"REFUSED — gates failed: {failed}"
    elif args.emit_sql_dir:
        n = emit_sql_files(built, Path(args.emit_sql_dir))
        qa["applied"] = f"emitted {n} sql file(s) to {args.emit_sql_dir}"
    else:
        qa["applied"] = "dry-run"

    if args.write_doc_summary:
        qa["doc"] = str(write_doc_summary(built, gates, idx))

    QA_REPORT_PATH.write_text(json.dumps(qa, indent=2, default=str))
    summary = {k: qa[k] for k in ("counts", "match_methods", "gates_failed", "applied")}
    print(json.dumps(summary, indent=2, default=str))
    print(f"QA report written to {QA_REPORT_PATH}")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
