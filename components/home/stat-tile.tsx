export type StatTileDetail = {
  label: string;
  value: string;
};

export function StatTile({
  label,
  value,
  caption,
  details,
}: {
  label: string;
  value: string;
  caption: string;
  /** Optional breakdown shown when the tile is clicked/expanded. */
  details?: StatTileDetail[];
}) {
  const body = (
    <>
      <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted">{caption}</p>
    </>
  );

  if (!details || details.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-background p-4 sm:p-5">
        <p className="text-sm text-muted">{label}</p>
        {body}
      </div>
    );
  }

  return (
    <details className="group rounded-lg border border-border bg-background p-4 sm:p-5">
      <summary className="cursor-pointer select-none list-none">
        <span className="flex items-center justify-between text-sm text-muted">
          {label}
          <span className="text-muted transition-transform group-open:rotate-180" aria-hidden="true">
            ▾
          </span>
        </span>
        {body}
      </summary>
      <dl className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
        {details.map((d) => (
          <div key={d.label} className="flex items-center justify-between gap-3">
            <dt className="text-muted">{d.label}</dt>
            <dd className="font-medium">{d.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
