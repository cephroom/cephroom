import Link from "next/link";

import { CephroomMark } from "@/components/brand";

const GROUPS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Read",
    links: [
      { href: "/read", label: "Reading now" },
      { href: "/how-it-works", label: "Claim syntax" },
    ],
  },
  {
    title: "Contribute",
    links: [
      { href: "/contribute", label: "Run a node" },
      { href: "/how-it-works#contracts", label: "The contracts" },
      { href: "/pricing", label: "Plans" },
    ],
  },
  {
    title: "Your key",
    links: [
      { href: "/signin", label: "Sign in" },
      { href: "/account", label: "Key and billing" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-rule bg-paper-sunken">
      <div className="mx-auto max-w-6xl px-5 py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-2">
              <CephroomMark duotone className="h-5 w-5 text-accent" />
              <span className="font-serif text-lg font-semibold tracking-[-0.02em]">
                Cephroom
              </span>
            </div>
            <p className="mt-3 max-w-[26ch] text-[0.82rem] leading-relaxed text-ink-muted">
              Science writing with a build step. Nothing about you is stored
              here, and neither is anything anyone writes.
            </p>
          </div>

          {GROUPS.map((group) => (
            <div key={group.title}>
              <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.09em] text-ink-faint">
                {group.title}
              </h2>
              <ul className="mt-3 space-y-2">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-[0.85rem] text-ink-muted transition-colors hover:text-ink"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-rule pt-6 text-[0.78rem] text-ink-faint sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Cephroom. MIT licensed platform.</p>
          <p>
            Binding data derived from ChEMBL under CC BY-SA 3.0. Values are
            reproduced, never imputed.
          </p>
        </div>
      </div>
    </footer>
  );
}
