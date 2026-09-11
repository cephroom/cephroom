"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function MobileNav({
  items,
}: {
  items: { href: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close on navigation, otherwise the panel survives the route change.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Close menu" : "Open menu"}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-rule text-ink-muted transition-colors hover:text-ink"
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
          {open ? (
            <path
              d="M3.5 3.5l9 9M12.5 3.5l-9 9"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          ) : (
            <path
              d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          )}
        </svg>
      </button>

      <div
        hidden={!open}
        className="absolute left-0 right-0 top-14 border-b border-rule bg-paper-raised px-5 py-3 shadow-sm"
      >
        <nav className="flex flex-col" aria-label="Mobile">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="border-b border-rule py-2.5 text-[0.95rem] text-ink last:border-0"
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/signin"
            className="border-t border-rule py-2.5 text-[0.95rem] text-ink-muted"
          >
            Sign in
          </Link>
        </nav>
      </div>
    </div>
  );
}
