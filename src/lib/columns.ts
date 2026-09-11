import "server-only";

import { and, desc, eq, inArray, ne } from "drizzle-orm";

import type { ClaimView } from "@/components/claim-chip";
import { latestCheckRun } from "@/lib/claims/runner";
import { formatValue, parseBody } from "@/lib/claims/syntax";
import type { Conclusion } from "@/lib/claims/verdict";
import { db } from "@/lib/db";
import {
  checkRuns,
  claims as claimsTable,
  columns,
  datasets,
} from "@/lib/db/schema";

export interface FeedItem {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  excerpt: string | null;
  access: "public" | "member" | "lab";
  publishedAt: Date | null;
  readingMinutes: number | null;
  author: { name: string | null; handle: string | null };
  check: {
    conclusion: Conclusion;
    verified: number;
    drifted: number;
    broken: number;
  };
}

function conclusionOf(run: {
  conclusion: string;
  nVerified: number;
  nDrifted: number;
  nBroken: number;
} | null): FeedItem["check"] {
  if (!run) {
    return { conclusion: "empty", verified: 0, drifted: 0, broken: 0 };
  }
  return {
    conclusion: run.conclusion as Conclusion,
    verified: run.nVerified,
    drifted: run.nDrifted,
    broken: run.nBroken,
  };
}

/** Published columns, newest first, each with its most recent check run. */
export async function publishedFeed(limit?: number): Promise<FeedItem[]> {
  const rows = await db.query.columns.findMany({
    where: eq(columns.status, "published"),
    orderBy: [desc(columns.publishedAt)],
    limit,
    with: { author: true },
  });

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      subtitle: row.subtitle,
      excerpt: row.excerpt,
      access: row.access,
      publishedAt: row.publishedAt,
      readingMinutes: row.readingMinutes,
      author: {
        name: row.author?.name ?? null,
        handle: row.author?.handle ?? null,
      },
      check: conclusionOf(await latestRunFor(row.id)),
    })),
  );
}

async function latestRunFor(columnId: string) {
  const run = await db.query.checkRuns.findFirst({
    where: eq(checkRuns.columnId, columnId),
    orderBy: [desc(checkRuns.createdAt)],
  });
  return run ?? null;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(value: Date | null | undefined): string {
  return value ? dateFormat.format(value) : "—";
}

export function formatDateTime(value: Date | null | undefined): string {
  return value ? dateTimeFormat.format(value) : "—";
}

export interface ColumnDetail {
  column: typeof columns.$inferSelect;
  author: { id: string; name: string | null; handle: string | null; bio: string | null };
  prose: string;
  claims: Map<string, ClaimView>;
  check: FeedItem["check"];
  checkedAt: Date | null;
  datasetsUsed: { slug: string; name: string; release: string }[];
  forkedFrom: { slug: string; title: string } | null;
}

export async function columnBySlug(slug: string): Promise<ColumnDetail | null> {
  const row = await db.query.columns.findFirst({
    where: eq(columns.slug, slug),
    with: { author: true },
  });
  if (!row) return null;

  const parsed = parseBody(row.body);
  const latest = await latestCheckRun(row.id);

  // Check results are keyed by claim id; map them back onto the claim keys
  // the prose actually references.
  const byClaimId = new Map(
    (latest?.results ?? []).map((result) => [result.claimId, result]),
  );
  const claimRows = await db.query.claims.findMany({
    where: eq(claimsTable.columnId, row.id),
  });

  const datasetSlugs = [...new Set(parsed.claims.map((c) => c.datasetSlug))];
  const datasetRows =
    datasetSlugs.length > 0
      ? await db.query.datasets.findMany({
          where: inArray(datasets.slug, datasetSlugs),
        })
      : [];
  const datasetBySlug = new Map(datasetRows.map((d) => [d.slug, d]));

  const claims = new Map<string, ClaimView>();
  for (const parsedClaim of parsed.claims) {
    const stored = claimRows.find((c) => c.key === parsedClaim.key);
    const result = stored ? byClaimId.get(stored.id) : undefined;
    const dataset = datasetBySlug.get(parsedClaim.datasetSlug);

    const observedValue = result?.observedValue ?? null;
    const observedUnit = result?.observedUnit ?? parsedClaim.expectedUnit;

    claims.set(parsedClaim.key, {
      key: parsedClaim.key,
      // The rendered number is what the dataset says now, not what was typed.
      display:
        observedValue !== null
          ? formatValue(observedValue, observedUnit)
          : formatValue(parsedClaim.expectedValue, parsedClaim.expectedUnit),
      verdict: (result?.verdict ?? "broken") as ClaimView["verdict"],
      authored: formatValue(
        parsedClaim.expectedValue,
        parsedClaim.expectedUnit,
      ),
      observed:
        observedValue !== null ? formatValue(observedValue, observedUnit) : "—",
      deltaPct: result?.deltaPct ?? null,
      tolerance:
        parsedClaim.tolerance.kind === "percent"
          ? `${parsedClaim.tolerance.amount}%`
          : `±${parsedClaim.tolerance.amount}`,
      note: result?.note ?? null,
      query: {
        dataset: dataset?.name ?? parsedClaim.datasetSlug,
        datasetSlug: parsedClaim.datasetSlug,
        metric: parsedClaim.metric,
        subject: parsedClaim.subject,
        object: parsedClaim.object,
        scope: parsedClaim.scope,
        select: parsedClaim.select,
      },
      release: result?.datasetRelease ?? dataset?.release ?? null,
      checkedAt: latest?.run.createdAt
        ? formatDateTime(latest.run.createdAt)
        : null,
      nPoints: result?.evidence?.nPoints ?? null,
      nDocs: result?.evidence?.nDocs ?? null,
    });
  }

  const forkedFrom = row.forkedFromId
    ? ((await db.query.columns.findFirst({
        where: eq(columns.id, row.forkedFromId),
        columns: { slug: true, title: true },
      })) ?? null)
    : null;

  return {
    column: row,
    author: {
      id: row.author.id,
      name: row.author.name,
      handle: row.author.handle,
      bio: row.author.bio,
    },
    prose: parsed.prose,
    claims,
    check: conclusionOf(latest?.run ?? null),
    checkedAt: latest?.run.createdAt ?? null,
    datasetsUsed: datasetRows.map((d) => ({
      slug: d.slug,
      name: d.name,
      release: d.release,
    })),
    forkedFrom,
  };
}

/** Other published columns, for the end-of-article rail. */
export async function relatedColumns(excludeId: string, limit = 3) {
  const rows = await db.query.columns.findMany({
    where: and(eq(columns.status, "published"), ne(columns.id, excludeId)),
    orderBy: [desc(columns.publishedAt)],
    limit,
    with: { author: true },
  });
  return rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    access: row.access,
    author: row.author?.name ?? null,
  }));
}

/**
 * Splits prose into a free preview and the remainder. The cut lands on a
 * block boundary so a gated column never ends mid-table or mid-sentence.
 */
export function splitPreview(prose: string): {
  preview: string;
  hiddenBlocks: number;
} {
  const blocks = prose.split(/\n{2,}/);
  const take = Math.min(Math.max(3, Math.ceil(blocks.length * 0.28)), 7);
  return {
    preview: blocks.slice(0, take).join("\n\n"),
    hiddenBlocks: Math.max(0, blocks.length - take),
  };
}
