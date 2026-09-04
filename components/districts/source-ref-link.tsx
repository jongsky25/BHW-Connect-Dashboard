const WIKIPEDIA_SOURCE_REF = /^wikipedia:(.+)@(\d+)$/;

/**
 * Renders a `geo_district_map`/`dim_legislative_district` `source_ref` as a link to the exact
 * revision it names, when it's checkable — `wikipedia:<page>@<revid>` resolves to that page's
 * history at that revision, which is the whole point of storing a revid instead of a URL (see the
 * migration comment on `geo_district_map.source_ref`). Anything else renders as plain text rather
 * than a guessed link.
 */
export function SourceRefLink({ sourceKind, sourceRef }: { sourceKind: string; sourceRef: string }) {
  const match = sourceKind === "wikipedia" ? sourceRef.match(WIKIPEDIA_SOURCE_REF) : null;
  if (!match) return <span>{sourceRef}</span>;

  const [, page, revId] = match;
  const href = `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(page)}&oldid=${revId}`;

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline hover:text-accent">
      {page} <span className="text-muted">(rev {revId})</span>
    </a>
  );
}
