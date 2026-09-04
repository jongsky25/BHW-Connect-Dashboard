function ordinalSuffix(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/** Shared by the index table (client) and the detail page (server), so it lives outside either's
 *  "use client" boundary rather than being exported from one and imported into the other. */
export function districtOrdinalLabel(row: { isLone: boolean; ordinal: number | null }): string {
  if (row.isLone) return "Lone district";
  return row.ordinal ? `${row.ordinal}${ordinalSuffix(row.ordinal)} district` : "—";
}
