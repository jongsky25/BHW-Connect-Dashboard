import Link from "next/link";
import { getActiveDataset } from "@/lib/db/dataset";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

export async function Footer() {
  const dataset = await getActiveDataset();

  return (
    <footer className="mt-auto border-t border-border bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted sm:px-6">
        <p>
          Source:{" "}
          {dataset?.sourceName ??
            "Official DOH Barangay Health Worker registration/accreditation dataset (2025 snapshot)"}
          .
        </p>
        <p>
          Data licensed under{" "}
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            className="underline underline-offset-2 hover:text-accent"
            rel="license noopener noreferrer"
            target="_blank"
          >
            {dataset?.license ?? "CC BY 4.0"}
          </a>
          .{" "}
          {dataset?.lastUpdatedAt && (
            <span>Last updated {formatDate(dataset.lastUpdatedAt)}.</span>
          )}
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/methodology" className="underline underline-offset-2 hover:text-accent">
            Methodology
          </Link>
          <Link href="/privacy" className="underline underline-offset-2 hover:text-accent">
            Privacy
          </Link>
          <Link href="/feedback" className="underline underline-offset-2 hover:text-accent">
            Feedback
          </Link>
          <Link href="/roadmap" className="underline underline-offset-2 hover:text-accent">
            Roadmap
          </Link>
        </div>
        <p>BHW Connect is an independent public-interest project, not affiliated with DOH.</p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="equity-mark sm" aria-hidden="true" />
          <span>An Equity in Health Section innovation</span>
        </div>
      </div>
    </footer>
  );
}
