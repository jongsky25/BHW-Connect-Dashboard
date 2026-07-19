"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { aboutNavLinks, primaryNavLinks } from "./nav-links";

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-surface ${
        isActive ? "text-accent" : "text-foreground"
      }`}
    >
      {label}
    </Link>
  );
}

export function Header() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);

  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMobileOpen(false);
  }

  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          BHW Connect
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {primaryNavLinks.map((link) => (
            <NavLink key={link.href} {...link} />
          ))}
          <details className="group relative">
            <summary className="cursor-pointer list-none rounded-md px-3 py-2 text-sm font-medium hover:bg-surface [&::-webkit-details-marker]:hidden">
              About
            </summary>
            <div className="absolute right-0 z-10 mt-1 w-48 rounded-md border border-border bg-background py-1 shadow-md">
              {aboutNavLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="block px-3 py-2 text-sm hover:bg-surface"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </details>
        </nav>

        <button
          type="button"
          className="rounded-md p-2 md:hidden"
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          onClick={() => setMobileOpen((open) => !open)}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            {mobileOpen ? <path d="M6 6l12 12M6 18L18 6" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
          </svg>
        </button>
      </div>

      {mobileOpen && (
        <nav id="mobile-nav" aria-label="Primary" className="border-t border-border md:hidden">
          <ul className="flex flex-col px-4 py-2 sm:px-6">
            {[...primaryNavLinks, ...aboutNavLinks].map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="block rounded-md px-3 py-2.5 text-sm font-medium hover:bg-surface"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
