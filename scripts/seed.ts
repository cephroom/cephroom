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
import { eq, inArray } from "drizzle-orm";

import { columns, revisions, users } from "../src/lib/db/schema";
import { parseBody } from "../src/lib/claims/syntax";
import { runChecks, syncClaims } from "../src/lib/claims/engine";
import { db } from "./db";
import { importReceptorome } from "./import-receptorome";

const CONTENT_DIR = join(process.cwd(), "content", "seed");

// The seeded authors get passwords so the author-side flows - the studio,
// reviewing a proposal on your own column - are reachable in a fresh clone
// without editing the database by hand.
const DEMO_PASSWORD = "binderydemo";

const AUTHORS = [
  {
    key: "elena",
    handle: "elena",
    name: "Elena Warrick",
    email: "elena@bindery.science",
    role: "editor" as const,
    password: DEMO_PASSWORD,
    bio: "Editor of Bindery. Pharmacology, badly-behaved numbers, and the gap between an assay and a patient.",
  },
  {
    key: "marcus",
    handle: "marcus",
    name: "Marcus Oyelaran",
    email: "marcus@bindery.science",
    role: "author" as const,
    password: DEMO_PASSWORD,
    bio: "Writes about evidence quality in chemical biology. Previously built target-deconvolution pipelines that did not work, and said so.",
  },
];

const DEMO_READER = {
  handle: "demo",
  name: "Demo Reader",
  email: "demo@bindery.science",
  password: DEMO_PASSWORD,
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

    await syncClaims(db, column.id, doc.body);

    const { run } = await runChecks(db, column.id, {
      trigger: "publish",
      revisionId: revision.id,
    });
    console.log(
      `  ${doc.slug.padEnd(44)} ${parsed.claims.length} claims -> ${run.conclusion}`,
    );
  }

  console.log("\nSeed complete.");
  console.log(`Logins, all with the password "${DEMO_PASSWORD}":`);
  console.log(`  ${DEMO_READER.email}  (reader, no subscription)`);
  for (const author of AUTHORS) {
    console.log(`  ${author.email}  (${author.role})`);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
