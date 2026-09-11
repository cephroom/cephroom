import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { SubmitButton } from "@/components/submit-button";
import { forkColumn } from "@/lib/collab/actions";
import { db } from "@/lib/db";
import { columns } from "@/lib/db/schema";
import { canRead, getViewer } from "@/lib/entitlements";

export const metadata: Metadata = { title: "Fork a column" };

export default async function ForkPage({
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
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/columns/${slug}/fork`)}`);
  }
  if (!canRead(viewer, column.access)) {
    redirect(`/pricing?from=${encodeURIComponent(`/columns/${slug}`)}`);
  }

  return (
    <main className="mx-auto max-w-[40rem] px-5 py-14">
      <Link
        href={`/columns/${column.slug}`}
        className="text-[0.82rem] text-ink-faint transition-colors hover:text-ink"
      >
        ← {column.title}
      </Link>

      <h1 className="mt-6 font-serif text-[1.9rem] font-semibold tracking-[-0.025em]">
        Fork this column
      </h1>

      <p className="mt-3 text-[1rem] leading-relaxed text-ink-muted">
        You get a private draft containing the full text and every claim,
        attributed to {column.author.name} as its origin. Change what you
        disagree with and publish your own version; the lineage stays on the
        page, so a reader can always get back to what you forked from.
      </p>

      <div className="mt-6 rounded-xl border border-rule bg-paper-raised p-5">
        <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-ink-faint">
          What a fork is not
        </h2>
        <ul className="mt-3 space-y-2 text-[0.88rem] leading-relaxed text-ink-muted">
          <li>
            It is not a live mirror. The copy is taken now and does not follow
            later edits to the original — a fork is a claim that your version
            stands on its own.
          </li>
          <li>
            It is not a proposal. If you want the author to take your change,{" "}
            <Link
              href={`/columns/${column.slug}/propose`}
              className="font-medium text-accent hover:underline"
            >
              open a proposal
            </Link>{" "}
            instead and they will review it as a diff.
          </li>
        </ul>
      </div>

      <form action={forkColumn} className="mt-7">
        <input type="hidden" name="columnId" value={column.id} />
        <SubmitButton
          label="Fork into a draft"
          pendingLabel="Copying…"
          variant="primary"
        />
      </form>
    </main>
  );
}
