"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { Plan } from "@/lib/entitlements";

const PLAN_TONE: Record<Plan, string> = {
  free: "text-ink-faint",
  member: "text-accent",
  lab: "text-accent",
};

export function AccountMenu({
  name,
  email,
  handle,
  plan,
  planLabel,
  canWrite,
  signOutAction,
}: {
  name: string;
  email: string | null;
  handle: string | null;
  plan: Plan;
  planLabel: string;
  canWrite: boolean;
  signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

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

  const initial = (name || email || "?").charAt(0).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full border border-rule py-1 pl-1 pr-2.5 transition-colors hover:border-rule-strong"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[0.72rem] font-semibold text-white">
          {initial}
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
        className="absolute right-0 top-[calc(100%+8px)] w-60 rounded-lg border border-rule bg-paper-raised py-1.5 shadow-lg"
      >
        <div className="border-b border-rule px-3.5 pb-2.5 pt-1.5">
          <p className="truncate text-[0.85rem] font-medium">{name}</p>
          <p className="truncate text-[0.75rem] text-ink-faint">{email}</p>
          <p className={`mt-1.5 text-[0.72rem] font-medium ${PLAN_TONE[plan]}`}>
            {planLabel} plan
          </p>
        </div>

        <MenuLink href={handle ? `/authors/${handle}` : "/account"}>
          Profile
        </MenuLink>
        <MenuLink href="/account">Account and billing</MenuLink>
        <MenuLink href="/library">Saved columns</MenuLink>
        {canWrite && <MenuLink href="/studio">Studio</MenuLink>}
        {plan === "free" && (
          <MenuLink href="/pricing" accent>
            Upgrade
          </MenuLink>
        )}

        <form action={signOutAction} className="border-t border-rule pt-1.5">
          <button
            type="submit"
            className="w-full px-3.5 py-1.5 text-left text-[0.85rem] text-ink-muted transition-colors hover:text-ink"
          >
            Sign out
          </button>
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
