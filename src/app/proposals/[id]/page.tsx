import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { DiffView } from "@/components/diff-view";
import { ProposalDecision } from "@/components/proposal-decision";
import { closeProposal, mergeProposal } from "@/lib/collab/actions";
import { formatDateTime } from "@/lib/columns";
import { db } from "@/lib/db";
import { columns, proposals, revisions } from "@/lib/db/schema";
import { diffLines, diffStats, toHunks } from "@/lib/diff";
import { getViewer } from "@/lib/entitlements";

export const metadata: Metadata = { title: "Proposal" };

const STATUS_TONE = {
  open: "border-accent/40 bg-accent-wash text-accent",
  merged: "border-verified/30 bg-verified-wash text-verified",
  closed: "border-rule bg-paper-sunken text-ink-muted",
} as const;

export default async function ProposalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await getViewer();

  const proposal = await db.query.proposals.findFirst({
    where: eq(proposals.id, id),
    with: { author: true },
  });
  if (!proposal) notFound();

  const column = await db.query.columns.findFirst({
    where: eq(columns.id, proposal.columnId),
    with: { author: true },
  });
  if (!column) notFound();

  // Diff against the revision the proposal was written from, not against
  // whatever the column says now - otherwise later edits look like the
  // proposer's work.
  const base = proposal.baseRevisionId
    ? await db.query.revisions.findFirst({
        where: eq(revisions.id, proposal.baseRevisionId),
      })
    : null;
  const baseBody = base?.body ?? column.body;

  const lines = diffLines(baseBody, proposal.body);
  const hunks = toHunks(lines);
  const stats = diffStats(lines);

  const canDecide =
    Boolean(viewer.id) &&
    (viewer.id === column.authorId || viewer.role === "editor");

  // Whether the column has moved on since this proposal was written.
  const stale = base ? base.body.trim() !== column.body.trim() : false;

  return (
    <main className="mx-auto max-w-4xl px-5 py-12">
      <Link
        href={`/columns/${column.slug}/proposals`}
        className="text-[0.82rem] text-ink-faint transition-colors hover:text-ink"
      >
        ← Proposals on {column.title}
      </Link>

      <header className="mt-6 border-b border-rule pb-6">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`rounded-full border px-2.5 py-1 text-[0.74rem] font-medium capitalize ${STATUS_TONE[proposal.status]}`}
          >
            {proposal.status}
          </span>
          <span className="text-[0.82rem] tnum">
            <span className="text-verified">+{stats.added}</span>{" "}
            <span className="text-broken">−{stats.removed}</span>
          </span>
        </div>

        <h1 className="mt-3 font-serif text-[1.8rem] font-semibold leading-snug tracking-[-0.025em]">
          {proposal.title}
        </h1>

        <p className="mt-2.5 text-[0.85rem] text-ink-muted">
          Proposed by {proposal.author.name} ·{" "}
          {formatDateTime(proposal.createdAt)}
          {base && ` · against revision ${base.number}`}
        </p>
      </header>

      {proposal.rationale && (
        <section className="mt-6 rounded-xl border border-rule bg-paper-raised p-5">
          <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-ink-faint">
            Why
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-[0.94rem] leading-relaxed">
            {proposal.rationale}
          </p>
        </section>
      )}

      {stale && proposal.status === "open" && (
        <p className="mt-5 rounded-lg border border-drifted/30 bg-drifted-wash px-4 py-3 text-[0.85rem] leading-relaxed text-drifted">
          The column has changed since this proposal was written. Merging will
          replace the current text with the proposal in full, so read the diff
          against the live version before deciding.
        </p>
      )}

      <section className="mt-7">
        <h2 className="mb-3 text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-ink-faint">
          Changes
        </h2>
        {hunks.length === 0 ? (
          <p className="rounded-xl border border-rule px-4 py-8 text-center text-[0.88rem] text-ink-muted">
            No differences against the base revision.
          </p>
        ) : (
          <DiffView hunks={hunks} />
        )}
      </section>

      {proposal.status === "open" && canDecide && (
        <ProposalDecision
          proposalId={proposal.id}
          mergeAction={mergeProposal}
          closeAction={closeProposal}
        />
      )}

      {proposal.status !== "open" && (
        <p className="mt-7 rounded-xl border border-rule bg-paper-sunken px-4 py-3 text-[0.86rem] text-ink-muted">
          {proposal.status === "merged"
            ? "Merged into the column. The revision credits the proposer, and the checks re-ran against the new text."
            : "Closed without merging."}
          {proposal.resolvedAt && ` ${formatDateTime(proposal.resolvedAt)}.`}
        </p>
      )}
    </main>
  );
}
