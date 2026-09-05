import Link from "next/link";
import { nhfrAreaHref, nhfrContextSentence, type NhfrCounts } from "@/lib/db/nhfr";

/**
 * Cross-dataset context chip (plan N4): how much health infrastructure the DOH registry records
 * in the area a BHW page is describing, linking through to the facilities section.
 *
 * Reads `agg_nhfr_counts` through the existing `getNhfrCounts` — no new aggregate and no new
 * relation — which is what makes it cheap enough to put on every place. It is how a reader
 * looking at BHW figures discovers this dataset exists at all, and it is the natural pairing:
 * the workforce and the facilities it works out of.
 *
 * The wording, the zero case and the null case are `nhfrContextSentence`'s; this renders it.
 * `UucPhcContextChip`'s precedent throughout, including its two rules:
 *
 * **A sentence, not a map layer.** This switches denominator from BHW profiles to facilities, and
 * a shared legend and colour ramp cannot say "facilities" out loud beside its own denominator.
 *
 * **Rendered outside any `PresentationSlide`.** Both host pages carry a deck whose caption states
 * a BHW N; projecting a facility count under it would put a figure on screen the deck's own
 * stated denominator does not support. This is a pointer to another dataset, not a finding of
 * this one, so it stays on the page and off the slides.
 */
export function NhfrContextChip({ counts }: { counts: NhfrCounts | null }) {
  const sentence = nhfrContextSentence(counts);
  if (!sentence || !counts) return null;

  return (
    <Link
      href={nhfrAreaHref(counts.geoLevel, counts.geoCode)}
      className="block rounded-lg border border-border bg-surface px-4 py-2.5 text-sm hover:border-accent hover:text-accent"
    >
      {sentence}
      {/* Non-breaking space, so a wrapped sentence never leaves the arrow alone on its own line
          at narrow widths. Hidden from assistive tech: the link text is the whole statement. */}
      <span aria-hidden="true">{" →"}</span>
    </Link>
  );
}
