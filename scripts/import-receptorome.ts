/**
 * Imports the receptorome ChEMBL Ki snapshot into the `dataset` / `fact`
 * tables. This is the evidence layer that Claim CI checks columns against.
 *
 * The source of truth is the receptorome pipeline
 * (https://github.com/jtchang/receptorome). Its published report artefacts are
 * vendored under data/receptorome/ so this repository seeds without a network
 * call, and so the exact snapshot a claim was checked against stays pinned.
 *
 * Re-running bumps the dataset version, which is what makes a stored claim
 * result "stale" and schedules the column for re-checking.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";

import { datasets, facts } from "../src/lib/db/schema";
import type { Database } from "./db";

const SNAPSHOT_DIR = join(process.cwd(), "data", "receptorome");

export const RECEPTOROME_SLUG = "receptorome-ki";

interface Matrix {
  rowKey: string;
  columns: string[];
  rows: { key: string; cells: (number | null)[] }[];
}

function readMatrix(file: string): Matrix {
  const text = readFileSync(join(SNAPSHOT_DIR, file), "utf8").trim();
  const [header, ...lines] = text.split(/\r?\n/);
  const [rowKey, ...columns] = header.split(",");
  const rows = lines.map((line) => {
    const [key, ...values] = line.split(",");
    return {
      key,
      cells: values.map((raw) => {
        const trimmed = raw.trim();
        if (trimmed === "") return null;
        const value = Number.parseFloat(trimmed);
        return Number.isFinite(value) ? value : null;
      }),
    };
  });
  return { rowKey, columns, rows };
}

interface FactRow {
  subject: string;
  object: string;
  metric: string;
  scope: string;
  value: number | null;
  unit: string | null;
  nPoints: number | null;
  nDocs: number | null;
}

/**
 * Values carry more significant figures than the underlying measurements
 * justify - the medians come out of float arithmetic over reported values.
 * Round to four significant figures so the stored number is honest about its
 * precision, and so a claim does not "drift" on a floating point artefact.
 */
function round4sf(value: number | null): number | null {
  if (value === null) return null;
  if (value === 0) return 0;
  return Number.parseFloat(value.toPrecision(4));
}

export function buildFactRows(): FactRow[] {
  const kiNm = readMatrix("matrix_median_ki_nm.csv");
  const pKi = readMatrix("matrix_median_pki.csv");
  const pKiHuman = readMatrix("matrix_median_pki_human.csv");
  const nPoint = readMatrix("matrix_n_point.csv");
  const nDocs = readMatrix("matrix_n_docs.csv");

  const lookup = (m: Matrix, subject: string, object: string) => {
    const row = m.rows.find((r) => r.key === subject);
    if (!row) return null;
    const index = m.columns.indexOf(object);
    return index === -1 ? null : (row.cells[index] ?? null);
  };

  const rows: FactRow[] = [];

  for (const row of kiNm.rows) {
    for (const object of kiNm.columns) {
      const points = lookup(nPoint, row.key, object);
      const docs = lookup(nDocs, row.key, object);

      const shared = {
        subject: row.key,
        object,
        nPoints: points === null ? null : Math.round(points),
        nDocs: docs === null ? null : Math.round(docs),
      };

      rows.push({
        ...shared,
        metric: "median_ki_nm",
        scope: "all",
        value: round4sf(lookup(kiNm, row.key, object)),
        unit: "nM",
      });

      rows.push({
        ...shared,
        metric: "median_pki",
        scope: "all",
        value: round4sf(lookup(pKi, row.key, object)),
        unit: null,
      });

      rows.push({
        ...shared,
        metric: "median_pki",
        scope: "human",
        value: round4sf(lookup(pKiHuman, row.key, object)),
        unit: null,
      });
    }
  }

  // A cell with no value is not a fact. The gap report enumerates empty cells
  // by name on purpose; importing them as nulls would let a claim resolve to
  // "no data" instead of failing loudly.
  return rows.filter((row) => row.value !== null);
}

export async function importReceptorome(db: Database) {
  // The report is emitted by Python, which writes bare NaN for empty cells.
  // That is not valid JSON, so normalise it to null before parsing.
  const reportText = readFileSync(
    join(SNAPSHOT_DIR, "gap_report.json"),
    "utf8",
  ).replace(/(?<=[:\[,]\s*)(NaN|-?Infinity)(?=\s*[,\]\}])/g, "null");

  const report = JSON.parse(reportText) as {
    generated_at_utc: string;
    chembl_release: string;
    grid: { n_targets: number; n_compounds: number; n_cells: number };
    coverage: Record<string, number>;
    measurement_counts: { n_measurements_total: number };
  };

  const existing = await db.query.datasets.findFirst({
    where: eq(datasets.slug, RECEPTOROME_SLUG),
  });

  const provenance = {
    pipeline: "receptorome (Phase 0.0 ground-truth data layer)",
    notes: [
      "Ki only. IC50 and Kd are landed and normalised for context but never enter the matrix, and are never converted to Ki.",
      "No value is imputed, estimated or interpolated. Cells with no data are omitted, not zero-filled.",
      "Medians are taken in log space over uncensored point estimates.",
      "Censored measurements such as >10000 nM are counted separately and are true negatives, not missing data.",
      `${report.measurement_counts.n_measurements_total} normalised measurements across ${report.grid.n_cells} cells.`,
    ],
    coverage: report.coverage,
  };

  const values = {
    slug: RECEPTOROME_SLUG,
    name: "Receptorome — antipsychotic binding affinities",
    description:
      "Median Ki and pKi for eight antipsychotics across ten aminergic GPCRs, derived from ChEMBL with an explicit coverage ladder and no imputation.",
    source: "ChEMBL",
    release: report.chembl_release,
    generatedAt: new Date(report.generated_at_utc),
    provenance,
  };

  let datasetId: string;
  if (existing) {
    await db
      .update(datasets)
      .set({ ...values, version: existing.version + 1 })
      .where(eq(datasets.id, existing.id));
    datasetId = existing.id;
    await db.delete(facts).where(eq(facts.datasetId, datasetId));
  } else {
    const [created] = await db
      .insert(datasets)
      .values({ ...values, version: 1 })
      .returning();
    datasetId = created.id;
  }

  const rows = buildFactRows();
  for (let i = 0; i < rows.length; i += 200) {
    await db
      .insert(facts)
      .values(rows.slice(i, i + 200).map((row) => ({ ...row, datasetId })));
  }

  return { datasetId, factCount: rows.length, release: report.chembl_release };
}
