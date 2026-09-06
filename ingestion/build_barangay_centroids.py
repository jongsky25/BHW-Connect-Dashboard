#!/usr/bin/env python3
"""Barangay centroid sourcing + reconciliation (NHFR_2026_PLAN.md increment N7).

The NHFR export carries **no lat/long** — only PSGC codes. The facility point map therefore
cannot plot a facility where it stands; the most it can honestly plot is the *barangay* the
facility is registered in. This script produces the one thing that placement needs: a point per
barangay in `dim_geo`.

Same source and the same two-way reconciliation discipline as
`ingestion/reconcile_boundaries.py` (BUILD_PLAN.md §4.3, increment 1.6) — the
community-maintained `faeldon/philippines-json-maps` repo, 2023 PSGC series, generated from PSA
shapefiles. This adds the level that script stopped short of: level 4, barangays and
sub-municipalities, one source file per city/municipality:

    municities/hires/bgysubmuns-municity-<citymun PSGC * 10^3>.0.1.json

**`hires`, not `lowres`.** The lower-resolution builds are mapshaper-simplified to 1% / 0.1% of
their vertices, and at that setting small barangays collapse to a *null geometry* rather than a
coarse one — Adams, Ilocos Norte is null in both `lowres` and `medres` and only survives in
`hires`. A dropped geometry is a barangay silently missing from the map, which is exactly the
failure mode §4.3 exists to prevent, so this pays the download for the resolution that keeps
every polygon. (Nothing but a point is kept afterwards, so the fidelity costs the app nothing.)

**A representative point, not a mean of coordinates.** `shapely.representative_point()` is
guaranteed to land *inside* the polygon; an area centroid is not — for a crescent-shaped or
multi-island barangay it can fall in the sea or inside a neighbour. For a MultiPolygon the point
is taken from the largest part, so an island barangay's dot sits on its main landmass rather than
on an outlying islet.

**Output is not GeoJSON.** These files are read by the server (`lib/geo/barangay-centroids.ts`),
never fetched by the browser, so they carry no Feature/geometry envelope — just
`{"<barangay geo_code>": [lon, lat]}` per province, which is ~1.5 MB across all 83 provinces
where the GeoJSON envelope would have been ~6 MB for the same information.

Only codes that match `dim_geo` are written. Everything unmatched, in either direction, goes to
the report rather than being quietly dropped or quietly invented — a barangay with no centroid
renders as an explicit "not placed" count on the page, never as an absent dot.

Requires NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (.env or .env.local in the repo
root, or already exported).
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from shapely.geometry import shape

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_BASE = "https://raw.githubusercontent.com/faeldon/philippines-json-maps/master/2023/geojson"
OUT_DIR = REPO_ROOT / "public" / "geo" / "barangay-centroids"
REPORT_PATH = REPO_ROOT / "docs" / "BARANGAY_CENTROID_RECONCILIATION.md"
JSON_REPORT_PATH = REPO_ROOT / "ingestion" / "barangay_centroid_reconciliation.json"

# The same pre-NIR filing `reconcile_boundaries.py` crosswalks one level up: the 2023 source still
# files Negros Occidental under Region VI and Negros Oriental + Siquijor under Region VII, while
# dim_geo (like current PSGC) files all three under region 18. These are the *same* provinces, so
# their city/municipalities are fetched under the old code and every code the file returns is
# mapped back — without this, all 2,001 barangays of the three provinces come back 404 and land in
# the report as "missing from source", which they are not.
NIR_PROVINCE_CROSSWALK = {
    "18045": "06045",  # Negros Occidental
    "18046": "07046",  # Negros Oriental
    "18061": "07061",  # Siquijor
    # Bacolod, a highly urbanized city, is province-level in dim_geo and moved with the rest of
    # Negros Occidental. `reconcile_boundaries.py` has no entry for it because it has no *province*
    # polygon in the source to crosswalk; its barangays do exist, under the pre-NIR `06302`.
    "18302": "06302",  # City of Bacolod (HUC)
}
SOURCE_TO_DIM_PROVINCE = {old: new for new, old in NIR_PROVINCE_CROSSWALK.items()}

PAGE_SIZE = 1000
# Concurrent source fetches. 1,655 city/municipality files at ~75 KB each is ~125 MB of
# downloads; serially that is most of an hour. Kept modest so the run stays a well-behaved
# consumer of a free community mirror.
WORKERS = 12
# ~1.1 m at the equator. A barangay centroid is not a survey coordinate and does not deserve
# float64 in the committed file.
COORD_PRECISION = 5


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


def supabase_get(rest_base, api_key, path):
    """Paginates past the platform's hard 1,000-row-per-request cap (BUILD_PLAN.md pitfall P9).
    dim_geo's 41,991 barangays need 42 pages; a single request would come back silently short."""
    separator = "&" if "?" in path else "?"
    results = []
    offset = 0
    while True:
        req = urllib.request.Request(
            f"{rest_base}/{path}{separator}limit={PAGE_SIZE}&offset={offset}",
            headers={"apikey": api_key, "Authorization": f"Bearer {api_key}"},
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            page = json.loads(resp.read())
        results.extend(page)
        if len(page) < PAGE_SIZE:
            return results
        offset += PAGE_SIZE


def source_citymun_code(citymun_code):
    """The code the *source* files this city/municipality under (see NIR_PROVINCE_CROSSWALK)."""
    old_province = NIR_PROVINCE_CROSSWALK.get(citymun_code[:5])
    return old_province + citymun_code[5:] if old_province else citymun_code


def dim_geo_barangay_code(source_code):
    """A source barangay code, restated under the province code `dim_geo` uses."""
    new_province = SOURCE_TO_DIM_PROVINCE.get(source_code[:5])
    return new_province + source_code[5:] if new_province else source_code


def citymun_suffix(citymun_code):
    return str(int(citymun_code) * 10**3)


def fetch_json(url, attempts=4):
    """Retries transport failures, never a 404.

    Without the retry a single dropped connection among 1,655 fetches is indistinguishable from
    "the source has no file for this city/municipality" — it would quietly cost that area its whole
    map and land in the report as a permanent gap. A 404 is an answer and is returned immediately;
    a timeout or reset is not, and gets 2s/4s/8s before the run gives up on it and records
    `HTTP None`, which is the report's marker for "never actually answered".
    """
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=60) as resp:
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as e:
            return e.code, None
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError, OSError):
            if attempt == attempts - 1:
                return None, None
            time.sleep(2 ** (attempt + 1))
    return None, None


def representative_point(geometry):
    """A point guaranteed to sit inside `geometry`, taken from its largest part.

    Returns None for a null or degenerate geometry rather than guessing — the caller records it
    as an unplaced barangay.
    """
    if not geometry:
        return None
    try:
        geom = shape(geometry)
    except (ValueError, TypeError, AttributeError):
        return None
    if geom.is_empty:
        return None
    if geom.geom_type == "MultiPolygon":
        geom = max(geom.geoms, key=lambda part: part.area)
    try:
        point = geom.representative_point()
    except Exception:  # noqa: BLE001 — an unrepresentable shape is a report line, not a crash.
        return None
    return [round(point.x, COORD_PRECISION), round(point.y, COORD_PRECISION)]


def fetch_citymun(citymun_code):
    """(citymun_code, status, [(barangay_code, [lon, lat] | None), ...]).

    Every feature is returned, placed or not, so the caller can tell "the source has no polygon
    for this barangay" apart from "the source has never heard of this barangay".
    """
    suffix = citymun_suffix(source_citymun_code(citymun_code))
    url = f"{SOURCE_BASE}/municities/hires/bgysubmuns-municity-{suffix}.0.1.json"
    status, data = fetch_json(url)
    # Manila's 14 sub-municipalities are the known shape of this: the per-submunicipality URLs
    # 404, and the parent (1380600) answers 200 with an empty GeometryCollection carrying no
    # `features` key at all. Both are gaps, not crashes.
    features = (data or {}).get("features") or []
    out = []
    for feature in features:
        psgc = feature.get("properties", {}).get("adm4_psgc")
        if psgc is None:
            continue
        out.append(
            (
                dim_geo_barangay_code(str(psgc).zfill(10)),
                representative_point(feature.get("geometry")),
            )
        )
    return citymun_code, status, out


def main():
    env = load_env()
    base_url = env.get("NEXT_PUBLIC_SUPABASE_URL")
    anon_key = env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not base_url or not anon_key:
        print("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY", file=sys.stderr)
        sys.exit(2)
    rest = f"{base_url.rstrip('/')}/rest/v1"

    citymuns = supabase_get(
        rest,
        anon_key,
        "dim_geo?geo_level=eq.citymun&select=geo_code,geo_name,province_code&order=geo_code",
    )
    barangays = supabase_get(
        rest,
        anon_key,
        "dim_geo?geo_level=eq.barangay&select=geo_code,geo_name,citymun_code,province_code&order=geo_code",
    )
    print(f"[dim_geo] {len(citymuns)} citymuns, {len(barangays)} barangays")

    barangay_by_code = {b["geo_code"]: b for b in barangays}
    province_of_citymun = {c["geo_code"]: c["province_code"] for c in citymuns}
    citymun_name = {c["geo_code"]: c["geo_name"] for c in citymuns}

    # province_code -> { barangay geo_code -> [lon, lat] }
    by_province = {}
    report = {
        "source": f"{SOURCE_BASE}/municities/hires/bgysubmuns-municity-*.0.1.json",
        "citymuns_in_dim_geo": len(citymuns),
        "barangays_in_dim_geo": len(barangays),
        "citymuns_missing_from_source": [],
        "barangays_without_centroid": [],
        "source_features_unmatched": [],
        "placed": 0,
    }

    done = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for citymun_code, status, features in pool.map(
            fetch_citymun, [c["geo_code"] for c in citymuns]
        ):
            done += 1
            if done % 200 == 0:
                print(f"[fetch] {done}/{len(citymuns)} city/municipalities")

            if not features:
                report["citymuns_missing_from_source"].append(
                    {
                        "geo_code": citymun_code,
                        "geo_name": citymun_name.get(citymun_code),
                        "status": status,
                    }
                )
                continue

            for barangay_code, point in features:
                row = barangay_by_code.get(barangay_code)
                if row is None:
                    report["source_features_unmatched"].append(
                        {"geo_code": barangay_code, "citymun_code": citymun_code}
                    )
                    continue
                if point is None:
                    continue  # counted below, off the dim_geo side, so it is counted once.
                by_province.setdefault(row["province_code"], {})[barangay_code] = point
                report["placed"] += 1

    # Two-way, dim_geo side: every barangay we never wrote a point for, with why.
    placed_codes = {code for province in by_province.values() for code in province}
    for barangay in barangays:
        if barangay["geo_code"] in placed_codes:
            continue
        report["barangays_without_centroid"].append(
            {
                "geo_code": barangay["geo_code"],
                "geo_name": barangay["geo_name"],
                "citymun_code": barangay["citymun_code"],
                "citymun_name": citymun_name.get(barangay["citymun_code"]),
            }
        )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for existing in OUT_DIR.glob("*.json"):
        existing.unlink()
    for province_code, centroids in sorted(by_province.items()):
        # Sorted keys and no whitespace: the file is a build artefact that gets committed, so a
        # re-run must produce a byte-identical diff when nothing upstream changed.
        (OUT_DIR / f"{province_code}.json").write_text(
            json.dumps(dict(sorted(centroids.items())), separators=(",", ":"))
        )
    print(
        f"[centroids] wrote {len(by_province)} province files, "
        f"{report['placed']} of {len(barangays)} barangays placed"
    )

    unplaced = report["barangays_without_centroid"]
    missing_citymuns = report["citymuns_missing_from_source"]
    unplaced_by_citymun = {}
    for row in unplaced:
        unplaced_by_citymun.setdefault(row["citymun_code"], 0)
        unplaced_by_citymun[row["citymun_code"]] += 1

    missing_codes = {c["geo_code"] for c in missing_citymuns}
    unplaced_in_missing = sum(n for code, n in unplaced_by_citymun.items() if code in missing_codes)
    unplaced_elsewhere = len(unplaced) - unplaced_in_missing

    coverage = 100 * report["placed"] / len(barangays) if barangays else 0
    report_md = [
        "# Barangay centroid reconciliation report",
        "",
        f"Source: `faeldon/philippines-json-maps`, 2023 PSGC series, level 4 at **hires** "
        f"(`{SOURCE_BASE}/municities/hires/bgysubmuns-municity-*.0.1.json`).",
        "Generated by `ingestion/build_barangay_centroids.py` — re-run it to refresh this report.",
        "",
        "## What these points are, and are not",
        "",
        "Each point is a **representative point of the barangay's polygon** — a point guaranteed to "
        "lie inside the barangay, taken from its largest part. It is the *barangay's* location.",
        "",
        "It is **not a facility location.** The DOH National Health Facility Registry carries no "
        "lat/long, only PSGC codes, so `/facilities` plots a barangay and labels it with how many "
        "facilities are registered there. A dot on that map answers \"which barangays have "
        "facilities, and which have none\" — never \"the clinic is at this corner\".",
        "",
        "## Summary",
        "",
        f"- Barangays in `dim_geo`: {len(barangays):,}",
        f"- Barangays with a centroid: {report['placed']:,} ({coverage:.2f}%)",
        f"- Barangays with no centroid: {len(unplaced):,}",
        f"- City/municipalities with no barangay file in the source: {len(missing_citymuns)} "
        f"of {len(citymuns):,}",
        f"- Source features matching no `dim_geo` barangay: {len(report['source_features_unmatched']):,}",
        "",
        "Gaps are **accepted, not fixed**. A barangay with no centroid is not plotted and is "
        "counted out loud on the page (\"n barangays could not be placed on this map\"), and the "
        "facility list beside the map lists every facility either way — the same posture "
        "BUILD_PLAN.md §4.3 sets for missing polygons, applied one level down.",
        "",
        "## Crosswalk applied: Negros Island Region (NIR)",
        "",
        "The source predates NIR and still files Negros Occidental under Region VI and Negros "
        "Oriental + Siquijor under Region VII. Their city/municipalities are therefore fetched "
        "under the pre-NIR codes (`06045`/`07046`/`07061`) and every barangay code the source "
        "returns is restated under the province code `dim_geo` uses — the same crosswalk "
        "`ingestion/reconcile_boundaries.py` applies one level up. This is the only crosswalk "
        "applied; everything below is a genuine gap between the two datasets.",
        "",
        "## Why the remaining gaps exist",
        "",
        f"- **City/municipalities with no level-4 file at all** account for "
        f"{unplaced_in_missing:,} of the unplaced barangays. Today that list is entirely the City "
        "of Manila's sub-municipalities (Tondo I/II, Sampaloc, Santa Ana, …), which `dim_geo` "
        "models at the citymun level: the source has no file for any of them, and Manila's own "
        "file (`1380600000`) answers with an *empty GeometryCollection* in every resolution and "
        "every vintage the repo publishes (2011, 2019, 2023). There is nothing to crosswalk to — "
        "the polygons are simply not in this source. Manila's facility pages therefore render the "
        "facility list with no map above it, rather than a map missing every dot.",
        f"- **Individual barangays missing from an otherwise complete file** account for the "
        f"remaining {unplaced_elsewhere:,}. That, and the "
        f"{len(report['source_features_unmatched']):,} source features carrying a code `dim_geo` "
        "does not have, are the same thing seen from both sides: PSGC vintage drift, barangays "
        "created, merged, or renumbered between the source's 2023 snapshot and `dim_geo`'s. "
        "Accepted per-barangay rather than guessed at — an invented centroid would put a dot "
        "somewhere real on a map, which is worse than an honest gap.",
        "",
        "## City/municipalities with no barangay boundaries in the source",
        "",
    ]
    if missing_citymuns:
        for c in sorted(missing_citymuns, key=lambda c: c["geo_code"]):
            report_md.append(
                f"- `{c['geo_code']}` — {c['geo_name']} (HTTP {c['status']}, "
                f"{unplaced_by_citymun.get(c['geo_code'], 0)} barangays unplaced)"
            )
    else:
        report_md.append("_None._")

    report_md += [
        "",
        "## Other city/municipalities with unplaced barangays",
        "",
        "These have a source file, but one or more of their barangays is absent from it or carries "
        "no usable polygon.",
        "",
    ]
    partial = sorted(
        ((code, n) for code, n in unplaced_by_citymun.items() if code not in missing_codes),
        key=lambda pair: (-pair[1], pair[0]),
    )
    if partial:
        for code, n in partial:
            report_md.append(f"- `{code}` — {citymun_name.get(code)}: {n} unplaced")
    else:
        report_md.append("_None._")

    report_md += [
        "",
        "## Source features that match no `dim_geo` barangay",
        "",
    ]
    if report["source_features_unmatched"]:
        for f in sorted(report["source_features_unmatched"], key=lambda f: f["geo_code"])[:200]:
            report_md.append(f"- `{f['geo_code']}` (in citymun `{f['citymun_code']}`)")
        if len(report["source_features_unmatched"]) > 200:
            report_md.append(
                f"- … and {len(report['source_features_unmatched']) - 200:,} more "
                "(full list in `ingestion/barangay_centroid_reconciliation.json`)"
            )
    else:
        report_md.append("_None._")
    report_md.append("")

    REPORT_PATH.write_text("\n".join(report_md) + "\n")
    JSON_REPORT_PATH.write_text(json.dumps(report, indent=2))
    print(f"\nReport written to {REPORT_PATH} and {JSON_REPORT_PATH}")


if __name__ == "__main__":
    main()
