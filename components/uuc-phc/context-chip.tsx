import Link from "next/link";
import { uucContextSentence, uucPhcAreaHref, type UucPhcCounts } from "@/lib/db/uuc-phc";

/**
 * Cross-dataset context chip (plan §9 U12a): how much of the area a BHW page is describing sits
 * on the 2025 UUC for PHC list, linking through to the section.
 *
 * Reads `agg_uuc_phc_counts` through the existing `getUucPhcCounts` — no new aggregate and no new
 * relation — which is what makes it cheap enough to put on every place. It is how a reader looking
 * at BHW figures discovers this dataset exists at all.
 *
 * The wording, the zero case and the null case are `uucContextSentence`'s; this renders it.
 *
 * **Rendered outside any `PresentationSlide`.** Both host pages carry a deck whose caption states
 * a BHW N ("N = 4,312 validated profiles · …"). Projecting a barangay count under that caption
 * would put a figure on screen the deck's own stated denominator does not support — the same
 * objection U12 makes to the choropleth. This is a pointer to another dataset, not a finding of
 * this one, so it stays on the page and off the slides.
 */
export function UucPhcContextChip({ counts }: { counts: UucPhcCounts | null }) {
  const sentence = uucContextSentence(counts);
  if (!sentence || !counts) return null;

  return (
    <Link
      href={uucPhcAreaHref(counts.geoLevel, counts.geoCode)}
      className="block rounded-lg border border-border bg-surface px-4 py-2.5 text-sm hover:border-accent hover:text-accent"
    >
      {sentence}
      {/* Non-breaking space, so a wrapped sentence never leaves the arrow alone on its own line
          at narrow widths. Hidden from assistive tech: the link text is the whole statement. */}
      <span aria-hidden="true">{"\u00a0→"}</span>
    </Link>
  );
}
