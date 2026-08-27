import type { GeoLevel } from "@/lib/filters/schema";

/**
 * The section's downloads, in one place (plan U11).
 *
 * Until U11 there was one link here — U4's PNG one-pager — and the PNG carries no indicator values
 * on purpose: a picture has nowhere to put the † marker a bounded value needs, and 886 Water
 * readings that read as exactly 100% without it are the unmarked artefact U3 was built to avoid.
 * The two new links are the same rule reaching a format that can satisfy it: a spreadsheet has a
 * `capped_indicators` column and a notes block above the data.
 *
 * **The three are labelled by what they contain, not by their file type.** "Summary" against
 * "the rows" is the distinction that matters to someone choosing — one is a page to show, the
 * other is `nListed` lines to work from — and a reader who picks the picture expecting the data
 * has been failed by the label rather than by the file.
 */
export function DownloadLinks({
  geoLevel,
  geoCode,
  nListed,
}: {
  geoLevel: GeoLevel;
  geoCode: string;
  /** The area's listed count, so the label says how many rows a download is worth opening for. A
   * zero area still gets the links: an empty file with its header is a real answer, and NCR's
   * "0 of 1,675" is a finding rather than a missing export. */
  nListed: number;
}) {
  const scope = `geoLevel=${geoLevel}&geoCode=${encodeURIComponent(geoCode)}`;
  const rowLabel = nListed === 1 ? "1 row" : `${nListed.toLocaleString()} rows`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={`/api/export/uuc-phc?${scope}`}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:border-accent"
      >
        Summary (PNG)
      </a>
      <a
        href={`/api/export/uuc-phc/data?${scope}&format=csv`}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:border-accent"
      >
        Listed barangays (CSV)
      </a>
      <a
        href={`/api/export/uuc-phc/data?${scope}&format=xlsx`}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:border-accent"
      >
        Listed barangays (XLSX)
      </a>
      <p className="w-full text-xs text-muted sm:w-auto">
        {nListed === 0 ? (
          // The links stay, and say what they will give: a file with its header, its caveats and
          // no rows. Nothing listed here is a result, so an empty download is the right answer and
          // removing the buttons would make it look like the export had failed.
          <>
            Nothing is listed here, so both files carry their header and caveats and no rows. The
            columns are the same ones every other area gets, including{" "}
            <code className="rounded bg-surface px-1 py-0.5 text-[0.95em]">capped_indicators</code>.
          </>
        ) : (
          <>
            {rowLabel}, one per listed barangay, with the indicator values and a{" "}
            <code className="rounded bg-surface px-1 py-0.5 text-[0.95em]">capped_indicators</code>{" "}
            column marking the values that were bounded during cleaning. The PNG carries no
            indicator values — it cannot carry that marker.
          </>
        )}
      </p>
    </div>
  );
}
