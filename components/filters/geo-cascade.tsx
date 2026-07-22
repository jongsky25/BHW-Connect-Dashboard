"use client";

import { useFilterState } from "@/lib/filters/use-filter-state";
import { NATIONAL_GEO_CODE, type GeoLevel } from "@/lib/filters/schema";
import { logEvent } from "@/lib/usage/log-client";
import { useExploreNav } from "@/components/explore/explore-nav";

type Option = { geoCode: string; geoName: string };

function LevelSelect({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (geoCode: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted" htmlFor={`geo-select-${label}`}>
        {label}
      </label>
      <select
        id={`geo-select-${label}`}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
      >
        <option value="">Select…</option>
        {options.map((opt) => (
          <option key={opt.geoCode} value={opt.geoCode}>
            {opt.geoName}
          </option>
        ))}
      </select>
    </div>
  );
}

export type GeoCascadeProps = {
  regions: Option[];
  provinces: Option[];
  citymuns: Option[];
  barangays: Option[];
  selected: {
    regionCode: string | null;
    provinceCode: string | null;
    citymunCode: string | null;
    barangayCode: string | null;
  };
};

/**
 * Cascading national -> region -> province -> citymun -> barangay selects.
 * Each option list is pre-fetched server-side for the *current* ancestor
 * chain (BUILD_PLAN.md §7 1.2) — picking a value just updates the URL via
 * nuqs, which re-renders the explore page with the new chain and its own
 * freshly fetched child lists. No client-side geo fetching needed.
 */
export function GeoCascade({ regions, provinces, citymuns, barangays, selected }: GeoCascadeProps) {
  const { startTransition } = useExploreNav();
  const [, setFilters] = useFilterState({ startTransition });

  function navigateTo(geoLevel: GeoLevel, geoCode: string) {
    setFilters({ geoLevel, geoCode });
    logEvent("filter_change", { geoCode, meta: { geoLevel } });
  }

  return (
    <div className="flex flex-col gap-3">
      <LevelSelect
        label="Region"
        value={selected.regionCode ?? ""}
        options={regions}
        onChange={(code) =>
          code ? navigateTo("region", code) : navigateTo("national", NATIONAL_GEO_CODE)
        }
      />
      <LevelSelect
        label="Province"
        value={selected.provinceCode ?? ""}
        options={provinces}
        disabled={!selected.regionCode}
        onChange={(code) =>
          code ? navigateTo("province", code) : navigateTo("region", selected.regionCode!)
        }
      />
      <LevelSelect
        label="City/Municipality"
        value={selected.citymunCode ?? ""}
        options={citymuns}
        disabled={!selected.provinceCode}
        onChange={(code) =>
          code ? navigateTo("citymun", code) : navigateTo("province", selected.provinceCode!)
        }
      />
      <LevelSelect
        label="Barangay"
        value={selected.barangayCode ?? ""}
        options={barangays}
        disabled={!selected.citymunCode}
        onChange={(code) =>
          code ? navigateTo("barangay", code) : navigateTo("citymun", selected.citymunCode!)
        }
      />
    </div>
  );
}
