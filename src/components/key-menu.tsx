"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { Tier } from "@/lib/access";

/**
 * The key, rather than an account menu.
 *
 * It shows what the reader is holding — subject, tier, and how long until it
 * expires — because under Contract 1 that really is the whole of their
 * relationship with the platform. It also renews the key quietly before it
 * lapses, which is the mechanism that makes a cancellation take effect
 * without a session store to update.
 */
export function KeyMenu({
  name,
  subject,
  tier,
  tierLabel,
  expiresIn,
}: {
  name: string;
  subject: string;
  tier: Tier;
  tierLabel: string;
  expiresIn: number;
}) {
  const [open, setOpen] = useState(false);
  const [remaining, setRemaining] = useState(expiresIn);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => setRemaining(expiresIn), [expiresIn]);

  // Count down, and renew with two minutes to go. Renewal re-asks Stripe, so
  // this is also how a downgrade reaches the reader.
  useEffect(() => {
    const tick = setInterval(() => {
      setRemaining((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (remaining > 120 || remaining === 0) return;
    let cancelled = false;
    (async () => {
      await fetch("/api/auth/refresh", { method: "POST" }).catch(() => {});
      if (!cancelled) router.refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [remaining, router]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, "0");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full border border-rule py-1 pl-1 pr-2.5 transition-colors hover:border-field-border"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[0.72rem] font-semibold text-accent-ink">
          {name.charAt(0).toUpperCase()}
        </span>
        <span className="hidden text-[0.8rem] text-ink-muted sm:block">
          {name.split(" ")[0]}
        </span>
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-ink-faint" aria-hidden>
          <path
            d="M2.5 4.5L6 8l3.5-3.5"
            stroke="currentColor"
            strokeWidth="1.4"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <div
        hidden={!open}
        role="menu"
        className="absolute right-0 top-[calc(100%+8px)] w-72 rounded-lg border border-rule bg-paper-raised py-1.5 shadow-lg"
      >
        <div className="border-b border-rule px-3.5 pb-2.5 pt-1.5">
          <p className="truncate text-[0.85rem] font-medium">{name}</p>
          <p
            className={`mt-1 text-[0.72rem] font-medium ${
              tier === "reader" ? "text-ink-faint" : "text-accent"
            }`}
          >
            {tierLabel} key
          </p>
          <p className="mt-1.5 truncate font-mono text-[0.68rem] text-ink-faint">
            {subject}
          </p>
          <p className="mt-1.5 text-[0.7rem] tnum text-ink-faint">
            expires in {minutes}:{seconds}
            {remaining <= 120 && remaining > 0 && " · renewing"}
          </p>
        </div>

        <MenuLink href="/account">Your key and billing</MenuLink>
        <MenuLink href="/contribute">Run a node</MenuLink>
        {tier === "reader" && (
          <MenuLink href="/pricing" accent>
            Upgrade
          </MenuLink>
        )}

        <form
          action="/api/auth/signout"
          method="post"
          className="border-t border-rule pt-1.5"
        >
          <button
            type="submit"
            className="w-full px-3.5 py-1.5 text-left text-[0.85rem] text-ink-muted transition-colors hover:text-ink"
          >
            Sign out
          </button>
          <p className="px-3.5 pb-1 text-[0.68rem] leading-snug text-ink-faint">
            Clears the key from this browser. It cannot be revoked, so a copy
            taken earlier stays valid until it expires.
          </p>
        </form>
      </div>
    </div>
  );
}

function MenuLink({
  href,
  children,
  accent,
}: {
  href: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      className={`block px-3.5 py-1.5 text-[0.85rem] transition-colors hover:text-ink ${
        accent ? "font-medium text-accent" : "text-ink-muted"
      }`}
    >
      {children}
    </Link>
  );
}
