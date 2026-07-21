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
  total_bhw: {
    term: "Total BHWs",
    definition:
      "The full count of Barangay Health Workers in an area, from the DOH StepZero quick-count: registered, registered & accredited, and non-registered BHWs combined. This is the universe against which the individually-profiled subset is measured.",
  },
  validated_profile: {
    term: "Validated profile",
    definition:
      "A Barangay Health Worker who has been individually profiled and validated — one anonymized person-level record in the detailed dataset. Every per-person figure on this site (accreditation, demographics, training, honorarium, service years) is computed from these validated profiles, not from the quick-count total.",
  },
  profiling_coverage: {
    term: "Profiling coverage",
    definition:
      "The share of registered BHWs who have a validated individual profile — validated profiles divided by the registered universe (registered + registered & accredited). Non-registered BHWs are excluded from this ratio because they are not individually profiled.",
  },
  registered_bhw: {
    term: "Registered BHW",
    definition:
      "A Barangay Health Worker recorded as registered with the DOH, whether or not they are also accredited. In the StepZero quick-count this covers the 'registered' and 'registered & accredited' buckets.",
  },
  non_registered_bhw: {
    term: "Non-registered BHW",
    definition:
      "A Barangay Health Worker counted in the StepZero quick-count who is not recorded as registered with the DOH. Non-registered BHWs are part of the total headcount but are not individually profiled.",
  },
  stepzero: {
    term: "StepZero quick-count",
    definition:
      "A DOH barangay-level aggregate headcount of Barangay Health Workers (registered, accredited, and non-registered) with population and household context. It provides the total BHW universe; it is a coarser, self-reported tally distinct from the individually-validated per-person dataset.",
  },
  households_per_bhw: {
    term: "Households per BHW",
    definition:
      "The area's household count divided by its Total BHWs (the StepZero universe) — roughly how many households each BHW serves. BHWs in the Philippines are assigned to households, so this ratio is the operative workload measure, and it lets places of very different sizes be compared. Household counts come from the StepZero quick-count and the ratio is unavailable for areas with no StepZero row.",
  },
  ref_manual_trained: {
    term: "BHW Reference Manual Training",
    definition:
      "Whether a BHW has completed training on the DOH's official BHW Reference Manual, as recorded in the source dataset's training fields.",
  },
  tesda_nc2: {
    term: "TESDA BHS NC2 Training",
    definition:
      "Whether a BHW has taken TESDA's Barangay Health Services (BHS) National Certificate II training/assessment. Distinct from having actually earned the NC II certification (see 'TESDA BHS NC II Certification').",
  },
  tesda_certified: {
    term: "TESDA BHS NC II Certification",
    definition:
      "Whether a BHW holds an official TESDA National Certificate II (NC II) in Barangay Health Services — the certified outcome of the BHS NC2 training/assessment.",
  },
  ai_generated: {
    term: "AI-generated",
    definition:
      "Written by an AI model, not a person — but every number in it is looked up from this site's own database at the moment it was written, then automatically checked and stripped if it can't be traced back to that lookup. See the methodology page for how this works.",
  },
  bhw_per_1000: {
    term: "BHWs per 1,000 residents",
    definition:
      "Total BHWs divided by the area's population, times 1,000 — how many health workers serve each 1,000 people. Population is self-reported in the StepZero barangay sheets, so treat it as approximate until census data replaces it. Higher means denser BHW coverage.",
  },
  lgu_reported_accreditation: {
    term: "LGU-reported accreditation",
    definition:
      "The share of all BHWs an area's own quick-count (StepZero) reports as accredited. It counts the whole BHW universe, unlike the verified accreditation rate, which counts only individually validated profiles. The two use different sources and denominators, so they're shown side by side, never averaged.",
  },
  data_completeness: {
    term: "Data completeness",
    definition:
      "How much of each BHW profile's information is actually filled in. The grade (A ≥95%, B ≥85%, C below) is the average completeness across the tracked fields, each counted equally; a low grade means figures that rely on the missing fields are less reliable here. See the data-quality page for the field-by-field breakdown.",
  },
} as const;
