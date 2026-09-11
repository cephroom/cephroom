import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { ProposalForm } from "@/components/proposal-form";
import { submitProposal } from "@/lib/collab/actions";
import { db } from "@/lib/db";
import { columns } from "@/lib/db/schema";
import { canRead, getViewer } from "@/lib/entitlements";

export const metadata: Metadata = { title: "Propose an edit" };

export default async function ProposePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const viewer = await getViewer();

  const column = await db.query.columns.findFirst({
    where: eq(columns.slug, slug),
    with: { author: true },
  });
  if (!column) notFound();

  if (!viewer.id) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/columns/${slug}/propose`)}`,
    );
  }
  if (!canRead(viewer, column.access)) {
    redirect(`/pricing?from=${encodeURIComponent(`/columns/${slug}`)}`);
  }

  return (
    <main className="mx-auto max-w-4xl px-5 py-12">
      <Link
        href={`/columns/${column.slug}`}
        className="text-[0.82rem] text-ink-faint transition-colors hover:text-ink"
      >
        ← {column.title}
      </Link>

      <header className="mt-6 border-b border-rule pb-6">
        <h1 className="font-serif text-[1.9rem] font-semibold tracking-[-0.025em]">
          Propose an edit
        </h1>
        <p className="mt-2.5 max-w-[60ch] text-[0.95rem] leading-relaxed text-ink-muted">
          Edit the text below and say why. {column.author.name} reviews it as a
          diff and decides. If it is merged, the revision credits you, and the
          checks re-run against the new text before it goes live.
        </p>
      </header>

      <ProposalForm
        columnId={column.id}
        body={column.body}
        action={submitProposal}
      />
    </main>
  );
}
