/**
 * A dataset release.
 *
 * Re-imports the snapshot, bumps its version, and re-runs every claim in every
 * published column that cites it. This is the event the whole design exists
 * for: the moment an old sentence finds out the data moved underneath it.
 *
 *   npm run db:release              re-import the vendored snapshot as it is
 *   npm run db:release -- --simulate  model an upstream release that moves values
 *
 * `--simulate` exists because the repository vendors exactly one ChEMBL
 * snapshot, so a plain re-import can never drift and the cascade has nothing
 * to show. It applies a small, deterministic, clearly-labelled perturbation:
 * a handful of cells gain measurements and shift, as they would when a new
 * ChEMBL release adds papers. The dataset's release string and provenance
 * notes both record that it was simulated, so nothing downstream can mistake
 * it for real upstream data.
 */
import { eq } from "drizzle-orm";

import { datasets, facts } from "../src/lib/db/schema";
import { recheckColumnsCiting } from "../src/lib/claims/engine";
import { db } from "./db";
import { importReceptorome, RECEPTOROME_SLUG } from "./import-receptorome";

const simulate = process.argv.includes("--simulate");

/**
 * Cells nudged by --simulate, and by how much. Chosen to land on claims the
 * seeded columns actually make, so the cascade is visible rather than
 * theoretical.
 */
const SIMULATED_SHIFTS: {
  subject: string;
  object: string;
  metric: string;
  scope: string;
  factor: number;
  addPoints: number;
  addDocs: number;
}[] = [
  // Enough to clear the 10% tolerance on the D2 haloperidol claim.
  {
    subject: "DRD2",
    object: "haloperidol",
    metric: "median_ki_nm",
    scope: "all",
    factor: 1.22,
    addPoints: 6,
    addDocs: 5,
  },
  // Within the 15% tolerance the clozapine 5-HT2A claim allows: this one
  // should stay green, which is the control.
  {
    subject: "HTR2A",
    object: "clozapine",
    metric: "median_ki_nm",
    scope: "all",
    factor: 1.04,
    addPoints: 3,
    addDocs: 2,
  },
  // Clears the 15% tolerance on the H1 clozapine claim.
  {
    subject: "HRH1",
    object: "clozapine",
    metric: "median_ki_nm",
    scope: "all",
    factor: 0.78,
    addPoints: 4,
    addDocs: 4,
  },
];

async function applySimulatedRelease(datasetId: string) {
  const dataset = await db.query.datasets.findFirst({
    where: eq(datasets.id, datasetId),
  });
  if (!dataset) throw new Error("Dataset vanished mid-release.");

  for (const shift of SIMULATED_SHIFTS) {
    const rows = await db.query.facts.findMany({
      where: eq(facts.datasetId, datasetId),
    });
    const row = rows.find(
      (candidate) =>
        candidate.subject === shift.subject &&
        candidate.object === shift.object &&
        candidate.metric === shift.metric &&
        candidate.scope === shift.scope,
    );
    if (!row || row.value === null) {
      console.warn(
        `  ! no cell for ${shift.subject} x ${shift.object}, skipping`,
      );
      continue;
    }

    const next = Number.parseFloat((row.value * shift.factor).toPrecision(4));
    await db
      .update(facts)
      .set({
        value: next,
        nPoints: (row.nPoints ?? 0) + shift.addPoints,
        nDocs: (row.nDocs ?? 0) + shift.addDocs,
      })
      .where(eq(facts.id, row.id));

    console.log(
      `  ${shift.subject} x ${shift.object}: ${row.value} -> ${next} nM (n ${row.nPoints} -> ${(row.nPoints ?? 0) + shift.addPoints})`,
    );
  }

  const notes = dataset.provenance?.notes ?? [];
  await db
    .update(datasets)
    .set({
      release: `${dataset.release}+sim`,
      generatedAt: new Date(),
      provenance: {
        ...dataset.provenance,
        notes: [
          "SIMULATED RELEASE. Three cells were perturbed to model an upstream ChEMBL release adding papers. These values are not from ChEMBL. Re-run the importer without --simulate to restore the real snapshot.",
          ...notes.filter((note) => !note.startsWith("SIMULATED RELEASE")),
        ],
      },
    })
    .where(eq(datasets.id, datasetId));
}

async function main() {
  console.log(
    simulate
      ? "Simulating an upstream release of the receptorome dataset..."
      : "Re-importing the receptorome dataset...",
  );

  const imported = await importReceptorome(db);
  console.log(`  ${imported.factCount} facts, release ${imported.release}`);

  if (simulate) {
    console.log("\nPerturbing cells:");
    await applySimulatedRelease(imported.datasetId);
  }

  console.log("\nRe-running claims in every column citing this dataset:\n");
  const reports = await recheckColumnsCiting(db, RECEPTOROME_SLUG);

  let regressions = 0;
  for (const report of reports) {
    const moved = report.before !== report.after;
    const arrow = moved ? `${report.before ?? "none"} -> ${report.after}` : report.after;
    console.log(`  ${report.slug.padEnd(44)} ${arrow}`);

    for (const drift of report.newlyDrifted) {
      regressions++;
      console.log(
        `      drifted: ${drift.key} (${drift.deltaPct === null ? "?" : `${drift.deltaPct > 0 ? "+" : ""}${drift.deltaPct.toFixed(1)}%`})`,
      );
    }
    for (const broken of report.newlyBroken) {
      regressions++;
      console.log(`      broken:  ${broken.key} — ${broken.note ?? ""}`);
    }
  }

  console.log(
    `\n${reports.length} columns re-checked, ${regressions} newly failing claims.`,
  );
  if (regressions > 0) {
    console.log("Their authors now see them flagged on the page and in /checks.");
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
