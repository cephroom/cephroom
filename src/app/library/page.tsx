import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";

import { ColumnCard } from "@/components/column-card";
import type { Conclusion } from "@/lib/claims/verdict";
import type { FeedItem } from "@/lib/columns";
import { db } from "@/lib/db";
import { bookmarks, checkRuns, columns } from "@/lib/db/schema";
import { getViewer } from "@/lib/entitlements";

export const metadata: Metadata = { title: "Saved columns" };

export default async function LibraryPage() {
  const viewer = await getViewer();
  if (!viewer.id) redirect("/signin?callbackUrl=/library");

  const saved = await db.query.bookmarks.findMany({
    where: eq(bookmarks.userId, viewer.id),
    orderBy: [desc(bookmarks.createdAt)],
  });

  const ids = saved.map((row) => row.columnId);
  const rows =
    ids.length > 0
      ? await db.query.columns.findMany({
          where: inArray(columns.id, ids),
          with: { author: true },
        })
      : [];

  const runs =
    ids.length > 0
      ? await db.query.checkRuns.findMany({
          where: inArray(checkRuns.columnId, ids),
          orderBy: [desc(checkRuns.createdAt)],
        })
      : [];
  const latest = new Map<string, (typeof runs)[number]>();
  for (const run of runs) {
    if (!latest.has(run.columnId)) latest.set(run.columnId, run);
  }

  // Keep the order the reader saved them in.
  const byId = new Map(rows.map((row) => [row.id, row]));
  const feed: FeedItem[] = saved
    .map((bookmark) => byId.get(bookmark.columnId))
    .filter((column): column is (typeof rows)[number] => Boolean(column))
    .map((column) => {
      const run = latest.get(column.id);
      return {
        id: column.id,
        slug: column.slug,
        title: column.title,
        subtitle: column.subtitle,
        excerpt: column.excerpt,
        access: column.access,
        publishedAt: column.publishedAt,
        readingMinutes: column.readingMinutes,
        author: {
          name: column.author?.name ?? null,
          handle: column.author?.handle ?? null,
        },
        check: {
          conclusion: (run?.conclusion ?? "empty") as Conclusion,
          verified: run?.nVerified ?? 0,
          drifted: run?.nDrifted ?? 0,
          broken: run?.nBroken ?? 0,
        },
      };
    });

  const needsAttention = feed.filter(
    (item) =>
      item.check.conclusion === "drifted" || item.check.conclusion === "broken",
  );

  return (
    <main className="mx-auto max-w-[46rem] px-5 py-12 sm:py-16">
      <header className="border-b border-rule pb-7">
        <h1 className="font-serif text-[2rem] font-semibold tracking-[-0.025em]">
          Saved columns
        </h1>
        <p className="mt-2 max-w-[54ch] text-[0.95rem] leading-relaxed text-ink-muted">
          Columns you kept. If one of them starts failing its checks, it shows
          up here too — which is the point of saving something you intend to
          cite later.
        </p>
      </header>

      {needsAttention.length > 0 && (
        <p className="mt-6 rounded-lg border border-drifted/30 bg-drifted-wash px-4 py-3 text-[0.86rem] text-drifted">
          {needsAttention.length} of your saved columns{" "}
          {needsAttention.length === 1 ? "has" : "have"} a claim that no longer
          checks out.
        </p>
      )}

      {feed.length === 0 ? (
        <div className="mt-10 rounded-xl border border-rule px-5 py-12 text-center">
          <p className="text-[0.95rem] text-ink-muted">
            Nothing saved yet.
          </p>
          <Link
            href="/columns"
            className="mt-4 inline-block rounded-md border border-rule-strong px-4 py-2 text-[0.88rem] font-medium transition-colors hover:border-ink-faint"
          >
            Browse the columns
          </Link>
        </div>
      ) : (
        <ul className="mt-2">
          {feed.map((item) => (
            <ColumnCard key={item.id} item={item} />
          ))}
        </ul>
      )}
    </main>
  );
}
