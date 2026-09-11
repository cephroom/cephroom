import type { Metadata } from "next";

import { ColumnCard } from "@/components/column-card";
import { publishedFeed } from "@/lib/columns";

export const metadata: Metadata = {
  title: "Columns",
  description:
    "Every Bindery column, newest first, with the status of its last claim check.",
};

export default async function ColumnsPage() {
  const feed = await publishedFeed();

  const drifting = feed.filter(
    (item) => item.check.conclusion === "drifted" || item.check.conclusion === "broken",
  ).length;
  const claimTotal = feed.reduce(
    (sum, item) =>
      sum + item.check.verified + item.check.drifted + item.check.broken,
    0,
  );

  return (
    <main className="mx-auto max-w-6xl px-5 py-12 sm:py-16">
      <header className="border-b border-rule pb-8">
        <h1 className="font-serif text-[2.1rem] font-semibold tracking-[-0.025em] sm:text-[2.6rem]">
          Columns
        </h1>
        <p className="mt-3 max-w-[58ch] text-[1rem] leading-relaxed text-ink-muted">
          Pharmacology and neuroscience, written so the numbers can be
          re-checked. Free columns are open to everyone; member columns show
          their opening section and the full claim set.
        </p>

        <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-[0.82rem]">
          <div>
            <dt className="text-ink-faint">Published</dt>
            <dd className="mt-0.5 font-mono text-[1rem] tnum">{feed.length}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">Checked claims</dt>
            <dd className="mt-0.5 font-mono text-[1rem] tnum">{claimTotal}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">Needing attention</dt>
            <dd
              className={`mt-0.5 font-mono text-[1rem] tnum ${
                drifting > 0 ? "text-drifted" : "text-verified"
              }`}
            >
              {drifting}
            </dd>
          </div>
        </dl>
      </header>

      {feed.length === 0 ? (
        <p className="mt-12 rounded-xl border border-rule bg-paper-raised p-8 text-center text-ink-muted">
          No columns published yet.
        </p>
      ) : (
        <ul className="mt-2 grid gap-x-10 sm:grid-cols-2">
          {feed.map((item) => (
            <ColumnCard key={item.id} item={item} />
          ))}
        </ul>
      )}
    </main>
  );
}
