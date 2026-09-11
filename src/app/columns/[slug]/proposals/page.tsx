import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { proposalsFor } from "@/lib/collab/queries";
import { formatDateTime } from "@/lib/columns";
import { db } from "@/lib/db";
import { columns } from "@/lib/db/schema";
import { diffLines, diffStats } from "@/lib/diff";

export const metadata: Metadata = { title: "Proposals" };

const STATUS_TONE = {
  open: "border-accent/40 bg-accent-wash text-accent",
  merged: "border-verified/30 bg-verified-wash text-verified",
  closed: "border-rule bg-paper-sunken text-ink-muted",
} as const;

export default async function ProposalsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const column = await db.query.columns.findFirst({
    where: eq(columns.slug, slug),
  });
  if (!column) notFound();

  const rows = await proposalsFor(column.id);

  return (
    <main className="mx-auto max-w-[46rem] px-5 py-12">
      <Link
        href={`/columns/${column.slug}`}
        className="text-[0.82rem] text-ink-faint transition-colors hover:text-ink"
      >
        ← {column.title}
      </Link>

      <header className="mt-6 flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-6">
        <div>
          <h1 className="font-serif text-[1.9rem] font-semibold tracking-[-0.025em]">
            Proposals
          </h1>
          <p className="mt-2 text-[0.93rem] text-ink-muted">
            Edits readers have suggested for this column.
          </p>
        </div>
        <Link
          href={`/columns/${column.slug}/propose`}
          className="shrink-0 rounded-md bg-accent px-4 py-2 text-[0.86rem] font-medium text-white transition-colors hover:bg-accent-hover"
        >
          Propose an edit
        </Link>
      </header>

      {rows.length === 0 ? (
        <p className="mt-8 rounded-xl border border-rule px-4 py-10 text-center text-[0.9rem] text-ink-muted">
          Nothing proposed yet.
        </p>
      ) : (
        <ul className="mt-3">
          {rows.map((proposal) => {
            const stats = diffStats(diffLines(column.body, proposal.body));
            return (
              <li key={proposal.id} className="border-b border-rule py-4">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[0.7rem] font-medium capitalize ${STATUS_TONE[proposal.status]}`}
                  >
                    {proposal.status}
                  </span>
                  <Link
                    href={`/proposals/${proposal.id}`}
                    className="font-serif text-[1.08rem] font-semibold hover:underline"
                  >
                    {proposal.title}
                  </Link>
                </div>
                <p className="mt-1.5 text-[0.8rem] text-ink-faint">
                  {proposal.author.name} · {formatDateTime(proposal.createdAt)} ·{" "}
                  <span className="tnum">
                    <span className="text-verified">+{stats.added}</span>{" "}
                    <span className="text-broken">−{stats.removed}</span>
                  </span>
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
