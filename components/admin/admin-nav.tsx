import Link from "next/link";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/feedback", label: "Feedback" },
  { href: "/admin/usage", label: "Usage" },
  { href: "/admin/changelog", label: "Changelog" },
  { href: "/admin/ingestion", label: "Ingestion history" },
  { href: "/admin/ai-quota", label: "AI quota" },
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
