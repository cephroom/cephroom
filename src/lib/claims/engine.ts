import { and, desc, eq, inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import * as schema from "@/lib/db/schema";
import {
  checkRuns,
  claimResults,
  claims as claimsTable,
  columns,
  datasets,
  facts,
} from "@/lib/db/schema";

import { parseBody, type ClaimSelect, type ParsedClaim } from "./syntax";
import { concludeRun, judge, type Verdict } from "./verdict";

/**
 * The check engine.
 *
 * Takes its database handle as an argument rather than importing one, so the
 * exact same code runs inside the app (via lib/claims/runner.ts, which binds
 * the server-only handle) and inside the seed and release scripts under tsx.
 * An earlier version had the scripts reimplement this loop, which is how you
 * end up with a CI runner that disagrees with itself.
 */
export type ClaimDb = LibSQLDatabase<typeof schema>;

export type CheckTrigger = "publish" | "manual" | "dataset_release" | "schedule";

export interface ResolvedCell {
  value: number | null;
  unit: string | null;
  nPoints: number | null;
  nDocs: number | null;
  scope: string;
  datasetRelease: string;
  datasetVersion: number;
}

export interface ClaimOutcome {
  claimId: string | null;
  key: string;
  verdict: Verdict;
  observedValue: number | null;
  observedUnit: string | null;
  deltaPct: number | null;
  note: string | null;
  datasetRelease: string | null;
  datasetVersion: number | null;
  evidence: {
    nPoints?: number | null;
    nDocs?: number | null;
    scope?: string;
  } | null;
}

/** Reads one dataset cell. Returns null when nothing matches the query. */
export async function resolveCell(
  db: ClaimDb,
  claim: Pick<
    ParsedClaim,
    "datasetSlug" | "metric" | "subject" | "object" | "scope"
  >,
): Promise<ResolvedCell | null> {
  const dataset = await db.query.datasets.findFirst({
    where: eq(datasets.slug, claim.datasetSlug),
  });
  if (!dataset) return null;

  const row = await db.query.facts.findFirst({
    where: and(
      eq(facts.datasetId, dataset.id),
      eq(facts.metric, claim.metric),
      eq(facts.subject, claim.subject),
      eq(facts.object, claim.object),
      eq(facts.scope, claim.scope),
    ),
  });
  if (!row) return null;

  return {
    value: row.value,
    unit: row.unit,
    nPoints: row.nPoints,
    nDocs: row.nDocs,
    scope: row.scope,
    datasetRelease: dataset.release,
    datasetVersion: dataset.version,
  };
}

function pick(
  cell: ResolvedCell,
  select: ClaimSelect,
): { value: number | null; unit: string | null } {
  switch (select) {
    case "n_points":
      return { value: cell.nPoints, unit: null };
    case "n_docs":
      return { value: cell.nDocs, unit: null };
    default:
      return { value: cell.value, unit: cell.unit };
  }
}

/** Evaluates a single claim without writing anything. Used by the preview. */
export async function evaluateClaim(
  db: ClaimDb,
  claim: ParsedClaim & { claimId?: string },
): Promise<ClaimOutcome> {
  const cell = await resolveCell(db, claim);

  if (!cell) {
    return {
      claimId: claim.claimId ?? null,
      key: claim.key,
      verdict: "broken",
      observedValue: null,
      observedUnit: null,
      deltaPct: null,
      note: `No cell for ${claim.subject} x ${claim.object} (${claim.metric}, scope ${claim.scope}) in dataset "${claim.datasetSlug}".`,
      datasetRelease: null,
      datasetVersion: null,
      evidence: null,
    };
  }

  const observed = pick(cell, claim.select);
  const judgement = judge(
    { value: claim.expectedValue, unit: claim.expectedUnit },
    observed,
    claim.tolerance,
  );

  return {
    claimId: claim.claimId ?? null,
    key: claim.key,
    verdict: judgement.verdict,
    observedValue: observed.value,
    observedUnit: observed.unit,
    deltaPct: judgement.deltaPct,
    note: judgement.note,
    datasetRelease: cell.datasetRelease,
    datasetVersion: cell.datasetVersion,
    evidence: { nPoints: cell.nPoints, nDocs: cell.nDocs, scope: cell.scope },
  };
}

/**
 * Re-parses a column body into claim rows, replacing whatever was stored, so
 * the claim table always matches the text that is actually on the page.
 */
export async function syncClaims(db: ClaimDb, columnId: string, body: string) {
  const parsed = parseBody(body);

  await db.delete(claimsTable).where(eq(claimsTable.columnId, columnId));

  if (parsed.claims.length > 0) {
    await db.insert(claimsTable).values(
      parsed.claims.map((claim) => ({
        columnId,
        key: claim.key,
        datasetSlug: claim.datasetSlug,
        query: {
          metric: claim.metric,
          subject: claim.subject,
          object: claim.object,
          scope: claim.scope,
          select: claim.select,
        },
        source: claim.source,
        expectedValue: claim.expectedValue,
        expectedUnit: claim.expectedUnit,
        tolerancePct:
          claim.tolerance.kind === "percent" ? claim.tolerance.amount : 0,
      })),
    );
  }

  return parsed;
}

/**
 * Runs every claim in a column and records the result. This is the CI job: it
 * is what publish calls, what the re-run button calls, and what a dataset
 * release calls for every column that cites it.
 */
export async function runChecks(
  db: ClaimDb,
  columnId: string,
  options: { trigger?: CheckTrigger; revisionId?: string | null } = {},
) {
  const startedAt = Date.now();

  const stored = await db.query.claims.findMany({
    where: eq(claimsTable.columnId, columnId),
  });

  const outcomes: ClaimOutcome[] = [];
  for (const claim of stored) {
    const query = claim.query;
    outcomes.push(
      await evaluateClaim(db, {
        claimId: claim.id,
        key: claim.key,
        datasetSlug: claim.datasetSlug,
        metric: query?.metric ?? "",
        subject: query?.subject ?? "",
        object: query?.object ?? "",
        scope: query?.scope ?? "all",
        select: (query?.select as ClaimSelect) ?? "value",
        expectedValue: claim.expectedValue,
        expectedUnit: claim.expectedUnit,
        tolerance: { kind: "percent", amount: claim.tolerancePct },
        label: null,
        source: claim.source,
      }),
    );
  }

  const [run] = await db
    .insert(checkRuns)
    .values({
      columnId,
      revisionId: options.revisionId ?? null,
      trigger: options.trigger ?? "manual",
      conclusion: concludeRun(outcomes.map((o) => o.verdict)),
      nVerified: outcomes.filter((o) => o.verdict === "verified").length,
      nDrifted: outcomes.filter((o) => o.verdict === "drifted").length,
      nBroken: outcomes.filter((o) => o.verdict === "broken").length,
      durationMs: Date.now() - startedAt,
    })
    .returning();

  if (outcomes.length > 0) {
    await db.insert(claimResults).values(
      outcomes.map((outcome) => ({
        checkRunId: run.id,
        claimId: outcome.claimId!,
        verdict: outcome.verdict,
        observedValue: outcome.observedValue,
        observedUnit: outcome.observedUnit,
        deltaPct: outcome.deltaPct,
        datasetRelease: outcome.datasetRelease,
        datasetVersion: outcome.datasetVersion,
        note: outcome.note,
        evidence: outcome.evidence,
      })),
    );
  }

  return { run, outcomes };
}

/** The latest check run for a column, with its per-claim results. */
export async function latestCheckRun(db: ClaimDb, columnId: string) {
  const run = await db.query.checkRuns.findFirst({
    where: eq(checkRuns.columnId, columnId),
    orderBy: [desc(checkRuns.createdAt)],
  });
  if (!run) return null;

  const results = await db.query.claimResults.findMany({
    where: eq(claimResults.checkRunId, run.id),
  });

  return { run, results };
}

export interface ReleaseReport {
  columnId: string;
  slug: string;
  title: string;
  before: string | null;
  after: string;
  newlyDrifted: { key: string; deltaPct: number | null }[];
  newlyBroken: { key: string; note: string | null }[];
}

/**
 * The cascade. A dataset re-import is the event this whole design exists for:
 * it is the moment a four-year-old sentence finds out it is wrong. Every
 * published column with a claim against the dataset is re-run, and the report
 * names what changed rather than only what the new state is.
 */
export async function recheckColumnsCiting(
  db: ClaimDb,
  datasetSlug: string,
): Promise<ReleaseReport[]> {
  const citing = await db.query.claims.findMany({
    where: eq(claimsTable.datasetSlug, datasetSlug),
    columns: { columnId: true },
  });

  const columnIds = [...new Set(citing.map((claim) => claim.columnId))];
  if (columnIds.length === 0) return [];

  const affected = await db.query.columns.findMany({
    where: inArray(columns.id, columnIds),
  });

  const reports: ReleaseReport[] = [];

  for (const column of affected) {
    const previous = await latestCheckRun(db, column.id);
    const previousVerdict = new Map(
      (previous?.results ?? []).map((result) => [result.claimId, result.verdict]),
    );

    const { run, outcomes } = await runChecks(db, column.id, {
      trigger: "dataset_release",
    });

    reports.push({
      columnId: column.id,
      slug: column.slug,
      title: column.title,
      before: previous?.run.conclusion ?? null,
      after: run.conclusion,
      newlyDrifted: outcomes
        .filter(
          (outcome) =>
            outcome.verdict === "drifted" &&
            previousVerdict.get(outcome.claimId!) !== "drifted",
        )
        .map((outcome) => ({ key: outcome.key, deltaPct: outcome.deltaPct })),
      newlyBroken: outcomes
        .filter(
          (outcome) =>
            outcome.verdict === "broken" &&
            previousVerdict.get(outcome.claimId!) !== "broken",
        )
        .map((outcome) => ({ key: outcome.key, note: outcome.note })),
    });
  }

  return reports;
}
