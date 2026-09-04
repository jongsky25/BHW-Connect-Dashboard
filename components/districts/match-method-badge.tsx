const LABEL: Record<string, string> = {
  exact: "Exact",
  disambiguated: "Disambiguated",
  crosswalk: "Crosswalk",
  psgc_identifier: "PSGC identifier",
  barangay_roster: "Barangay roster",
  whole_citymun: "Whole city/mun",
  whole_parent: "Whole province",
  independent_city: "Independent city",
  manual_override: "Manual override",
  public_correction: "Public correction",
};

const OVERRIDE_METHODS = new Set(["manual_override", "public_correction"]);

/**
 * A row's `match_method`, D2.2's per-row receipt (docs/LEGISLATIVE_DISTRICTS_PLAN.md §5.2) — plain
 * text for anything placed by a documented rule, and the same warning color the index page's
 * "has overrides" badge uses for the two methods that mean a person (or an accepted public
 * correction) decided this row rather than a rule matching it.
 */
export function MatchMethodBadge({ method }: { method: string }) {
  const isOverride = OVERRIDE_METHODS.has(method);
  return (
    <span
      className={
        isOverride
          ? "inline-flex items-center rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-warning"
          : "text-muted"
      }
    >
      {LABEL[method] ?? method}
    </span>
  );
}
