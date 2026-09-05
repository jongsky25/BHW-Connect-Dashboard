import Link from "next/link";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/feedback", label: "Feedback" },
  { href: "/admin/usage", label: "Usage" },
  { href: "/admin/changelog", label: "Changelog" },
  { href: "/admin/ingestion", label: "Ingestion history" },
  { href: "/admin/ai-quota", label: "AI quota" },
  { href: "/admin/answer-bank", label: "Answer bank" },
  { href: "/admin/assistant", label: "Assistant" },
  // Increment 5.4. The profile itself is per-geography, so this points at the national one; the
  // page carries a place search to get anywhere else.
  { href: "/admin/place/national/PH", label: "Area profile" },
  { href: "/admin/kb-review", label: "KB review" },
  { href: "/admin/district-corrections", label: "District corrections" },
  { href: "/admin/regressions", label: "Regressions" },
];

export function AdminNav() {
  return (
    <nav className="flex w-40 shrink-0 flex-col gap-1 sm:w-48">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="rounded-md px-3 py-2 text-sm hover:bg-surface"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
