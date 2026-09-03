import type { DistrictMatchQuality } from "@/lib/db/districts";

const STYLE: Record<DistrictMatchQuality, string> = {
  all_exact: "bg-accent/10 text-accent border-accent/30",
  resolved: "bg-surface text-muted border-border",
  has_overrides: "bg-warning/10 text-warning border-warning/40",
  has_unresolved: "bg-danger/10 text-danger border-danger/40",
  no_members: "bg-danger/10 text-danger border-danger/40",
};

const LABEL: Record<DistrictMatchQuality, string> = {
  all_exact: "All exact",
  resolved: "Rule-resolved",
  has_overrides: "Has corrections",
  has_unresolved: "Known gap",
  no_members: "No members loaded",
};

/** What each badge means, shown in the page legend — not in a per-row tooltip,
 * so the definition is stated once and plainly rather than hidden in a hover. */
export const MATCH_QUALITY_DESCRIPTION: Record<DistrictMatchQuality, string> = {
  all_exact: "Every member's name matched a place directly.",
  resolved:
    "Every member was placed by a documented rule — a whole-province or whole-city expansion, an independent city read from a source's lead sentence, a PSGC code, or a barangay roster — rather than a direct name match. No manual correction, no known gap.",
  has_overrides:
    "At least one member was placed by a documented manual decision or an accepted public correction.",
  has_unresolved:
    "At least one place belonging to this district could not be resolved from the source and is missing.",
  no_members: "This district has no membership rows loaded yet.",
};

export function MatchQualityBadge({ quality }: { quality: DistrictMatchQuality }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${STYLE[quality]}`}
    >
      {LABEL[quality]}
    </span>
  );
}
