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
  honorarium_sufficiency: {
    term: "Honorarium sufficiency",
    definition:
      "Each BHW's honorarium summed across every paying level (region, province, city/municipality, barangay) into one cumulative monthly total, then compared to a sufficiency cut of ₱2,040/month (≈₱68/day, using a 30-day-month convention). Unlike the distribution and inequality figures, which describe amounts only among BHWs who receive something, the denominator here is every profiled BHW, including those who receive no honorarium at all.",
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
  census_population: {
    term: "Census population",
    definition:
      "The official resident count from the Philippine Statistics Authority (PSA) census — the 2024 Census of Population (POPCEN) for the current figure, with the 2020 Census of Population and Housing (CPH) also available. It is the preferred denominator for per-resident rates; where an area has no matching census entry, the approximate self-reported StepZero population is used instead. The finest census grain here is city/municipality.",
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
  poverty_incidence: {
    term: "Poverty incidence",
    definition:
      "The share of a city or municipality's population living below the official poverty threshold. From the Philippine Statistics Authority's 2023 Small Area Estimates — model-based estimates that combine the census, income surveys, and administrative data to reach the city/municipality level, each published with a confidence interval. Highly Urbanized Cities are estimated separately and are not covered here. Used only as a comparison variable on the Explore relationships scatter, never as a BHW-workforce figure.",
  },
  lgu_reported_accreditation: {
    term: "LGU-reported accreditation",
    definition:
      "The share of all BHWs an area's own quick-count (StepZero) reports as accredited. It counts the whole BHW universe, unlike the verified accreditation rate, which counts only individually validated profiles. The two use different sources and denominators, so they're shown side by side, never averaged.",
  },
  confidence_interval: {
    term: "confidence interval",
    definition:
      "The range the true rate is very likely to fall in, given how few people were counted. A wide interval means the percentage is based on so few BHWs that it could really be quite different; a narrow one means it's well-pinned-down. Shown here as a 95% Wilson interval.",
  },
  data_completeness: {
    term: "Data completeness",
    definition:
      "How much of each BHW profile's information is actually filled in. The grade (A ≥95%, B ≥85%, C below) is the average completeness across the tracked fields, each counted equally; a low grade means figures that rely on the missing fields are less reliable here. See the data-quality page for the field-by-field breakdown.",
  },
  gini: {
    term: "Gini coefficient",
    definition:
      "A single number from 0 to 1 for how unevenly something is shared out. 0 means everyone gets exactly the same; 1 means one person gets everything. Used here for how evenly (or not) honorarium amounts are spread among the BHWs who receive one.",
  },
  income_class: {
    term: "LGU income class",
    definition:
      "The government's ranking of a province, city, or municipality by its yearly income, from 1st class (highest income) to 5th class (lowest). It's a rough proxy for how much a local government can afford to spend — including on supporting its BHWs. The values here are the DOF's 2024 reclassification (Department Order 074-2024 under RA 11964, effective 2025), which replaced the older six-class system.",
  },
  adjusted_rate: {
    term: "Adjusted rate",
    definition:
      "A rate from a place with very few BHWs is nudged toward its parent area's rate, because a handful of people can swing a small percentage wildly. The adjustment moves noisy small-area rates toward what's typical nearby, leaving large, well-measured areas almost unchanged. Raw rates are shown by default; the adjusted view is an opt-in.",
  },
} as const;
