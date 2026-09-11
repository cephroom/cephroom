import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CheckBadge } from "@/components/check-badge";
import { ColumnBody } from "@/components/column-body";
import { Paywall } from "@/components/paywall";
import {
  columnBySlug,
  formatDate,
  formatDateTime,
  relatedColumns,
  splitPreview,
} from "@/lib/columns";
import { openProposalCount } from "@/lib/collab/queries";
import { canRead, getViewer } from "@/lib/entitlements";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const detail = await columnBySlug(slug);
  if (!detail) return { title: "Not found" };
  return {
    title: detail.column.title,
    description: detail.column.excerpt ?? detail.column.subtitle ?? undefined,
  };
}

export default async function ColumnPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [detail, viewer] = await Promise.all([columnBySlug(slug), getViewer()]);

  if (!detail || detail.column.status !== "published") {
    // Authors can always read their own drafts.
    if (!detail || detail.column.authorId !== viewer.id) notFound();
  }

  const { column, author, claims, check } = detail!;
  const entitled = canRead(viewer, column.access);
  const { preview, hiddenBlocks } = splitPreview(detail!.prose);
  const body = entitled ? detail!.prose : preview;
  const [related, openProposals] = await Promise.all([
    relatedColumns(column.id),
    openProposalCount(column.id),
  ]);

  return (
    <main>
      <article className="mx-auto max-w-[46rem] px-5 py-10 sm:py-14">
        <Link
          href="/columns"
          className="text-[0.82rem] text-ink-faint transition-colors hover:text-ink"
        >
          ← All columns
        </Link>

        <header className="mt-7 border-b border-rule pb-8">
          <h1 className="font-serif text-[2rem] font-semibold leading-[1.12] tracking-[-0.025em] sm:text-[2.5rem]">
            {column.title}
          </h1>

          {column.subtitle && (
            <p className="mt-4 font-serif text-[1.12rem] leading-relaxed text-ink-muted">
              {column.subtitle}
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.82rem] text-ink-muted">
            <span className="font-medium text-ink">{author.name}</span>
            <span aria-hidden className="text-ink-faint">·</span>
            <time dateTime={column.publishedAt?.toISOString()}>
              {formatDate(column.publishedAt)}
            </time>
            {column.readingMinutes && (
              <>
                <span aria-hidden className="text-ink-faint">·</span>
                <span>{column.readingMinutes} min read</span>
              </>
            )}
            {column.access !== "public" && (
              <span className="rounded-full border border-rule-strong px-2 py-px text-[0.68rem] font-medium uppercase tracking-[0.06em]">
                {column.access}
              </span>
            )}
          </div>

          {detail!.forkedFrom && (
            <p className="mt-3 text-[0.82rem] text-ink-muted">
              Forked from{" "}
              <Link
                href={`/columns/${detail!.forkedFrom.slug}`}
                className="font-medium text-accent hover:underline"
              >
                {detail!.forkedFrom.title}
              </Link>
            </p>
          )}
        </header>

        {/* --------------------------------------------- Build status strip */}
        <section
          aria-label="Claim check status"
          className="mt-7 rounded-xl border border-rule bg-paper-raised px-4 py-3.5"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <CheckBadge conclusion={check.conclusion} counts={check} size="md" />
            <span className="text-[0.8rem] text-ink-muted">
              last run {formatDateTime(detail!.checkedAt)}
            </span>
            <Link
              href={`/columns/${column.slug}/checks`}
              className="ml-auto shrink-0 text-[0.8rem] font-medium text-accent hover:underline"
            >
              Check history →
            </Link>
          </div>

          {check.conclusion === "drifted" && (
            <p className="mt-3 border-t border-rule pt-3 text-[0.82rem] leading-relaxed text-drifted">
              {check.drifted} claim{check.drifted === 1 ? " has" : "s have"}{" "}
              moved beyond the tolerance the author set. The value shown in the
              prose is the current one; the sentence around it may no longer
              follow.
            </p>
          )}
          {check.conclusion === "broken" && (
            <p className="mt-3 border-t border-rule pt-3 text-[0.82rem] leading-relaxed text-broken">
              {check.broken} claim{check.broken === 1 ? "" : "s"} could not be
              resolved against the dataset at all. Treat the affected numbers as
              unverified.
            </p>
          )}

          {(column.repoUrl || detail!.datasetsUsed.length > 0) && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-rule pt-3 text-[0.78rem] text-ink-muted">
              {detail!.datasetsUsed.map((dataset) => (
                <Link
                  key={dataset.slug}
                  href={`/datasets/${dataset.slug}`}
                  className="hover:text-ink"
                >
                  <span className="text-ink-faint">dataset</span>{" "}
                  {dataset.slug}{" "}
                  <span className="font-mono">@{dataset.release}</span>
                </Link>
              ))}
              {column.repoUrl && (
                <a
                  href={column.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-ink"
                >
                  <span className="text-ink-faint">repo</span>{" "}
                  {column.repoUrl.replace("https://github.com/", "")}
                  {column.repoCommit && (
                    <span className="font-mono"> @{column.repoCommit}</span>
                  )}
                </a>
              )}
            </div>
          )}
        </section>

        {/* ---------------------------------------------------------- Body */}
        <div className="mt-10">
          <ColumnBody
            prose={body}
            claims={claims}
            canInspect={viewer.plan !== "free"}
          />
        </div>

        {!entitled && (
          <Paywall
            access={column.access as "member" | "lab"}
            plan={viewer.plan}
            signedIn={Boolean(viewer.id)}
            hiddenBlocks={hiddenBlocks}
            claimCount={claims.size}
            returnTo={`/columns/${column.slug}`}
          />
        )}

        {/* ------------------------------------------------- Contribute bar */}
        {entitled && (
          <section className="mt-14 rounded-xl border border-rule bg-paper-sunken p-5">
            <h2 className="font-serif text-[1.1rem] font-semibold">
              Disagree with this?
            </h2>
            <p className="mt-1.5 max-w-[52ch] text-[0.88rem] leading-relaxed text-ink-muted">
              Open a proposal and the author reviews your edit as a diff, or
              fork the column and publish your own version with the lineage
              recorded.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href={`/columns/${column.slug}/propose`}
                className="rounded-md border border-rule-strong px-4 py-2 text-[0.86rem] font-medium transition-colors hover:border-ink-faint"
              >
                Propose an edit
              </Link>
              <Link
                href={`/columns/${column.slug}/fork`}
                className="rounded-md border border-rule-strong px-4 py-2 text-[0.86rem] font-medium transition-colors hover:border-ink-faint"
              >
                Fork this column
              </Link>
              <Link
                href={`/columns/${column.slug}/proposals`}
                className="rounded-md px-4 py-2 text-[0.86rem] font-medium text-ink-muted transition-colors hover:text-ink"
              >
                {openProposals > 0
                  ? `${openProposals} open proposal${openProposals === 1 ? "" : "s"}`
                  : "All proposals"}
              </Link>
            </div>
          </section>
        )}

        {/* ------------------------------------------------------- Byline */}
        <footer className="mt-10 border-t border-rule pt-7">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.09em] text-ink-faint">
            Written by
          </p>
          <p className="mt-2 font-serif text-[1.1rem] font-semibold">
            {author.name}
          </p>
          {author.bio && (
            <p className="mt-1.5 max-w-[58ch] text-[0.88rem] leading-relaxed text-ink-muted">
              {author.bio}
            </p>
          )}
        </footer>
      </article>

      {related.length > 0 && (
        <section className="border-t border-rule bg-paper-sunken">
          <div className="mx-auto max-w-[46rem] px-5 py-12">
            <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.09em] text-ink-faint">
              Read next
            </h2>
            <ul className="mt-4 space-y-4">
              {related.map((item) => (
                <li key={item.slug}>
                  <Link
                    href={`/columns/${item.slug}`}
                    className="group block"
                  >
                    <h3 className="font-serif text-[1.05rem] font-semibold leading-snug group-hover:underline">
                      {item.title}
                    </h3>
                    <p className="mt-0.5 text-[0.8rem] text-ink-muted">
                      {item.author}
                      {item.access !== "public" && ` · ${item.access}`}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </main>
  );
}
