"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { DatasetMatrix, type MatrixCell } from "@/components/dataset-matrix";
import { formatValue } from "@/lib/claims/syntax";

/**
 * The dataset explorer, fetched from the node serving it.
 *
 * Same rule as a column: the bytes come from the contributor's machine to
 * yours, and the platform is not in the path. The coverage ladder is shown to
 * everyone because it is the honest part — what is known and what is not —
 * and the matrix itself is where the membership sits.
 */

interface Fact {
  subject: string;
  object: string;
  metric: string;
  scope: string;
  value: number;
  unit: string | null;
  nPoints: number | null;
  nDocs: number | null;
}

interface Dataset {
  id: string;
  name: string;
  description: string;
  source: string;
  release: string;
  generatedAt: string;
  coverage: Record<string, number>;
  notes: string[];
  facts: Fact[];
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

export function DatasetReader({
  address,
  servedBy,
  datasetId,
  canExplore,
}: {
  address: string;
  servedBy: string;
  datasetId: string;
  canExplore: boolean;
}) {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `${address}/dataset/${encodeURIComponent(datasetId)}`,
        );
        if (!response.ok) throw new Error(`node returned ${response.status}`);
        const json = (await response.json()) as Dataset;
        if (!cancelled) setDataset(json);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "unreachable");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, datasetId]);

  const metric = METRICS[selected];

  const { subjects, objects, cells, empty } = useMemo(() => {
    if (!dataset) {
      return {
        subjects: [] as string[],
        objects: [] as string[],
        cells: new Map<string, MatrixCell>(),
        empty: [] as string[],
      };
    }

    const subjects = [...new Set(dataset.facts.map((f) => f.subject))].sort();
    const objects = [...new Set(dataset.facts.map((f) => f.object))].sort();

    const cells = new Map<string, MatrixCell>();
    for (const fact of dataset.facts) {
      if (fact.metric !== metric.id || fact.scope !== metric.scope) continue;
      cells.set(`${fact.subject}|${fact.object}`, {
        display: formatValue(fact.value, null),
        nPoints: fact.nPoints,
        nDocs: fact.nDocs,
      });
    }

    const empty: string[] = [];
    for (const subject of subjects) {
      for (const object of objects) {
        if (!cells.has(`${subject}|${object}`)) {
          empty.push(`${subject} × ${object}`);
        }
      }
    }

    return { subjects, objects, cells, empty };
  }, [dataset, metric]);

  if (error) {
    return (
      <main className="mx-auto max-w-[40rem] px-5 py-20">
        <h1 className="font-serif text-[1.8rem] font-semibold tracking-[-0.025em]">
          {servedBy}&rsquo;s node stopped answering
        </h1>
        <p className="mt-4 text-[0.98rem] leading-relaxed text-ink-muted">
          Nothing is cached here to show instead.
        </p>
        <p className="mt-2 font-mono text-[0.78rem] text-ink-faint">
          {address} — {error}
        </p>
      </main>
    );
  }

  if (!dataset) {
    return (
      <main className="mx-auto max-w-6xl px-5 py-20">
        <p className="text-[0.9rem] text-ink-muted">
          Fetching from {servedBy}&rsquo;s machine…
        </p>
      </main>
    );
  }

  const coverage = dataset.coverage;

  return (
    <main className="mx-auto max-w-6xl px-5 py-12 sm:py-16">
      <Link
        href="/read"
        className="text-[0.82rem] text-ink-faint transition-colors hover:text-ink"
      >
        ← Reading now
      </Link>

      <header className="mt-6 border-b border-rule pb-8">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.78rem] text-ink-faint">
          <span>{dataset.source}</span>
          <span aria-hidden>·</span>
          <span className="font-mono">{dataset.release}</span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-verified" aria-hidden />
            served by {servedBy}
          </span>
        </div>

        <h1 className="mt-3 font-serif text-[2rem] font-semibold tracking-[-0.025em] sm:text-[2.4rem]">
          {dataset.name}
        </h1>
        <p className="mt-3 max-w-[64ch] text-[1rem] leading-relaxed text-ink-muted">
          {dataset.description}
        </p>
      </header>

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
                <Ladder
                  tier="evidence_coverage"
                  value={coverage.evidence_coverage}
                  total={coverage.n_cells_total}
                  meaning="any measurement at all, censored included"
                />
                <Ladder
                  tier="point_coverage"
                  value={coverage.point_coverage}
                  total={coverage.n_cells_total}
                  meaning="at least one uncensored point estimate"
                />
                <Ladder
                  tier="human_point_coverage"
                  value={coverage.human_point_coverage}
                  total={coverage.n_cells_total}
                  meaning="organism confirmed human, target assigned directly"
                />
                <Ladder
                  tier="human_cloned_point_coverage"
                  value={coverage.human_cloned_point_coverage}
                  total={coverage.n_cells_total}
                  meaning="and the assay format indicates a cloned preparation"
                />
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Callout label={`${coverage.n_censored_only_cells} censored-only cells`}>
              Reported separately and never folded into the empty count. A
              result of <code className="font-mono">&gt;10000 nM</code> is a
              measurement, and for working out what a compound does <em>not</em>{" "}
              hit it is the most useful kind of data point there is.
            </Callout>
            <Callout label={`${coverage.n_empty_cells} cells with no data`}>
              Listed by name below rather than imputed. A cell filled by
              inference is not the same object as a cell filled by measurement.
            </Callout>
          </div>
        </section>
      )}

      <section className="mt-12">
        <h2 className="font-serif text-[1.35rem] font-semibold tracking-[-0.02em]">
          The matrix
        </h2>
        <p className="mt-1.5 max-w-[58ch] text-[0.9rem] leading-relaxed text-ink-muted">
          {metric.note}
        </p>

        <nav className="mt-4 flex flex-wrap gap-2" aria-label="Metric">
          {METRICS.map((option, index) => (
            <button
              key={option.label}
              type="button"
              onClick={() => setSelected(index)}
              aria-pressed={index === selected}
              className={`rounded-md border px-3 py-1.5 text-[0.83rem] font-medium transition-colors ${
                index === selected
                  ? "border-accent bg-accent text-white"
                  : "border-rule text-ink-muted hover:border-rule-strong hover:text-ink"
              }`}
            >
              {option.label}
            </button>
          ))}
        </nav>

        {canExplore ? (
          <DatasetMatrix
            subjects={subjects}
            objects={objects}
            cells={cells}
            unit={metric.unit}
            highlight={null}
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
              href="/pricing"
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

      {dataset.notes.length > 0 && (
        <section className="mt-12">
          <h2 className="font-serif text-[1.35rem] font-semibold tracking-[-0.02em]">
            How this snapshot was made
          </h2>
          <ul className="mt-4 space-y-2.5">
            {dataset.notes.map((note) => (
              <li
                key={note}
                className="flex gap-2.5 text-[0.9rem] leading-relaxed text-ink-muted"
              >
                <span
                  aria-hidden
                  className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-accent"
                />
                {note}
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

function Ladder({
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
