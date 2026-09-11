/**
 * Seeds a working Bindery instance: the receptorome dataset, two authors, a
 * demo reader, five published columns with real claim blocks, and one CI run
 * per column so the badges on the site reflect a real evaluation rather than
 * a hard-coded status.
 *
 * Safe to re-run. Columns are matched by slug and replaced.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import bcrypt from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";

import {
  checkRuns,
  claimResults,
  claims as claimsTable,
  columns,
  datasets,
  facts,
  revisions,
  users,
} from "../src/lib/db/schema";
import { parseBody } from "../src/lib/claims/syntax";
import { judge, concludeRun } from "../src/lib/claims/verdict";
import { db } from "./db";
import { importReceptorome } from "./import-receptorome";

const CONTENT_DIR = join(process.cwd(), "content", "seed");

const AUTHORS = [
  {
    key: "elena",
    handle: "elena",
    name: "Elena Warrick",
    email: "elena@bindery.science",
    role: "editor" as const,
    bio: "Editor of Bindery. Pharmacology, badly-behaved numbers, and the gap between an assay and a patient.",
  },
  {
    key: "marcus",
    handle: "marcus",
    name: "Marcus Oyelaran",
    email: "marcus@bindery.science",
    role: "author" as const,
    bio: "Writes about evidence quality in chemical biology. Previously built target-deconvolution pipelines that did not work, and said so.",
  },
];

const DEMO_READER = {
  handle: "demo",
  name: "Demo Reader",
  email: "demo@bindery.science",
  password: "binderydemo",
};

interface SeedDoc {
  slug: string;
  title: string;
  subtitle: string;
  access: "public" | "member" | "lab";
  author: string;
  repo?: string;
  commit?: string;
  body: string;
}

/** Minimal front-matter reader: `key: value` lines between --- fences. */
function parseDoc(raw: string): SeedDoc {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error("Seed document is missing its front matter.");

  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    meta[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
  }

  return {
    slug: meta.slug,
    title: meta.title,
    subtitle: meta.subtitle,
    access: (meta.access as SeedDoc["access"]) ?? "public",
    author: meta.author,
    repo: meta.repo,
    commit: meta.commit,
    body: match[2].trim(),
  };
}

function excerptOf(doc: SeedDoc): string {
  return doc.subtitle;
}

/** Rough reading time over the prose only, claim blocks excluded. */
function readingMinutes(prose: string): number {
  const words = prose.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

async function upsertUser(input: {
  handle: string;
  name: string;
  email: string;
  role?: "reader" | "author" | "editor";
  bio?: string;
  password?: string;
}) {
  const existing = await db.query.users.findFirst({
    where: eq(users.email, input.email),
  });

  const values = {
    name: input.name,
    email: input.email,
    handle: input.handle,
    bio: input.bio ?? null,
    role: input.role ?? ("reader" as const),
    emailVerified: new Date(),
    passwordHash: input.password
      ? await bcrypt.hash(input.password, 10)
      : undefined,
  };

  if (existing) {
    await db.update(users).set(values).where(eq(users.id, existing.id));
    return existing.id;
  }

  const [created] = await db.insert(users).values(values).returning();
  return created.id;
}

/**
 * Runs every claim in a column against the dataset and records the result.
 * Mirrors src/lib/claims/runner.ts, reimplemented here because that module is
 * server-only and this script runs under tsx.
 */
async function runChecks(columnId: string, revisionId: string) {
  const started = Date.now();
  const stored = await db.query.claims.findMany({
    where: eq(claimsTable.columnId, columnId),
  });

  const outcomes = [];
  for (const claim of stored) {
    const query = claim.query!;
    const dataset = await db.query.datasets.findFirst({
      where: eq(datasets.slug, claim.datasetSlug),
    });
    const cell = dataset
      ? await db.query.facts.findFirst({
          where: and(
            eq(facts.datasetId, dataset.id),
            eq(facts.metric, query.metric),
            eq(facts.subject, query.subject),
            eq(facts.object, query.object),
            eq(facts.scope, query.scope ?? "all"),
          ),
        })
      : undefined;

    const select = query.select ?? "value";
    const observed = !cell
      ? { value: null, unit: null }
      : select === "n_points"
        ? { value: cell.nPoints, unit: null }
        : select === "n_docs"
          ? { value: cell.nDocs, unit: null }
          : { value: cell.value, unit: cell.unit };

    const judgement = judge(
      { value: claim.expectedValue, unit: claim.expectedUnit },
      observed,
      { kind: "percent", amount: claim.tolerancePct },
    );

    outcomes.push({
      checkRunId: "",
      claimId: claim.id,
      verdict: judgement.verdict,
      observedValue: observed.value ?? null,
      observedUnit: observed.unit ?? null,
      deltaPct: judgement.deltaPct,
      datasetRelease: dataset?.release ?? null,
      datasetVersion: dataset?.version ?? null,
      note:
        judgement.note ??
        (cell
          ? null
          : `No cell for ${query.subject} x ${query.object} in ${claim.datasetSlug}.`),
      evidence: cell
        ? { nPoints: cell.nPoints, nDocs: cell.nDocs, scope: cell.scope }
        : null,
    });
  }

  const [run] = await db
    .insert(checkRuns)
    .values({
      columnId,
      revisionId,
      trigger: "publish",
      conclusion: concludeRun(outcomes.map((o) => o.verdict)),
      nVerified: outcomes.filter((o) => o.verdict === "verified").length,
      nDrifted: outcomes.filter((o) => o.verdict === "drifted").length,
      nBroken: outcomes.filter((o) => o.verdict === "broken").length,
      durationMs: Date.now() - started,
    })
    .returning();

  if (outcomes.length > 0) {
    await db
      .insert(claimResults)
      .values(outcomes.map((o) => ({ ...o, checkRunId: run.id })));
  }

  return run;
}

async function main() {
  console.log("Importing receptorome snapshot...");
  const imported = await importReceptorome(db);
  console.log(
    `  dataset ready: ${imported.factCount} facts, release ${imported.release}`,
  );

  const authorIds = new Map<string, string>();
  for (const author of AUTHORS) {
    authorIds.set(author.key, await upsertUser(author));
  }
  await upsertUser({ ...DEMO_READER, role: "reader" });
  console.log(`  users ready: ${AUTHORS.length + 1}`);

  const docs = readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parseDoc(readFileSync(join(CONTENT_DIR, f), "utf8")));

  // Publish in a deterministic order, spaced a day apart, so the feed has a
  // plausible chronology instead of eight identical timestamps.
  const order = [
    "d2-occupancy-window",
    "three-empty-cells",
    "serotonin-dopamine-ratio-audited",
    "muscarinic-liability-is-a-clozapine-problem",
    "histamine-h1-and-the-sedation-question",
  ];
  docs.sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));

  const slugs = docs.map((d) => d.slug);
  const stale = await db.query.columns.findMany({
    where: inArray(columns.slug, slugs),
  });
  if (stale.length > 0) {
    await db.delete(columns).where(
      inArray(
        columns.id,
        stale.map((c) => c.id),
      ),
    );
  }

  const base = Date.now() - docs.length * 5 * 86_400_000;

  for (const [index, doc] of docs.entries()) {
    const authorId = authorIds.get(doc.author);
    if (!authorId) throw new Error(`Unknown seed author "${doc.author}".`);

    const parsed = parseBody(doc.body);
    for (const error of parsed.errors) {
      console.warn(`  ! ${doc.slug}: ${error.message}`);
    }

    const publishedAt = new Date(base + index * 5 * 86_400_000);

    const [column] = await db
      .insert(columns)
      .values({
        slug: doc.slug,
        title: doc.title,
        subtitle: doc.subtitle,
        excerpt: excerptOf(doc),
        body: doc.body,
        authorId,
        status: "published",
        access: doc.access,
        repoUrl: doc.repo ?? null,
        repoCommit: doc.commit ?? null,
        readingMinutes: readingMinutes(parsed.prose),
        publishedAt,
        createdAt: publishedAt,
        updatedAt: publishedAt,
      })
      .returning();

    const [revision] = await db
      .insert(revisions)
      .values({
        columnId: column.id,
        number: 1,
        title: doc.title,
        body: doc.body,
        message: "First publication",
        authorId,
        createdAt: publishedAt,
      })
      .returning();

    if (parsed.claims.length > 0) {
      await db.insert(claimsTable).values(
        parsed.claims.map((claim) => ({
          columnId: column.id,
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
          createdAt: publishedAt,
        })),
      );
    }

    const run = await runChecks(column.id, revision.id);
    console.log(
      `  ${doc.slug.padEnd(44)} ${parsed.claims.length} claims -> ${run.conclusion}`,
    );
  }

  console.log("\nSeed complete.");
  console.log(`Demo login: ${DEMO_READER.email} / ${DEMO_READER.password}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
