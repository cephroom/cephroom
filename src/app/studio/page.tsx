import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";

import { CheckBadge } from "@/components/check-badge";
import { SubmitButton } from "@/components/submit-button";
import type { Conclusion } from "@/lib/claims/verdict";
import { formatDateTime } from "@/lib/columns";
import { db } from "@/lib/db";
import { checkRuns, columns } from "@/lib/db/schema";
import { getViewer } from "@/lib/entitlements";
import { createColumn } from "@/lib/studio/actions";
import { canAuthor } from "@/lib/studio/permissions";

export const metadata: Metadata = { title: "Studio" };

export default async function StudioPage() {
  const viewer = await getViewer();
  if (!viewer.id) redirect("/signin?callbackUrl=/studio");

  if (!canAuthor(viewer)) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16">
        <h1 className="font-serif text-[2rem] font-semibold tracking-[-0.025em]">
          Studio
        </h1>
        <div className="mt-6 rounded-xl border border-rule bg-paper-raised p-6">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-accent">
            Lab feature
          </p>
          <h2 className="mt-2 font-serif text-[1.4rem] font-semibold">
            Writing here needs the Lab plan
          </h2>
          <p className="mt-2 max-w-[54ch] text-[0.92rem] leading-relaxed text-ink-muted">
            The studio gives you private drafts, a live claim checker that
            resolves your queries as you type, and unlimited check runs. Every
            number you write is validated against the dataset before you can
            publish it.
          </p>
          <Link
            href="/pricing?from=/studio"
            className="mt-5 inline-block rounded-md bg-accent px-5 py-2.5 text-[0.88rem] font-medium text-white transition-colors hover:bg-accent-hover"
          >
            See the Lab plan
          </Link>
        </div>
      </main>
    );
  }

  const mine = await db.query.columns.findMany({
    where: eq(columns.authorId, viewer.id),
    orderBy: [desc(columns.updatedAt)],
  });

  const runs = await db.query.checkRuns.findMany({
    orderBy: [desc(checkRuns.createdAt)],
    limit: 200,
  });
  const latestRun = new Map<string, (typeof runs)[number]>();
  for (const run of runs) {
    if (!latestRun.has(run.columnId)) latestRun.set(run.columnId, run);
  }

  const drafts = mine.filter((column) => column.status !== "published");
  const published = mine.filter((column) => column.status === "published");

  return (
    <main className="mx-auto max-w-4xl px-5 py-12 sm:py-16">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-7">
        <div>
          <h1 className="font-serif text-[2.1rem] font-semibold tracking-[-0.025em]">
            Studio
          </h1>
          <p className="mt-2 max-w-[52ch] text-[0.95rem] leading-relaxed text-ink-muted">
            Your columns. Claims are checked as you write and again before
            anything is published.
          </p>
        </div>
        <form action={createColumn}>
          <SubmitButton label="New column" pendingLabel="Creating…" />
        </form>
      </header>

      <Section title="Drafts" empty="Nothing in progress.">
        {drafts.map((column) => (
          <Row
            key={column.id}
            column={column}
            run={latestRun.get(column.id) ?? null}
          />
        ))}
      </Section>

      <Section title="Published" empty="Nothing published yet.">
        {published.map((column) => (
          <Row
            key={column.id}
            column={column}
            run={latestRun.get(column.id) ?? null}
          />
        ))}
      </Section>
    </main>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode[];
}) {
  const items = children.filter(Boolean);
  return (
    <section className="mt-10">
      <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-ink-faint">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="mt-3 rounded-xl border border-rule px-4 py-6 text-center text-[0.88rem] text-ink-muted">
          {empty}
        </p>
      ) : (
        <ul className="mt-2">{items}</ul>
      )}
    </section>
  );
}

function Row({
  column,
  run,
}: {
  column: typeof columns.$inferSelect;
  run: { conclusion: string; nVerified: number; nDrifted: number; nBroken: number } | null;
}) {
  return (
    <li className="border-b border-rule py-4 last:border-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link
          href={`/studio/${column.id}`}
          className="font-serif text-[1.12rem] font-semibold hover:underline"
        >
          {column.title}
        </Link>
        <span className="rounded-full border border-rule px-1.5 py-px text-[0.66rem] uppercase tracking-[0.06em] text-ink-faint">
          {column.access}
        </span>
        {column.status === "published" && (
          <Link
            href={`/columns/${column.slug}`}
            className="text-[0.78rem] text-accent hover:underline"
          >
            view →
          </Link>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.78rem] text-ink-faint">
        <CheckBadge
          conclusion={(run?.conclusion ?? "empty") as Conclusion}
          counts={
            run
              ? {
                  verified: run.nVerified,
                  drifted: run.nDrifted,
                  broken: run.nBroken,
                }
              : undefined
          }
        />
        <span>edited {formatDateTime(column.updatedAt)}</span>
        <span className="font-mono">/{column.slug}</span>
      </div>
    </li>
  );
}
