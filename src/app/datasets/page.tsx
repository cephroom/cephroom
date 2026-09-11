import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { facts } from "@/lib/db/schema";

export const metadata: Metadata = {
  title: "Datasets",
  description:
    "The versioned evidence layer that Bindery claims are checked against.",
};

export default async function DatasetsPage() {
  const rows = await db.query.datasets.findMany();

  const counts = await db
    .select({
      datasetId: facts.datasetId,
      n: sql<number>`count(*)`.as("n"),
    })
    .from(facts)
    .groupBy(facts.datasetId);
  const countBy = new Map(counts.map((row) => [row.datasetId, row.n]));

  return (
    <main className="mx-auto max-w-6xl px-5 py-12 sm:py-16">
      <header className="max-w-[58ch] border-b border-rule pb-8">
        <h1 className="font-serif text-[2.1rem] font-semibold tracking-[-0.025em] sm:text-[2.6rem]">
          Datasets
        </h1>
        <p className="mt-3 text-[1rem] leading-relaxed text-ink-muted">
          A claim is only as good as the snapshot it resolves against. Every
          dataset here is pinned to an upstream release, carries its own
          coverage accounting, and never fills an empty cell with an inference.
        </p>
      </header>

      <ul className="mt-2">
        {rows.map((dataset) => {
          const coverage = dataset.provenance?.coverage;
          return (
            <li key={dataset.id} className="border-b border-rule py-7">
              <Link href={`/datasets/${dataset.slug}`} className="group block">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.78rem] text-ink-faint">
                  <span>{dataset.source}</span>
                  <span aria-hidden>·</span>
                  <span className="font-mono">{dataset.release}</span>
                  <span aria-hidden>·</span>
                  <span>snapshot v{dataset.version}</span>
                </div>

                <h2 className="mt-2 font-serif text-[1.35rem] font-semibold tracking-[-0.015em] decoration-accent/40 underline-offset-4 group-hover:underline">
                  {dataset.name}
                </h2>

                <p className="mt-2 max-w-[64ch] text-[0.92rem] leading-relaxed text-ink-muted">
                  {dataset.description}
                </p>

                <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-[0.8rem]">
                  <Stat label="Cells" value={String(countBy.get(dataset.id) ?? 0)} />
                  {coverage?.point_coverage !== undefined && (
                    <Stat
                      label="Point coverage"
                      value={`${coverage.point_coverage}/${coverage.n_cells_total}`}
                    />
                  )}
                  {coverage?.human_point_coverage !== undefined && (
                    <Stat
                      label="Human point coverage"
                      value={`${coverage.human_point_coverage}/${coverage.n_cells_total}`}
                    />
                  )}
                  {coverage?.n_empty_cells !== undefined && (
                    <Stat
                      label="Empty, listed by name"
                      value={String(coverage.n_empty_cells)}
                    />
                  )}
                </dl>
              </Link>
            </li>
          );
        })}
      </ul>

      {rows.length === 0 && (
        <p className="mt-10 rounded-xl border border-rule bg-paper-raised p-8 text-center text-ink-muted">
          No datasets imported yet.
        </p>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-faint">{label}</dt>
      <dd className="mt-0.5 font-mono text-[0.95rem] tnum">{value}</dd>
    </div>
  );
}
