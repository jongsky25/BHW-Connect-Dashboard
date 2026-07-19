export type GlossaryTermSlug = keyof typeof GLOSSARY;

/**
 * Every technical term referenced anywhere in the UI must have an entry here
 * (BUILD_PLAN.md §5) — `components/glossary/glossary-term.tsx` throws for an
 * unknown slug, so a reference to a term that isn't defined here fails the
 * page that renders it (and `next build`'s static generation, for any
 * statically-rendered page that uses it) rather than silently drifting.
 */
export const GLOSSARY = {
  accredited: {
    term: "Accredited",
    definition:
      "A BHW who has completed the Department of Health's accreditation process, as recorded in the ACCREDITED BHW field of the source dataset.",
  },
  suppressed: {
    term: "Suppressed",
    definition:
      "A figure hidden because fewer than 5 BHWs are represented in that cell — showing the exact number could let someone identify a specific individual. The number rolls up to the nearest larger area where it's safe to show instead.",
  },
  honorarium: {
    term: "Honorarium",
    definition:
      "A cash allowance paid to a BHW by a local government unit (region, province, city/municipality, or barangay) in recognition of their service. A BHW can receive honorarium from more than one level at once.",
  },
  active_years: {
    term: "Years of service",
    definition:
      "The number of distinct years a BHW is recorded as having been active, based on their self-reported active-service year list.",
  },
  ip_status: {
    term: "IP status",
    definition: "Whether a BHW self-identifies as belonging to an Indigenous People (IP) group.",
  },
  psgc: {
    term: "PSGC",
    definition:
      "Philippine Standard Geographic Code — the government's official numeric coding system for regions, provinces, cities/municipalities, and barangays.",
  },
  huc: {
    term: "HUC",
    definition:
      "Highly Urbanized City — a city that is administratively independent of the province it's geographically part of.",
  },
} as const;
