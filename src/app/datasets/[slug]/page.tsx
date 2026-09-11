import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, inArray } from "drizzle-orm";

import { DatasetMatrix, type MatrixCell } from "@/components/dataset-matrix";
import { formatValue } from "@/lib/claims/syntax";
import { db } from "@/lib/db";
import { claims, columns, datasets, facts } from "@/lib/db/schema";
import { getViewer } from "@/lib/entitlements";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const dataset = await db.query.datasets.findFirst({
    where: eq(datasets.slug, slug),
  });
  return dataset
    ? { title: dataset.name, description: dataset.description ?? undefined }
    : { title: "Dataset not found" };
}

const METRICS = [
  {
    id: "median_ki_nm",
    scope: "all",
    label: "Median Ki",
    unit: "nM",
    note: "Median over uncensored point estimates, all assay organisms.",
  },
  {
    id: "median_pki",
    scope: "all",
    label: "Median pKi",
    unit: null,
    note: "The same values in log space, which is where the median is taken.",
  },
  {
    id: "median_pki",
    scope: "human",
    label: "Median pKi (human)",
    unit: null,
    note: "Restricted to assays where the organism is confirmed human and the target was assigned directly.",
  },
] as const;

export default async function DatasetPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ metric?: string; subject?: string; object?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const viewer = await getViewer();

  const dataset = await db.query.datasets.findFirst({
    where: eq(datasets.slug, slug),
  });
  if (!dataset) notFound();

  const selected =
    METRICS.find((metric) => `${metric.id}:${metric.scope}` === query.metric) ??
    METRICS[0];

  const rows = await db.query.facts.findMany({
    where: eq(facts.datasetId, dataset.id),
  });

  const subjects = [...new Set(rows.map((row) => row.subject))].sort();
  const objects = [...new Set(rows.map((row) => row.object))].sort();

  const cells = new Map<string, MatrixCell>();
  for (const row of rows) {
    if (row.metric !== selected.id || row.scope !== selected.scope) continue;
    cells.set(`${row.subject}|${row.object}`, {
      display: formatValue(row.value, null),
      nPoints: row.nPoints,
      nDocs: row.nDocs,
    });
  }

  const empty: string[] = [];
  for (const subject of subjects) {
    for (const object of objects) {
      if (!cells.has(`${subject}|${object}`)) empty.push(`${subject} × ${object}`);
    }
  }

  // Which published columns cite this dataset.
  const citing = await db.query.claims.findMany({
    where: eq(claims.datasetSlug, dataset.slug),
    columns: { columnId: true },
  });
  const columnIds = [...new Set(citing.map((claim) => claim.columnId))];
  const citingColumns =
    columnIds.length > 0
      ? await db.query.columns.findMany({
          where: inArray(columns.id, columnIds),
          columns: { slug: true, title: true, status: true, access: true },
        })
      : [];

  const coverage = dataset.provenance?.coverage;
  const canExplore = viewer.plan !== "free";

  return (
    <main className="mx-auto max-w-6xl px-5 py-12 sm:py-16">
      <Link
        href="/datasets"
        className="text-[0.82rem] text-ink-faint transition-colors hover:text-ink"
      >
        ← All datasets
      </Link>

      <header className="mt-6 border-b border-rule pb-8">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.78rem] text-ink-faint">
          <span>{dataset.source}</span>
          <span aria-hidden>·</span>
          <span className="font-mono">{dataset.release}</span>
          <span aria-hidden>·</span>
          <span>snapshot v{dataset.version}</span>
          {dataset.generatedAt && (
            <>
              <span aria-hidden>·</span>
              <span>generated {dataset.generatedAt.toISOString().slice(0, 10)}</span>
            </>
          )}
        </div>

        <h1 className="mt-3 font-serif text-[2rem] font-semibold tracking-[-0.025em] sm:text-[2.4rem]">
          {dataset.name}
        </h1>
        <p className="mt-3 max-w-[64ch] text-[1rem] leading-relaxed text-ink-muted">
          {dataset.description}
        </p>
      </header>

      {/* ------------------------------------------------- Coverage ladder */}
      {coverage && (
        <section className="mt-10">
          <h2 className="font-serif text-[1.35rem] font-semibold tracking-[-0.02em]">
            Coverage is a ladder, not a number
          </h2>
          <p className="mt-2 max-w-[62ch] text-[0.92rem] leading-relaxed text-ink-muted">
            Each row is a strictly stronger claim than the one above it. Which
            one you should quote depends entirely on what you intend to do next.
          </p>

          <div className="mt-5 overflow-x-auto rounded-xl border border-rule">
            <table className="w-full text-[0.88rem]">
              <thead>
                <tr className="border-b border-rule bg-paper-sunken text-left">
                  <Th>Tier</Th>
                  <Th>Cells</Th>
                  <Th>Means</Th>
                </tr>
              </thead>
              <tbody>
                <LadderRow
                  tier="evidence_coverage"
                  value={coverage.evidence_coverage}
                  total={coverage.n_cells_total}
                  meaning="any measurement at all, censored included"
                />
                <LadderRow
                  tier="point_coverage"
                  value={coverage.point_coverage}
                  total={coverage.n_cells_total}
                  meaning="at least one uncensored point estimate"
                />
                <LadderRow
                  tier="human_point_coverage"
                  value={coverage.human_point_coverage}
                  total={coverage.n_cells_total}
                  meaning="organism confirmed human, target assigned directly"
                />
                <LadderRow
                  tier="human_cloned_point_coverage"
                  value={coverage.human_cloned_point_coverage}
                  total={coverage.n_cells_total}
                  meaning="and the assay format indicates a cloned preparation"
                />
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Callout
              label={`${coverage.n_censored_only_cells} censored-only cells`}
            >
              Reported separately and never folded into the empty count. A
              result of <code className="font-mono">&gt;10000 nM</code> is a
              measurement, and for working out what a compound does{" "}
              <em>not</em> hit it is the most useful kind of data point there
              is.
            </Callout>
            <Callout label={`${coverage.n_empty_cells} cells with no data`}>
              Listed by name below rather than imputed. Family-level and
              non-human data exist for some of them; none of it goes in,
              because a cell filled by inference is not the same object as a
              cell filled by measurement.
            </Callout>
          </div>
        </section>
      )}

      {/* --------------------------------------------------------- Matrix */}
      <section className="mt-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-serif text-[1.35rem] font-semibold tracking-[-0.02em]">
              The matrix
            </h2>
            <p className="mt-1.5 max-w-[58ch] text-[0.9rem] leading-relaxed text-ink-muted">
              {selected.note}
            </p>
          </div>
        </div>

        <nav className="mt-4 flex flex-wrap gap-2" aria-label="Metric">
          {METRICS.map((metric) => {
            const key = `${metric.id}:${metric.scope}`;
            const active = key === `${selected.id}:${selected.scope}`;
            return (
              <Link
                key={key}
                href={`/datasets/${dataset.slug}?metric=${encodeURIComponent(key)}`}
                scroll={false}
                aria-current={active ? "true" : undefined}
                className={`rounded-md border px-3 py-1.5 text-[0.83rem] font-medium transition-colors ${
                  active
                    ? "border-accent bg-accent text-white"
                    : "border-rule text-ink-muted hover:border-rule-strong hover:text-ink"
                }`}
              >
                {metric.label}
              </Link>
            );
          })}
        </nav>

        {canExplore ? (
          <DatasetMatrix
            subjects={subjects}
            objects={objects}
            cells={cells}
            unit={selected.unit}
            highlight={
              query.subject && query.object
                ? { subject: query.subject, object: query.object }
                : null
            }
          />
        ) : (
          <div className="mt-5 rounded-xl border border-rule bg-paper-raised p-6">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-accent">
              Member feature
            </p>
            <h3 className="mt-2 font-serif text-[1.3rem] font-semibold">
              The full matrix, with the evidence behind every cell
            </h3>
            <p className="mt-2 max-w-[54ch] text-[0.92rem] leading-relaxed text-ink-muted">
              {subjects.length} targets × {objects.length} compounds, each cell
              showing its value alongside the number of measurements and
              distinct papers behind it.
            </p>
            <Link
              href={`/pricing?from=${encodeURIComponent(`/datasets/${dataset.slug}`)}`}
              className="mt-5 inline-block rounded-md bg-accent px-5 py-2.5 text-[0.88rem] font-medium text-white transition-colors hover:bg-accent-hover"
            >
              See plans — from $9/month
            </Link>
          </div>
        )}

        {empty.length > 0 && (
          <p className="mt-4 text-[0.83rem] leading-relaxed text-ink-muted">
            <span className="font-medium text-ink">
              Empty at this metric and scope:
            </span>{" "}
            {empty.join(", ")}.
          </p>
        )}
      </section>

      {/* ----------------------------------------------------- Provenance */}
      {dataset.provenance?.notes && (
        <section className="mt-12">
          <h2 className="font-serif text-[1.35rem] font-semibold tracking-[-0.02em]">
            How this snapshot was made
          </h2>
          {dataset.provenance.pipeline && (
            <p className="mt-2 font-mono text-[0.82rem] text-ink-muted">
              {dataset.provenance.pipeline}
            </p>
          )}
          <ul className="mt-4 space-y-2.5">
            {dataset.provenance.notes.map((note) => (
              <li
                key={note}
                className="flex gap-2.5 text-[0.9rem] leading-relaxed text-ink-muted"
              >
                <span aria-hidden className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                {note}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------ Citing columns */}
      {citingColumns.length > 0 && (
        <section className="mt-12 border-t border-rule pt-8">
          <h2 className="font-serif text-[1.35rem] font-semibold tracking-[-0.02em]">
            Columns resolving against this dataset
          </h2>
          <p className="mt-1.5 text-[0.88rem] text-ink-muted">
            Re-importing this dataset re-runs every claim in each of these.
          </p>
          <ul className="mt-4 space-y-2.5">
            {citingColumns.map((column) => (
              <li key={column.slug}>
                <Link
                  href={`/columns/${column.slug}`}
                  className="font-serif text-[1.02rem] font-semibold hover:underline"
                >
                  {column.title}
                </Link>
                {column.access !== "public" && (
                  <span className="ml-2 text-[0.72rem] uppercase tracking-[0.06em] text-ink-faint">
                    {column.access}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-[0.72rem] font-semibold uppercase tracking-[0.06em] text-ink-faint">
      {children}
    </th>
  );
}

function LadderRow({
  tier,
  value,
  total,
  meaning,
}: {
  tier: string;
  value: number | undefined;
  total: number | undefined;
  meaning: string;
}) {
  if (value === undefined || total === undefined) return null;
  return (
    <tr className="border-b border-rule last:border-0">
      <td className="px-4 py-2.5 font-mono text-[0.8rem]">{tier}</td>
      <td className="whitespace-nowrap px-4 py-2.5 tnum">
        {value}/{total}{" "}
        <span className="text-ink-faint">
          ({Math.round((value / total) * 100)}%)
        </span>
      </td>
      <td className="px-4 py-2.5 text-ink-muted">{meaning}</td>
    </tr>
  );
}

function Callout({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-rule bg-paper-raised p-4">
      <p className="text-[0.8rem] font-semibold">{label}</p>
      <p className="mt-1.5 text-[0.85rem] leading-relaxed text-ink-muted">
        {children}
      </p>
    </div>
  );
}
