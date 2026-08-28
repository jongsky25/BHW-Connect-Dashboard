import Link from "next/link";
import { FeedbackForm } from "@/components/feedback/feedback-form";

/**
 * The one correction this dataset actually attracts (plan U6): "that barangay should not be on the
 * list", or "ours is missing".
 *
 * `SpotFeedback` already renders here — it is mounted globally and gated off `/admin` and `/` only
 * — so this is not a second widget. What it adds is an entry point that names the correction in
 * the reader's own words, in the section footer where someone who has just read a list of their own
 * barangays is looking. A pin-and-comment affordance is the right shape for "this chart looks
 * wrong"; it is the wrong shape for "this list is wrong about my barangay".
 *
 * **It says plainly that we cannot change the list.** This is a published DOH issuance
 * (DC No. 2025-0549) reproduced as issued; a correction is a matter for the source office, and
 * routing someone to a bug tracker for it would waste their time. `feedback.dataset_slug` is what
 * makes that routing possible on our side — derived from this page's path at write time, so a
 * correction arrives distinguishable from a UI bug without anyone string-matching a URL.
 *
 * A `<details>` rather than a dialog: no client JS to open it, and it stays out of the way of the
 * footer's source line until someone wants it.
 */
export function ListCorrection() {
  return (
    <details className="group w-full">
      <summary className="cursor-pointer text-sm font-medium text-foreground hover:text-accent">
        Is a barangay missing from this list, or listed in error?
      </summary>
      <div className="mt-4 flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
        <p className="text-sm text-muted">
          This list is published by the DOH Bureau of Local Health Systems Development under DC No.
          2025-0549 and is reproduced here exactly as issued — we cannot add or remove a barangay.
          Tell us what you found and we will pass it on to the source office. Please name the
          barangay, its city or municipality, and what looks wrong.
        </p>
        <p className="text-sm text-muted">
          One thing is already known and does not need reporting: one source row could not be
          resolved to a single barangay. It is written up in the{" "}
          <Link href="/uuc-phc/methodology" className="underline hover:text-accent">
            methodology
          </Link>
          .
        </p>
        <FeedbackForm
          defaultCategory="data_question"
          idPrefix="uuc-correction"
          doneMessage="Thanks — we have your note, and it is tagged to this list rather than to the site."
        />
      </div>
    </details>
  );
}
