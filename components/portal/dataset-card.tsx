import Link from "next/link";

/**
 * A single dataset entry on the Equity in Health portal. When `href` is set the
 * card is a real link into that dataset's dashboard; without it the card renders
 * as a muted, non-interactive "coming soon" placeholder that signals the
 * section's roadmap without entering the tab order.
 */
export function DatasetCard({
  title,
  description,
  href,
  cta = "Open dashboard →",
}: {
  title: string;
  description: string;
  /** Destination for an active dataset. Omit for a "coming soon" placeholder. */
  href?: string;
  /** Call-to-action label shown on an active card. */
  cta?: string;
}) {
  if (href) {
    return (
      <Link
        href={href}
        className="flex flex-col rounded-lg border border-border bg-background p-5 transition-colors hover:border-accent focus-visible:border-accent"
      >
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 flex-1 text-sm text-muted">{description}</p>
        <span className="mt-3 inline-block text-sm font-medium text-accent">{cta}</span>
      </Link>
    );
  }

  return (
    <div
      aria-disabled="true"
      className="flex flex-col rounded-lg border border-border bg-surface p-5 opacity-60"
    >
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 flex-1 text-sm text-muted">{description}</p>
      <span className="mt-3 inline-block text-xs font-medium uppercase tracking-wide text-muted">
        Coming soon
      </span>
    </div>
  );
}
