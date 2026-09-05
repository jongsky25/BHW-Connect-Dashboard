#!/usr/bin/env python3
"""District boundary derivation (docs/LEGISLATIVE_DISTRICTS_PLAN.md §6, D3.2).

Derives a polygon per legislative district by dissolving the citymun polygons
`ingestion/reconcile_boundaries.py` already reconciled (`public/geo/citymun/`),
using `geo_district_map`'s live membership rows to know which citymuns make up
each district. This is only possible where a district's members are resolved
at citymun grain *and* every one of those citymuns already has a source
polygon -- a multi-district city (resolved at barangay grain, per
docs/LEGISLATIVE_DISTRICTS_PLAN.md §6 D3.1's "leaf grain" rule) has no
barangay polygons in the source at all, so it is left without a derived
polygon on purpose. The frontend's existing "no boundary" convention
(hatched/grey + the ranked-list fallback, docs/BOUNDARY_RECONCILIATION.md)
covers it unchanged; nothing here needs to guess a shape.

NCR is the one region where even the citymun grain has no source polygon
(docs/BOUNDARY_RECONCILIATION.md: all 17 NCR "provinces" -- i.e. its
HUC-as-province rows -- are missing, because the source models the region as
4 old PSA-style administrative groupings instead of by city). Those 4
grouping polygons are NOT the current 32 congressional districts (verified:
e.g. the "Second District (Not a Province)" polygon is a single dissolved
shape spanning Mandaluyong + Marikina + Pasig + Quezon City + San Juan, which
is five whole cities, not one of today's district rows) and are never used as
a stand-in for one -- that would be exactly the guessed match
docs/LEGISLATIVE_DISTRICTS_PLAN.md §7 guardrail 1 rules out. What each
grouping file *does* carry is one polygon per constituent city, fetched via
`municities-provdist-<code>`, which is the citymun-grain source NCR is
otherwise missing entirely. Those per-city features are pulled out and
name-matched (exact, case-insensitive -- the same standing as D1.4's `exact`
tier) against `dim_geo`'s NCR citymun rows, which lets NCR's whole-city,
single-seat districts (Malabon, Mandaluyong, Navotas, San Juan) resolve like
any other citymun-grain district. Manila's own district split (its 3rd-6th)
stays unresolved: Manila's members are its ten PSGC-modelled sub-city rows
(Tondo, Quiapo, ...), which the source has no polygon for at any grain.

Requires NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (.env or
.env.local in the repo root, or already exported) and network access for the
four NCR grouping files (the rest is read from the already-committed
`public/geo/citymun/*.json`).
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_BASE = "https://raw.githubusercontent.com/faeldon/philippines-json-maps/master/2023/geojson"
CITYMUN_DIR = REPO_ROOT / "public" / "geo" / "citymun"
OUT_PATH = REPO_ROOT / "public" / "geo" / "districts.json"
REPORT_PATH = REPO_ROOT / "docs" / "DISTRICT_BOUNDARY_RECONCILIATION.md"
JSON_REPORT_PATH = REPO_ROOT / "ingestion" / "district_boundary_reconciliation.json"

# The source's 4 old NCR administrative groupings (see module docstring). Each
# is fetched at citymun grain via its own "provdist" code -- the one place the
# source carries a per-city polygon for NCR at all -- purely to recover
# individual city shapes, never used as a district polygon themselves.
NCR_GROUPING_PROVDIST_CODES = ["13039", "13074", "13075", "13076"]


def load_env():
    env = dict(os.environ)
    for name in (".env", ".env.local"):
        env_file = REPO_ROOT / name
        if not env_file.exists():
            continue
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            env.setdefault(key.strip(), value.strip())
    return env


def fetch_json(url):
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, None
    except urllib.error.URLError:
        return None, None


PAGE_SIZE = 1000


def supabase_get(rest_base, api_key, path):
    """Paginates past the platform's hard 1,000-row-per-request cap (BUILD_PLAN.md
    pitfall P9), same as reconcile_boundaries.py's helper of the same name."""
    separator = "&" if "?" in path else "?"
    results = []
    offset = 0
    while True:
        req = urllib.request.Request(
            f"{rest_base}/{path}{separator}limit={PAGE_SIZE}&offset={offset}",
            headers={"apikey": api_key, "Authorization": f"Bearer {api_key}"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            page = json.loads(resp.read())
        results.extend(page)
        if len(page) < PAGE_SIZE:
            return results
        offset += PAGE_SIZE


def province_suffix(province_code):
    return str(int(province_code) * 10**5)


def load_citymun_geoms():
    """geo_code -> shapely geometry, from every already-reconciled per-province
    citymun file. Missing files (the HUC / vintage-drift gaps
    docs/BOUNDARY_RECONCILIATION.md already documents, plus every NCR
    province) simply contribute nothing -- covered by `load_ncr_city_geoms`
    for NCR, accepted as a gap everywhere else, same as the citymun choropleth
    already accepts it."""
    geoms = {}
    if not CITYMUN_DIR.exists():
        return geoms
    for path in sorted(CITYMUN_DIR.glob("*.json")):
        data = json.loads(path.read_text())
        for feature in data["features"]:
            if not feature.get("geometry"):
                continue
            code = feature["properties"].get("geo_code")
            if not code:
                continue
            g = shape(feature["geometry"])
            if not g.is_valid:
                g = g.buffer(0)
            geoms[code] = g
    return geoms


def load_ncr_city_geoms(ncr_citymuns):
    """Fetches the 4 NCR grouping files, pulls out their per-city features, and
    name-matches each (exact, case-insensitive) against `dim_geo`'s NCR
    citymun rows. Returns (geo_code -> geometry, list of unmatched source
    names) -- the latter is expected to contain exactly "City of Manila",
    since Manila has no single whole-city citymun row (its own PSGC children
    are its ten sub-city districts instead, see module docstring)."""
    name_to_geo_code = {c["geo_name"].strip().upper(): c["geo_code"] for c in ncr_citymuns}
    geoms = {}
    unmatched = []
    for provdist_code in NCR_GROUPING_PROVDIST_CODES:
        url = f"{SOURCE_BASE}/provdists/lowres/municities-provdist-{province_suffix(provdist_code)}.0.001.json"
        status, data = fetch_json(url)
        if not data:
            print(f"[ncr] grouping {provdist_code} not found in source (status={status})", file=sys.stderr)
            continue
        for feature in data["features"]:
            if not feature.get("geometry"):
                continue
            name = (feature["properties"].get("adm3_en") or "").strip()
            code = name_to_geo_code.get(name.upper())
            if not code:
                unmatched.append(name)
                continue
            g = shape(feature["geometry"])
            if not g.is_valid:
                g = g.buffer(0)
            geoms[code] = g
    return geoms, unmatched


def main():
    env = load_env()
    base_url = env.get("NEXT_PUBLIC_SUPABASE_URL")
    anon_key = env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not base_url or not anon_key:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY", file=sys.stderr)
        sys.exit(2)
    rest = f"{base_url.rstrip('/')}/rest/v1"

    districts = supabase_get(
        rest, anon_key,
        "dim_legislative_district?select=district_code,district_name,congress_no,region_code&order=district_code",
    )
    members = supabase_get(
        rest, anon_key,
        "geo_district_map?superseded_by=is.null&status=neq.rejected"
        "&select=district_code,geo_code,geo_level&order=district_code",
    )
    regions = supabase_get(rest, anon_key, "dim_geo?geo_level=eq.region&select=geo_code,geo_name")
    ncr_citymuns = supabase_get(
        rest, anon_key,
        "dim_geo?geo_level=eq.citymun&province_code=like.138*&select=geo_code,geo_name,province_code",
    )

    region_name_by_code = {r["geo_code"]: r["geo_name"] for r in regions}

    members_by_district = {}
    for m in members:
        members_by_district.setdefault(m["district_code"], []).append(m)

    citymun_geoms = load_citymun_geoms()
    ncr_geoms, ncr_unmatched = load_ncr_city_geoms(ncr_citymuns)
    print(f"[ncr] matched {len(ncr_geoms)} city polygon(s) from the 4 grouping files; unmatched: {ncr_unmatched}")
    # NCR's citymun grain is otherwise entirely absent from the per-province
    # files, so there's nothing to collide with -- just add them in.
    citymun_geoms.update(ncr_geoms)

    features = []
    outcomes = {"resolved": [], "no_members": [], "barangay_grain": [], "missing_citymun_source": []}

    for d in districts:
        code = d["district_code"]
        rows = members_by_district.get(code, [])
        if not rows:
            outcomes["no_members"].append(d)
            continue
        if any(r["geo_level"] == "barangay" for r in rows):
            outcomes["barangay_grain"].append({**d, "n_members": len(rows)})
            continue

        member_codes = [r["geo_code"] for r in rows]
        missing = [c for c in member_codes if c not in citymun_geoms]
        if missing:
            outcomes["missing_citymun_source"].append({**d, "missing_geo_codes": missing})
            continue

        geoms = [citymun_geoms[c] for c in member_codes]
        dissolved = unary_union(geoms) if len(geoms) > 1 else geoms[0]
        features.append({
            "type": "Feature",
            "properties": {
                "geo_code": code,
                "district_name": d["district_name"],
                "congress_no": d["congress_no"],
                "region_code": d["region_code"],
            },
            "geometry": mapping(dissolved),
        })
        outcomes["resolved"].append(d)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    print(f"[districts] wrote {len(features)} polygon(s) -> {OUT_PATH.relative_to(REPO_ROOT)}")

    # --- Report ---
    total = len(districts)
    report_md = [
        "# District boundary reconciliation report",
        "",
        "Source: dissolved from `public/geo/citymun/*.json` (itself sourced from "
        "`faeldon/philippines-json-maps`, see `docs/BOUNDARY_RECONCILIATION.md`), using "
        "`geo_district_map`'s live membership rows to know which citymuns make up each district "
        "(docs/LEGISLATIVE_DISTRICTS_PLAN.md §6 D3.2).",
        "Generated by `ingestion/build_district_boundaries.py` — re-run it to refresh this report.",
        "",
        "## Summary",
        "",
        f"- Districts: {total}",
        f"- With a derived polygon: {len(outcomes['resolved'])}",
        f"- No polygon — resolved at barangay grain (multi-district city; no barangay polygons in "
        f"the source, D3.1's leaf-grain rule): {len(outcomes['barangay_grain'])}",
        f"- No polygon — a member citymun has no source boundary (docs/BOUNDARY_RECONCILIATION.md's "
        f"accepted citymun gaps, e.g. HUCs and NCR): {len(outcomes['missing_citymun_source'])}",
        f"- No polygon — no live members: {len(outcomes['no_members'])}",
        "",
        "All of the above are **accepted, not fixed** — same posture as "
        "`docs/BOUNDARY_RECONCILIATION.md`: a district with no polygon renders hatched/grey and the "
        "ranked-list fallback (BUILD_PLAN.md §4.3) covers it, so no figure or export ever silently "
        "drops a district for lack of a boundary.",
        "",
        "## NCR",
        "",
        "NCR has no citymun-grain source polygon at all in the per-province files "
        "(`docs/BOUNDARY_RECONCILIATION.md`: all 17 of its HUC-as-province rows are missing) — the "
        "source instead files the region as 4 old PSA-style administrative groupings, each spanning "
        "several of today's cities (verified against the source: e.g. its \"Second District\" polygon "
        "is one dissolved shape covering Mandaluyong + Marikina + Pasig + Quezon City + San Juan). "
        "Those 4 polygons are **not** used as district polygons — none of today's 32 NCR congressional "
        "districts corresponds to one of them, and guessing that correspondence is exactly what "
        "docs/LEGISLATIVE_DISTRICTS_PLAN.md §7 guardrail 1 rules out.",
        "",
        "What the 4 grouping files *do* carry, fetched at their own citymun grain "
        "(`municities-provdist-<code>`), is one polygon per constituent city — the citymun source NCR "
        "is otherwise missing entirely. Those are pulled out and exact-matched (case-insensitive) "
        "against `dim_geo`'s NCR citymun rows, which is how NCR's whole-city, single-seat districts "
        f"below got a polygon: {len(ncr_geoms)} of NCR's 16 non-Manila cities matched this way. "
        f"Unmatched source names: {ncr_unmatched or '(none)'} — \"City of Manila\" is expected here, "
        "since Manila has no single whole-city `dim_geo` citymun row (its own PSGC children are its "
        "ten sub-city districts instead, e.g. Tondo, Quiapo — none of which has a source polygon at "
        "any grain, so Manila's own district split stays unresolved).",
        "",
        "## Districts with no derived polygon",
        "",
        "| district_code | district_name | region | reason |",
        "| --- | --- | --- | --- |",
    ]

    def region_label(code):
        return region_name_by_code.get(code, code) if code else "(spans provinces)"

    for d in outcomes["barangay_grain"]:
        report_md.append(
            f"| `{d['district_code']}` | {d['district_name']} | {region_label(d['region_code'])} | "
            f"barangay grain ({d['n_members']} member barangay(s)) |"
        )
    for d in outcomes["missing_citymun_source"]:
        codes = ", ".join(f"`{c}`" for c in d["missing_geo_codes"][:5])
        more = f" (+{len(d['missing_geo_codes']) - 5} more)" if len(d["missing_geo_codes"]) > 5 else ""
        report_md.append(
            f"| `{d['district_code']}` | {d['district_name']} | {region_label(d['region_code'])} | "
            f"missing citymun source: {codes}{more} |"
        )
    for d in outcomes["no_members"]:
        report_md.append(
            f"| `{d['district_code']}` | {d['district_name']} | {region_label(d['region_code'])} | "
            f"no live members |"
        )

    REPORT_PATH.write_text("\n".join(report_md) + "\n")

    json_report = {
        "resolved": [d["district_code"] for d in outcomes["resolved"]],
        "barangay_grain": [d["district_code"] for d in outcomes["barangay_grain"]],
        "missing_citymun_source": [
            {"district_code": d["district_code"], "missing_geo_codes": d["missing_geo_codes"]}
            for d in outcomes["missing_citymun_source"]
        ],
        "no_members": [d["district_code"] for d in outcomes["no_members"]],
        "ncr_city_matches": len(ncr_geoms),
        "ncr_unmatched_source_names": ncr_unmatched,
    }
    JSON_REPORT_PATH.write_text(json.dumps(json_report, indent=2))
    print(f"\nReport written to {REPORT_PATH} and {JSON_REPORT_PATH}")


if __name__ == "__main__":
    main()
