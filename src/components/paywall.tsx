import Link from "next/link";

import type { Access, Tier } from "@/lib/access";

const REQUIRED_LABEL: Record<Exclude<Access, "public">, string> = {
  member: "Member",
  lab: "Lab",
};

/**
 * The gate shown where a column is cut off. It states plainly what is behind
 * it and how much, rather than hiding the price behind a second click.
 */
export function Paywall({
  access,
  tier,
  signedIn,
  hiddenBlocks,
  claimCount,
  returnTo,
}: {
  access: Exclude<Access, "public">;
  tier: Tier;
  signedIn: boolean;
  hiddenBlocks: number;
  claimCount: number;
  returnTo: string;
}) {
  const needsUpgrade = signedIn && tier !== "reader";

  return (
    <div className="relative mt-2">
      {/* The fade sits above the last visible paragraph, not over the gate. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-28 h-28 bg-gradient-to-b from-transparent to-paper"
      />

      <div className="rounded-xl border border-rule bg-paper-raised p-6 sm:p-8">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.09em] text-accent">
          {REQUIRED_LABEL[access]} column
        </p>

        <h2 className="mt-2 font-serif text-[1.45rem] font-semibold leading-snug tracking-[-0.02em]">
          {needsUpgrade
            ? `This one needs the ${REQUIRED_LABEL[access]} plan`
            : "Keep reading with a membership"}
        </h2>

        <p className="mt-2.5 max-w-[52ch] text-[0.92rem] leading-relaxed text-ink-muted">
          {hiddenBlocks} more sections and {claimCount} checked claims with
          their full provenance, for as long as the author is serving it.
        </p>

        <ul className="mt-5 space-y-2 text-[0.88rem] text-ink-muted">
          <Perk>Member columns in full, from whoever is serving them</Perk>
          <Perk>The claim inspector: query, evidence count, and drift</Perk>
          <Perk>Your key verified by the node, not by us</Perk>
          <Perk>No account created, here or anywhere</Perk>
        </ul>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            href={`/pricing?from=${encodeURIComponent(returnTo)}`}
            className="rounded-md bg-accent px-5 py-2.5 text-[0.9rem] font-medium text-white transition-colors hover:bg-accent-hover"
          >
            {needsUpgrade
              ? `Upgrade to ${REQUIRED_LABEL[access]}`
              : "See plans — from $9/month"}
          </Link>
          {!signedIn && (
            <Link
              href={`/signin?next=${encodeURIComponent(returnTo)}`}
              className="text-[0.9rem] font-medium text-ink-muted transition-colors hover:text-ink"
            >
              Already a member? Sign in
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function Perk({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <svg
        viewBox="0 0 16 16"
        className="mt-[3px] h-3.5 w-3.5 shrink-0 text-accent"
        aria-hidden
      >
        <path
          d="M3 8.4l3.2 3.2L13 4.8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      <span>{children}</span>
    </li>
  );
}
