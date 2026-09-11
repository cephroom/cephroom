import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";

import { CheckBadge } from "@/components/check-badge";
import { RunChecksButton } from "@/components/run-checks-button";
import { formatValue } from "@/lib/claims/syntax";
import type { Conclusion } from "@/lib/claims/verdict";
import { formatDateTime } from "@/lib/columns";
import { db } from "@/lib/db";
import { checkRuns, claimResults, claims, columns } from "@/lib/db/schema";
import { getViewer } from "@/lib/entitlements";
import { rerunChecks } from "@/lib/claims/actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Check history · ${slug}` };
}

const TRIGGER_COPY: Record<string, string> = {
  publish: "on publish",
  manual: "run by hand",
  dataset_release: "dataset release",
  schedule: "scheduled",
};

const VERDICT_TONE = {
  verified: "text-verified",
  drifted: "text-drifted",
  broken: "text-broken",
} as const;

export default async function ChecksPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const viewer = await getViewer();

  const column = await db.query.columns.findFirst({
    where: eq(columns.slug, slug),
  });
  if (!column) notFound();

  const runs = await db.query.checkRuns.findMany({
    where: eq(checkRuns.columnId, column.id),
    orderBy: [desc(checkRuns.createdAt)],
    limit: 25,
  });

  const claimRows = await db.query.claims.findMany({
    where: eq(claims.columnId, column.id),
  });
  const claimById = new Map(claimRows.map((claim) => [claim.id, claim]));

  const results =
    runs.length > 0
      ? await db.query.claimResults.findMany({
          where: inArray(
            claimResults.checkRunId,
            runs.map((run) => run.id),
          ),
        })
      : [];

  const resultsByRun = new Map<string, typeof results>();
  for (const result of results) {
    const list = resultsByRun.get(result.checkRunId) ?? [];
    list.push(result);
    resultsByRun.set(result.checkRunId, list);
  }

  const isAuthor = viewer.id === column.authorId;

  return (
    <main className="mx-auto max-w-[46rem] px-5 py-12 sm:py-16">
      <Link
        href={`/columns/${column.slug}`}
        className="text-[0.82rem] text-ink-faint transition-colors hover:text-ink"
      >
        ← {column.title}
      </Link>

      <header className="mt-6 flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-7">
        <div>
          <h1 className="font-serif text-[1.9rem] font-semibold tracking-[-0.025em]">
            Check history
          </h1>
          <p className="mt-2 max-w-[52ch] text-[0.92rem] leading-relaxed text-ink-muted">
            Every time this column&rsquo;s claims were run against the dataset,
            and what each one returned.
          </p>
        </div>
        {isAuthor && <RunChecksButton action={rerunChecks} columnId={column.id} />}
      </header>

      {runs.length === 0 ? (
        <p className="mt-10 rounded-xl border border-rule bg-paper-raised p-8 text-center text-ink-muted">
          This column has never been checked.
        </p>
      ) : (
        <ol className="mt-8 space-y-5">
          {runs.map((run, index) => {
            const runResults = resultsByRun.get(run.id) ?? [];
            return (
              <li
                key={run.id}
                className="rounded-xl border border-rule bg-paper-raised"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule px-4 py-3">
                  <CheckBadge
                    conclusion={run.conclusion as Conclusion}
                    counts={{
                      verified: run.nVerified,
                      drifted: run.nDrifted,
                      broken: run.nBroken,
                    }}
                  />
                  <span className="text-[0.8rem] text-ink-muted">
                    {TRIGGER_COPY[run.trigger] ?? run.trigger}
                  </span>
                  <span aria-hidden className="text-ink-faint">·</span>
                  <time className="text-[0.8rem] text-ink-muted">
                    {formatDateTime(run.createdAt)}
                  </time>
                  <span className="ml-auto font-mono text-[0.72rem] tnum text-ink-faint">
                    {run.durationMs}ms
                  </span>
                  {index === 0 && (
                    <span className="rounded-full border border-rule px-2 py-0.5 text-[0.68rem] uppercase tracking-[0.06em] text-ink-faint">
                      latest
                    </span>
                  )}
                </div>

                {runResults.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[0.82rem]">
                      <thead>
                        <tr className="border-b border-rule text-left">
                          <Th>Claim</Th>
                          <Th>Authored</Th>
                          <Th>Observed</Th>
                          <Th>Drift</Th>
                          <Th>Verdict</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {runResults.map((result) => {
                          const claim = claimById.get(result.claimId);
                          return (
                            <tr
                              key={result.id}
                              className="border-b border-rule last:border-0"
                            >
                              <td className="px-4 py-2 font-mono text-[0.76rem]">
                                {claim?.key ?? "—"}
                              </td>
                              <td className="px-4 py-2 tnum">
                                {formatValue(
                                  claim?.expectedValue,
                                  claim?.expectedUnit,
                                )}
                              </td>
                              <td className="px-4 py-2 tnum">
                                {formatValue(
                                  result.observedValue,
                                  result.observedUnit,
                                )}
                              </td>
                              <td className="px-4 py-2 tnum text-ink-muted">
                                {result.deltaPct === null
                                  ? "—"
                                  : `${result.deltaPct > 0 ? "+" : ""}${result.deltaPct.toFixed(1)}%`}
                              </td>
                              <td
                                className={`px-4 py-2 font-medium ${VERDICT_TONE[result.verdict]}`}
                              >
                                {result.verdict}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {run.conclusion !== "passing" && runResults.some((r) => r.note) && (
                  <ul className="space-y-1.5 border-t border-rule px-4 py-3">
                    {runResults
                      .filter((result) => result.note)
                      .map((result) => (
                        <li
                          key={`${result.id}-note`}
                          className="text-[0.8rem] leading-relaxed text-ink-muted"
                        >
                          <span className="font-mono text-[0.74rem] text-ink-faint">
                            {claimById.get(result.claimId)?.key}
                          </span>{" "}
                          {result.note}
                        </li>
                      ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.06em] text-ink-faint">
      {children}
    </th>
  );
}
