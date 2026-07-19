#!/usr/bin/env python3
"""Boundary sourcing + reconciliation (BUILD_PLAN.md §7, increment 1.6).

Downloads region/province/citymun boundary GeoJSON from the community-maintained
`faeldon/philippines-json-maps` repo (2023 PSGC series, generated from PSA
shapefiles), joins every feature against `dim_geo` on padded PSGC codes, and
writes the matched files into `public/geo/` for the app to serve statically.

Source file naming encodes the PSGC code as a bare integer with trailing
zeros for the levels below it (region/province/citymun/barangay, 10 digits
total) — e.g. region 04 is `400000000` (4 * 10^8), province 04010 is
`401000000` (4010 * 10^5). This is the *same* "leading zeros stripped"
issue BUILD_PLAN.md §3 documents for our own ingested data (0.4), just
showing up again on a different data source: zero-pad to 10 digits, then
take the first 2/5/7 characters for the region/province/citymun code.

Two-way reconciliation: for every region/province in `dim_geo`, note if the
source has no matching file (or the file has no matching feature); for every
feature in a downloaded file, note if it doesn't match any `dim_geo` code.
Per §4.3, geos with no boundary aren't dropped — the frontend renders them
hatched/grey rather than making them disappear; this script's report is what
that "no boundary" set is derived from.

Requires NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (.env or
.env.local in the repo root, or already exported).
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_BASE = "https://raw.githubusercontent.com/faeldon/philippines-json-maps/master/2023/geojson"
OUT_DIR = REPO_ROOT / "public" / "geo"
REPORT_PATH = REPO_ROOT / "docs" / "BOUNDARY_RECONCILIATION.md"

# The source predates the Negros Island Region (2023 PSGC still files these
# three provinces under their pre-NIR regions: Negros Occidental under
# Region VI, Negros Oriental + Siquijor under Region VII). dim_geo (like
# current PSGC) files them under region 18. Rather than accept them as
# "missing", remap: same province, just fetched from its old region/code.
NIR_PROVINCE_CROSSWALK = {
    "18045": ("06", "06045"),  # Negros Occidental
    "18046": ("07", "07046"),  # Negros Oriental
    "18061": ("07", "07061"),  # Siquijor
}


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
    except urllib.error.URLError as e:
        return None, None


def supabase_get(rest_base, api_key, path):
    req = urllib.request.Request(
        f"{rest_base}/{path}",
        headers={"apikey": api_key, "Authorization": f"Bearer {api_key}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def psgc10(n):
    return str(n).zfill(10)


def region_suffix(region_code):
    return str(int(region_code) * 10**8)


def province_suffix(province_code):
    return str(int(province_code) * 10**5)


def main():
    env = load_env()
    base_url = env.get("NEXT_PUBLIC_SUPABASE_URL")
    anon_key = env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not base_url or not anon_key:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY", file=sys.stderr)
        sys.exit(2)
    rest = f"{base_url.rstrip('/')}/rest/v1"

    regions = supabase_get(rest, anon_key, "dim_geo?geo_level=eq.region&select=geo_code,geo_name&order=geo_code")
    provinces = supabase_get(rest, anon_key, "dim_geo?geo_level=eq.province&select=geo_code,geo_name,region_code&order=geo_code")
    citymuns = supabase_get(rest, anon_key, "dim_geo?geo_level=eq.citymun&select=geo_code,geo_name,province_code&order=geo_code")

    region_codes = {r["geo_code"] for r in regions}
    province_codes = {p["geo_code"] for p in provinces}
    citymun_codes = {c["geo_code"] for c in citymuns}
    provinces_by_region = {}
    for p in provinces:
        provinces_by_region.setdefault(p["region_code"], []).append(p)
    citymuns_by_province = {}
    for c in citymuns:
        citymuns_by_province.setdefault(c["province_code"], []).append(c)

    (OUT_DIR / "provinces").mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "citymun").mkdir(parents=True, exist_ok=True)

    report = {
        "regions_missing_from_source": [],
        "source_region_features_unmatched": [],
        "provinces_missing_from_source": [],
        "source_province_features_unmatched": [],
        "citymuns_missing_from_source": [],
        "source_citymun_features_unmatched": [],
    }

    # --- National regions file ---
    status, data = fetch_json(f"{SOURCE_BASE}/country/lowres/country.0.001.json")
    matched_region_codes = set()
    if data:
        for feature in data["features"]:
            code = psgc10(feature["properties"]["adm1_psgc"])[:2]
            feature["properties"]["geo_code"] = code
            matched_region_codes.add(code)
            if code not in region_codes:
                report["source_region_features_unmatched"].append(
                    {"geo_code": code, "name": feature["properties"].get("adm1_en")}
                )
        (OUT_DIR / "regions.json").write_text(json.dumps(data))
        print(f"[regions] wrote {len(data['features'])} features -> public/geo/regions.json")
    else:
        print(f"[regions] FAILED to fetch national file (status={status})", file=sys.stderr)

    for code in sorted(region_codes - matched_region_codes):
        name = next((r["geo_name"] for r in regions if r["geo_code"] == code), code)
        report["regions_missing_from_source"].append({"geo_code": code, "name": name})

    # --- Per-region province files ---
    nir_features = []
    for region_code in sorted(region_codes):
        if region_code == "18":
            # No source file for region 18 at all (pre-NIR vintage) — handled
            # entirely via NIR_PROVINCE_CROSSWALK below instead of a direct fetch.
            continue

        url = f"{SOURCE_BASE}/regions/lowres/provdists-region-{region_suffix(region_code)}.0.001.json"
        status, data = fetch_json(url)
        expected = {p["geo_code"] for p in provinces_by_region.get(region_code, [])}
        if not data:
            for p in provinces_by_region.get(region_code, []):
                report["provinces_missing_from_source"].append(p)
            print(f"[provinces/{region_code}] not found in source (status={status}); {len(expected)} provinces unmatched")
            continue

        matched = set()
        for feature in data["features"]:
            code = psgc10(feature["properties"]["adm2_psgc"])[:5]
            feature["properties"]["geo_code"] = code
            matched.add(code)
            if code not in province_codes:
                report["source_province_features_unmatched"].append(
                    {"geo_code": code, "name": feature["properties"].get("adm2_en"), "region_code": region_code}
                )
            # Carve out the pre-NIR features so they don't linger under their old region.
            for new_code, (old_region, old_code) in NIR_PROVINCE_CROSSWALK.items():
                if region_code == old_region and code == old_code:
                    feature["properties"]["geo_code"] = new_code
                    nir_features.append(feature)
        for code in sorted(expected - matched):
            p = next(p for p in provinces_by_region[region_code] if p["geo_code"] == code)
            report["provinces_missing_from_source"].append(p)

        data["features"] = [
            f for f in data["features"] if f["properties"]["geo_code"] not in NIR_PROVINCE_CROSSWALK
        ]
        (OUT_DIR / "provinces" / f"{region_code}.json").write_text(json.dumps(data))
        print(f"[provinces/{region_code}] wrote {len(data['features'])} features")

    if nir_features:
        (OUT_DIR / "provinces" / "18.json").write_text(json.dumps({"type": "FeatureCollection", "features": nir_features}))
        print(f"[provinces/18] wrote {len(nir_features)} features (crosswalked from pre-NIR regions)")
    for new_code in NIR_PROVINCE_CROSSWALK:
        if new_code not in {f["properties"]["geo_code"] for f in nir_features}:
            p = next(p for p in provinces_by_region.get("18", []) if p["geo_code"] == new_code)
            report["provinces_missing_from_source"].append(p)

    # --- Per-province citymun files ---
    for province_code in sorted(province_codes):
        if province_code in NIR_PROVINCE_CROSSWALK:
            old_region, old_code = NIR_PROVINCE_CROSSWALK[province_code]
            url = f"{SOURCE_BASE}/provdists/lowres/municities-provdist-{province_suffix(old_code)}.0.001.json"
        else:
            url = f"{SOURCE_BASE}/provdists/lowres/municities-provdist-{province_suffix(province_code)}.0.001.json"
        status, data = fetch_json(url)
        expected = {c["geo_code"] for c in citymuns_by_province.get(province_code, [])}
        if not data:
            for c in citymuns_by_province.get(province_code, []):
                report["citymuns_missing_from_source"].append(c)
            continue

        matched = set()
        for feature in data["features"]:
            code = psgc10(feature["properties"]["adm3_psgc"])[:7]
            if province_code in NIR_PROVINCE_CROSSWALK:
                code = province_code + code[5:]  # remap the pre-NIR province prefix to the NIR one
            feature["properties"]["geo_code"] = code
            matched.add(code)
            if code not in citymun_codes:
                report["source_citymun_features_unmatched"].append(
                    {"geo_code": code, "name": feature["properties"].get("adm3_en"), "province_code": province_code}
                )
        for code in sorted(expected - matched):
            c = next(c for c in citymuns_by_province[province_code] if c["geo_code"] == code)
            report["citymuns_missing_from_source"].append(c)

        (OUT_DIR / "citymun" / f"{province_code}.json").write_text(json.dumps(data))

    print(f"[citymun] wrote files for {len(province_codes)} provinces (see report for gaps)")

    report_md = [
        "# Boundary reconciliation report",
        "",
        f"Source: `faeldon/philippines-json-maps`, 2023 PSGC series (`{SOURCE_BASE}`).",
        "Generated by `ingestion/reconcile_boundaries.py` — re-run it to refresh this report.",
        "",
        "## Summary",
        "",
        f"- Regions in `dim_geo`: {len(region_codes)}; missing from source: {len(report['regions_missing_from_source'])}",
        f"- Provinces in `dim_geo`: {len(province_codes)}; missing from source: {len(report['provinces_missing_from_source'])}",
        f"- Citymuns in `dim_geo`: {len(citymun_codes)}; missing from source: {len(report['citymuns_missing_from_source'])}",
        "",
        "All gaps below are **accepted, not fixed** (beyond the NIR crosswalk described next) — the app renders "
        "these geos hatched/grey with no polygon and always shows the ranked-list fallback alongside the map "
        "(BUILD_PLAN.md §4.3), so no figure or export ever silently drops a geo for lack of a boundary.",
        "",
        "## Crosswalk applied: Negros Island Region (NIR)",
        "",
        "The source predates NIR's 2015/2023 re-affirmation as region 18 and still files Negros Occidental under "
        "Region VI and Negros Oriental + Siquijor under Region VII (old codes `06045`/`07046`/`07061`). Since these "
        "are the *same provinces* dim_geo just files under region 18, this script remaps them (and their citymun "
        "children) to the `18045`/`18046`/`18061` codes rather than accepting them as missing — see "
        "`NIR_PROVINCE_CROSSWALK` in the script. This is the only crosswalk applied; everything below is a genuine "
        "gap between the two datasets.",
        "",
        "## Why the remaining gaps exist",
        "",
        "- **Highly Urbanized Cities (HUCs)** (e.g. City of Angeles, City of Cebu, all of Metro Manila's cities): "
        "dim_geo models each HUC as both a province-level row (it's independent of any province) and a citymun-level "
        "row. The source shapefiles don't carry a separate polygon for the HUC-as-province — the city's own "
        "boundary is the only one that would exist, and it isn't present in the province's citymun file either "
        "(HUCs are consistently absent there, including Negros Occidental's Bacolod City after the NIR crosswalk "
        "above). Fixing this would mean sourcing a second shapefile layer per HUC; out of scope for Phase 1.",
        "- **NCR provinces**: dim_geo models NCR's provinces as its 17 individual cities/municipalities; the source "
        "instead has 4 legislative-district polygons for NCR (`13039`/`13074`/`13075`/`13076`). These are two "
        "different ways of subdividing the same region and don't crosswalk 1:1 city-by-city.",
        "- **Isabela City, Basilan**: administratively part of BARMM (region 19) but geographically drawn under "
        "Zamboanga Peninsula (region 09) in most shapefiles, including this one — a known, widely-documented PSGC "
        "quirk, not an error in either dataset.",
        "- **A handful of individual citymuns** (8 total, e.g. some Quezon and Zamboanga Sibugay municipalities, "
        "two Cavite municipalities): likely PSGC vintage drift — municipalities created/renumbered between the "
        "source's shapefile snapshot and dim_geo's ingestion. Accepted per-geo rather than guessed at.",
        "",
        "## Regions with no source boundary (render hatched/grey; ranked-list fallback covers them)",
        "",
    ]
    for r in report["regions_missing_from_source"]:
        report_md.append(f"- `{r['geo_code']}` — {r['name']}")
    report_md += ["", "## Provinces with no source boundary", ""]
    for p in report["provinces_missing_from_source"]:
        report_md.append(f"- `{p['geo_code']}` — {p['geo_name']} (region {p['region_code']})")
    report_md += ["", "## Citymuns with no source boundary", ""]
    for c in report["citymuns_missing_from_source"]:
        report_md.append(f"- `{c['geo_code']}` — {c['geo_name']} (province {c['province_code']})")
    report_md += ["", "## Source features that don't match any dim_geo code (both directions)", ""]
    for kind in ("source_region_features_unmatched", "source_province_features_unmatched", "source_citymun_features_unmatched"):
        for f in report[kind]:
            report_md.append(f"- [{kind}] `{f['geo_code']}` — {f.get('name')}")

    REPORT_PATH.write_text("\n".join(report_md) + "\n")
    (REPO_ROOT / "ingestion" / "boundary_reconciliation.json").write_text(json.dumps(report, indent=2))
    print(f"\nReport written to {REPORT_PATH} and ingestion/boundary_reconciliation.json")


if __name__ == "__main__":
    main()
