import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";

import { CheckBadge } from "@/components/check-badge";
import type { Conclusion } from "@/lib/claims/verdict";
import { formatDateTime } from "@/lib/columns";
import { db } from "@/lib/db";
import { checkRuns, columns } from "@/lib/db/schema";

export const metadata: Metadata = {
  title: "Check activity",
  description:
    "Every claim check run across the publication, newest first, with the columns that need attention at the top.",
};

const TRIGGER_COPY: Record<string, string> = {
  publish: "on publish",
  manual: "run by hand",
  dataset_release: "dataset release",
  schedule: "scheduled",
};

export default async function ChecksPage() {
  const published = await db.query.columns.findMany({
    where: eq(columns.status, "published"),
    columns: { id: true, slug: true, title: true },
  });
  const columnById = new Map(published.map((column) => [column.id, column]));

  const runs =
    published.length > 0
      ? await db.query.checkRuns.findMany({
          where: inArray(
            checkRuns.columnId,
            published.map((column) => column.id),
          ),
          orderBy: [desc(checkRuns.createdAt)],
          limit: 50,
        })
      : [];

  // The latest run per column is what the badge on a column actually shows.
  const latestByColumn = new Map<string, (typeof runs)[number]>();
  for (const run of runs) {
    if (!latestByColumn.has(run.columnId)) latestByColumn.set(run.columnId, run);
  }

  const needsAttention = [...latestByColumn.values()].filter(
    (run) => run.conclusion === "drifted" || run.conclusion === "broken",
  );

  const totals = [...latestByColumn.values()].reduce(
    (sum, run) => ({
      verified: sum.verified + run.nVerified,
      drifted: sum.drifted + run.nDrifted,
      broken: sum.broken + run.nBroken,
    }),
    { verified: 0, drifted: 0, broken: 0 },
  );

  return (
    <main className="mx-auto max-w-[46rem] px-5 py-12 sm:py-16">
      <header className="border-b border-rule pb-8">
        <h1 className="font-serif text-[2.1rem] font-semibold tracking-[-0.025em] sm:text-[2.4rem]">
          Check activity
        </h1>
        <p className="mt-3 max-w-[56ch] text-[1rem] leading-relaxed text-ink-muted">
          The build status of the whole publication. Every claim in every
          published column, as of its most recent run.
        </p>

        <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-[0.82rem]">
          <Total label="Verified" value={totals.verified} tone="text-verified" />
          <Total label="Drifted" value={totals.drifted} tone="text-drifted" />
          <Total label="Broken" value={totals.broken} tone="text-broken" />
        </dl>
      </header>

      {needsAttention.length > 0 && (
        <section className="mt-8">
          <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-drifted">
            Needs attention
          </h2>
          <ul className="mt-3 space-y-2">
            {needsAttention.map((run) => {
              const column = columnById.get(run.columnId);
              if (!column) return null;
              return (
                <li
                  key={run.id}
                  className="rounded-lg border border-drifted/30 bg-drifted-wash/40 px-4 py-3"
                >
                  <Link
                    href={`/columns/${column.slug}/checks`}
                    className="font-serif text-[1.02rem] font-semibold hover:underline"
                  >
                    {column.title}
                  </Link>
                  <p className="mt-1 text-[0.82rem] text-ink-muted">
                    {run.nDrifted > 0 &&
                      `${run.nDrifted} claim${run.nDrifted === 1 ? "" : "s"} drifted`}
                    {run.nDrifted > 0 && run.nBroken > 0 && ", "}
                    {run.nBroken > 0 &&
                      `${run.nBroken} claim${run.nBroken === 1 ? "" : "s"} broken`}
                    {" · last run "}
                    {formatDateTime(run.createdAt)}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-ink-faint">
          All runs
        </h2>

        {runs.length === 0 ? (
          <p className="mt-4 rounded-xl border border-rule bg-paper-raised p-8 text-center text-ink-muted">
            Nothing has been checked yet.
          </p>
        ) : (
          <ol className="mt-3">
            {runs.map((run) => {
              const column = columnById.get(run.columnId);
              if (!column) return null;
              return (
                <li
                  key={run.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-rule py-3 last:border-0"
                >
                  <CheckBadge
                    conclusion={run.conclusion as Conclusion}
                    counts={{
                      verified: run.nVerified,
                      drifted: run.nDrifted,
                      broken: run.nBroken,
                    }}
                  />
                  <Link
                    href={`/columns/${column.slug}/checks`}
                    className="text-[0.9rem] hover:underline"
                  >
                    {column.title}
                  </Link>
                  <span className="ml-auto flex shrink-0 items-center gap-2 text-[0.76rem] text-ink-faint">
                    <span>{TRIGGER_COPY[run.trigger] ?? run.trigger}</span>
                    <time>{formatDateTime(run.createdAt)}</time>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
}

function Total({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div>
      <dt className="text-ink-faint">{label}</dt>
      <dd className={`mt-0.5 font-mono text-[1.2rem] tnum ${tone}`}>{value}</dd>
    </div>
  );
}
