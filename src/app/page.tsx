import Link from "next/link";

import { CheckBadge } from "@/components/check-badge";
import { ColumnCard } from "@/components/column-card";
import { publishedFeed } from "@/lib/columns";
import { db } from "@/lib/db";
import { facts } from "@/lib/db/schema";

export default async function HomePage() {
  const [feed, dataset] = await Promise.all([
    publishedFeed(4),
    db.query.datasets.findFirst(),
  ]);

  const factCount = dataset ? await db.$count(facts) : 0;

  return (
    <main>
      {/* ---------------------------------------------------------- Hero */}
      <section className="border-b border-rule">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
          <div className="max-w-3xl">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-rule bg-paper-raised px-3 py-1 text-[0.72rem] font-medium uppercase tracking-[0.08em] text-ink-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-verified" />
              {/* The full list does not fit on one line at 375px, and a
                  two-line pill reads as a mistake. */}
              Pharmacology
              <span className="hidden sm:inline"> · neuroscience</span> ·
              evidence quality
            </p>

            <h1 className="font-serif text-[2.6rem] font-semibold leading-[1.08] tracking-[-0.025em] sm:text-[3.6rem]">
              Science writing with a build step.
            </h1>

            <p className="mt-6 max-w-[56ch] text-[1.1rem] leading-relaxed text-ink-muted">
              A review article is frozen the day it is written. The databases
              underneath it are not. Bindery columns state their numbers as
              queries against a versioned dataset, and re-run every one of them
              on every release — so a sentence that has quietly become wrong
              says so on the page.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/pricing"
                className="rounded-md bg-accent px-5 py-2.5 text-[0.92rem] font-medium text-white transition-colors hover:bg-accent-hover"
              >
                Become a member
              </Link>
              <Link
                href="/columns"
                className="rounded-md border border-rule-strong px-5 py-2.5 text-[0.92rem] font-medium text-ink transition-colors hover:border-ink-faint"
              >
                Read the columns
              </Link>
            </div>
          </div>

          {/* A live example of the mechanism, not a picture of one. */}
          <figure className="mt-14 max-w-3xl rounded-xl border border-rule bg-paper-raised p-5 sm:p-7">
            <figcaption className="mb-4 text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-ink-faint">
              What an author writes
            </figcaption>
            <pre className="scroll-x overflow-x-auto rounded-lg border border-rule bg-paper-sunken p-4 font-mono text-[0.78rem] leading-relaxed text-ink-muted">
              {`Haloperidol binds D2 at {{claim:hal-d2}}.

\`\`\`claim hal-d2
dataset: receptorome-ki
metric:  median_ki_nm
subject: DRD2
object:  haloperidol
value:   1.549 nM
tolerance: 10%
\`\`\``}
            </pre>

            <div className="my-4 flex items-center gap-3 text-[0.72rem] uppercase tracking-[0.09em] text-ink-faint">
              <span className="h-px flex-1 bg-rule" />
              what a reader sees
              <span className="h-px flex-1 bg-rule" />
            </div>

            <p className="font-serif text-[1.1rem] leading-relaxed">
              Haloperidol binds D2 at{" "}
              <span className="inline-flex items-baseline gap-1 rounded bg-verified-wash px-1 py-px font-mono text-[0.88em] tnum text-verified">
                <span className="inline-block h-[5px] w-[5px] translate-y-[-2px] rounded-full bg-verified" />
                1.55 nM
              </span>
              .
            </p>
            <p className="mt-3 text-[0.8rem] text-ink-muted">
              Rendered from the dataset at read time, not typed. The dot is the
              verdict of the last check run: 104 measurements across 93 papers,
              within tolerance of the value the author asserted.
            </p>
          </figure>
        </div>
      </section>

      {/* ------------------------------------------------- The three parts */}
      <section className="border-b border-rule bg-paper-sunken">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="font-serif text-[1.7rem] font-semibold tracking-[-0.02em]">
            What GitHub did for code, for the numbers in a paper
          </h2>
          <p className="mt-3 max-w-[62ch] text-[0.98rem] leading-relaxed text-ink-muted">
            Version control was never the interesting part. What changed
            software was that every change got diffed, reviewed, and re-tested
            automatically. Scientific writing has none of those three.
          </p>

          <div className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            <Feature
              n="01"
              title="Claims, not literals"
              body="A number in the prose is a query against a named dataset at a named release. The author records what they observed and how much drift they will tolerate. The reader gets the current value and its provenance."
            />
            <Feature
              n="02"
              title="CI for prose"
              body="Every claim runs on publish, on demand, and on every dataset release. A column carries a build status the way a repository does: passing, drifted, or broken."
            />
            <Feature
              n="03"
              title="Forks and proposals"
              body="Disagree with a column? Fork it and publish your version with lineage intact, or open a proposal against the original and let the author review the diff."
            />
            <Feature
              n="04"
              title="Evidence counts, always"
              body="Every claim carries the number of measurements and the number of distinct papers behind it. A value with an n of one and a value with an n of one hundred stop looking identical."
            />
            <Feature
              n="05"
              title="No imputation, anywhere"
              body="Empty cells stay empty and are listed by name. Censored measurements are counted as the true negatives they are, never folded into missing data."
            />
            <Feature
              n="06"
              title="Pinned to a repository"
              body="A column links the GitHub repo and commit that produced its analysis. The prose, the data snapshot, and the code all name each other."
            />
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- The dataset */}
      {dataset && (
        <section className="border-b border-rule">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
              <div>
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-ink-faint">
                  The evidence layer
                </p>
                <h2 className="mt-3 font-serif text-[1.7rem] font-semibold tracking-[-0.02em]">
                  {dataset.name}
                </h2>
                <p className="mt-3 max-w-[54ch] text-[0.98rem] leading-relaxed text-ink-muted">
                  {dataset.description}
                </p>
                <Link
                  href={`/datasets/${dataset.slug}`}
                  className="mt-5 inline-block text-[0.9rem] font-medium text-accent hover:underline"
                >
                  Explore the matrix →
                </Link>
              </div>

              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-rule bg-rule">
                <Stat label="Release" value={dataset.release} />
                <Stat label="Cells" value={String(factCount)} />
                <Stat
                  label="Point coverage"
                  value={`${dataset.provenance?.coverage?.point_coverage ?? "—"}/80`}
                />
                <Stat
                  label="Empty, by name"
                  value={String(dataset.provenance?.coverage?.n_empty_cells ?? "—")}
                />
              </dl>
            </div>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------ The columns */}
      <section>
        <div className="mx-auto max-w-6xl px-5 py-16">
          <div className="mb-8 flex items-end justify-between gap-4">
            <h2 className="font-serif text-[1.7rem] font-semibold tracking-[-0.02em]">
              Latest columns
            </h2>
            <Link
              href="/columns"
              className="shrink-0 text-[0.88rem] font-medium text-accent hover:underline"
            >
              All columns →
            </Link>
          </div>

          {feed.length === 0 ? (
            <p className="rounded-xl border border-rule bg-paper-raised p-8 text-center text-ink-muted">
              Nothing published yet. Run <code className="font-mono">npm run db:seed</code>{" "}
              to load the demo columns.
            </p>
          ) : (
            <ul className="grid gap-x-8 gap-y-px sm:grid-cols-2">
              {feed.map((item) => (
                <ColumnCard key={item.id} item={item} />
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* --------------------------------------------------------- CTA band */}
      <section className="border-t border-rule bg-paper-sunken">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-5 py-14 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-serif text-[1.45rem] font-semibold tracking-[-0.02em]">
              Two columns a week. Every number checked.
            </h2>
            <p className="mt-2 max-w-[50ch] text-[0.92rem] text-ink-muted">
              Members get the full archive, the claim inspector, and the
              dataset explorer. Free readers get the open columns in full.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <CheckBadge conclusion="passing" size="md" />
            <Link
              href="/pricing"
              className="shrink-0 rounded-md bg-accent px-5 py-2.5 text-[0.92rem] font-medium text-white transition-colors hover:bg-accent-hover"
            >
              See plans
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function Feature({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div>
      <p className="font-mono text-[0.72rem] text-accent">{n}</p>
      <h3 className="mt-2 font-serif text-[1.08rem] font-semibold">{title}</h3>
      <p className="mt-2 text-[0.9rem] leading-relaxed text-ink-muted">{body}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-paper-raised p-4">
      <dt className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-ink-faint">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-[1.05rem] tnum">{value}</dd>
    </div>
  );
}
