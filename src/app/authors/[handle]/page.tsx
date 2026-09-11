import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";

import { ColumnCard } from "@/components/column-card";
import type { Conclusion } from "@/lib/claims/verdict";
import type { FeedItem } from "@/lib/columns";
import { db } from "@/lib/db";
import { checkRuns, columns, proposals, users } from "@/lib/db/schema";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const author = await db.query.users.findFirst({
    where: eq(users.handle, handle),
  });
  return author
    ? { title: author.name ?? handle, description: author.bio ?? undefined }
    : { title: "Author not found" };
}

export default async function AuthorPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;

  const author = await db.query.users.findFirst({
    where: eq(users.handle, handle),
  });
  if (!author) notFound();

  const written = await db.query.columns.findMany({
    where: and(
      eq(columns.authorId, author.id),
      eq(columns.status, "published"),
    ),
    orderBy: [desc(columns.publishedAt)],
  });

  const runs =
    written.length > 0
      ? await db.query.checkRuns.findMany({
          where: inArray(
            checkRuns.columnId,
            written.map((column) => column.id),
          ),
          orderBy: [desc(checkRuns.createdAt)],
        })
      : [];
  const latest = new Map<string, (typeof runs)[number]>();
  for (const run of runs) {
    if (!latest.has(run.columnId)) latest.set(run.columnId, run);
  }

  const merged = await db.query.proposals.findMany({
    where: and(eq(proposals.authorId, author.id), eq(proposals.status, "merged")),
    columns: { id: true },
  });

  const totals = [...latest.values()].reduce(
    (sum, run) => ({
      verified: sum.verified + run.nVerified,
      drifted: sum.drifted + run.nDrifted,
      broken: sum.broken + run.nBroken,
    }),
    { verified: 0, drifted: 0, broken: 0 },
  );

  const feed: FeedItem[] = written.map((column) => {
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
      author: { name: author.name, handle: author.handle },
      check: {
        conclusion: (run?.conclusion ?? "empty") as Conclusion,
        verified: run?.nVerified ?? 0,
        drifted: run?.nDrifted ?? 0,
        broken: run?.nBroken ?? 0,
      },
    };
  });

  return (
    <main className="mx-auto max-w-[46rem] px-5 py-12 sm:py-16">
      <header className="border-b border-rule pb-8">
        <div className="flex items-start gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent text-[1.4rem] font-semibold text-white">
            {(author.name ?? handle).charAt(0).toUpperCase()}
          </span>
          <div>
            <h1 className="font-serif text-[1.9rem] font-semibold leading-tight tracking-[-0.025em]">
              {author.name}
            </h1>
            <p className="mt-0.5 font-mono text-[0.82rem] text-ink-faint">
              @{author.handle}
            </p>
          </div>
        </div>

        {author.bio && (
          <p className="mt-5 max-w-[58ch] text-[1rem] leading-relaxed text-ink-muted">
            {author.bio}
          </p>
        )}

        <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-[0.82rem]">
          <Stat label="Columns" value={String(written.length)} />
          <Stat
            label="Claims verified"
            value={String(totals.verified)}
            tone="text-verified"
          />
          {totals.drifted + totals.broken > 0 && (
            <Stat
              label="Needing attention"
              value={String(totals.drifted + totals.broken)}
              tone="text-drifted"
            />
          )}
          {merged.length > 0 && (
            <Stat label="Proposals merged" value={String(merged.length)} />
          )}
        </dl>
      </header>

      {feed.length === 0 ? (
        <p className="mt-10 rounded-xl border border-rule px-4 py-10 text-center text-[0.9rem] text-ink-muted">
          Nothing published yet.
        </p>
      ) : (
        <ul className="mt-2">
          {feed.map((item) => (
            <ColumnCard key={item.id} item={item} />
          ))}
        </ul>
      )}

      <p className="mt-10 text-[0.85rem] text-ink-muted">
        <Link href="/columns" className="font-medium text-accent hover:underline">
          All columns
        </Link>
      </p>
    </main>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <dt className="text-ink-faint">{label}</dt>
      <dd className={`mt-0.5 font-mono text-[1.1rem] tnum ${tone ?? ""}`}>
        {value}
      </dd>
    </div>
  );
}
