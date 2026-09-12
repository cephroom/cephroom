import type { Metadata } from "next";
import Link from "next/link";

import { registry } from "@/lib/signaling/registry";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reading now",
  description:
    "Everything being served right now. Cephroom has no archive — discovery is presence.",
};

const ACCESS_CHIP: Record<string, string | null> = {
  public: null,
  member: "Member",
  lab: "Lab",
};

export default async function ReadPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;

  const located = registry().search(q);
  const columns = located.filter((entry) => entry.item.kind === "column");
  const datasets = located.filter((entry) => entry.item.kind === "dataset");
  const nodes = registry().list();

  return (
    <main className="mx-auto max-w-6xl px-5 py-12 sm:py-16">
      <header className="border-b border-rule pb-8">
        <h1 className="font-serif text-[2.1rem] font-semibold tracking-[-0.025em] sm:text-[2.6rem]">
          Reading now
        </h1>
        <p className="mt-3 max-w-[60ch] text-[1rem] leading-relaxed text-ink-muted">
          Everything below is being served from a contributor&rsquo;s own
          machine, right now. Cephroom holds none of it. When someone stops
          serving, their work leaves this page — not because it was deleted,
          but because being served was the only reason it was here.
        </p>

        <form action="/read" className="mt-6 flex max-w-md gap-2">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search what is online"
            aria-label="Search"
            className="w-full rounded-md border border-field-border bg-paper-raised px-3 py-2 text-[0.9rem] outline-none transition-colors placeholder:text-ink-faint focus:border-accent"
          />
          <button
            type="submit"
            className="shrink-0 rounded-md bg-accent px-4 py-2 text-[0.88rem] font-medium text-accent-ink transition-colors hover:bg-accent-hover"
          >
            Search
          </button>
        </form>

        {/* During a search the counts describe the matches; otherwise they
            describe everything online. Mixing an unfiltered "contributors
            online" with filtered item counts read as a discrepancy mid-search,
            so the labels change with the mode. */}
        <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-[0.82rem]">
          {q.trim() ? (
            <>
              <Stat
                label="Contributors matched"
                value={String(
                  new Set(located.map((entry) => entry.presence.sub)).size,
                )}
              />
              <Stat label="Columns matched" value={String(columns.length)} />
              <Stat label="Datasets matched" value={String(datasets.length)} />
            </>
          ) : (
            <>
              <Stat label="Contributors online" value={String(nodes.length)} />
              <Stat label="Columns" value={String(columns.length)} />
              <Stat label="Datasets" value={String(datasets.length)} />
            </>
          )}
        </dl>
      </header>

      {nodes.length === 0 ? (
        <Empty query={q} />
      ) : (
        <>
          {columns.length > 0 && (
            <section className="mt-2">
              <ul className="grid gap-x-10 sm:grid-cols-2">
                {columns.map(({ presence, item }) => {
                  const chip = ACCESS_CHIP[item.access ?? "public"];
                  return (
                    <li
                      key={`${presence.sub}-${item.id}`}
                      className="border-b border-rule"
                    >
                      <Link
                        href={`/read/${encodeURIComponent(presence.sub)}/${encodeURIComponent(item.id)}`}
                        className="group block py-7"
                      >
                        <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.78rem] text-ink-faint">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="h-1.5 w-1.5 rounded-full bg-verified"
                              aria-hidden
                            />
                            {presence.displayName}
                          </span>
                          <span aria-hidden>·</span>
                          <span>serving live</span>
                          {chip && (
                            <span className="rounded-full border border-rule-strong px-1.5 py-px text-[0.68rem] font-medium uppercase tracking-[0.06em] text-ink-muted">
                              {chip}
                            </span>
                          )}
                        </div>

                        <h2 className="font-serif text-[1.32rem] font-semibold leading-snug tracking-[-0.015em] decoration-accent/40 underline-offset-4 group-hover:underline">
                          {item.title}
                        </h2>

                        {item.summary && (
                          <p className="mt-2 max-w-[60ch] text-[0.92rem] leading-relaxed text-ink-muted">
                            {item.summary}
                          </p>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {datasets.length > 0 && (
            <section className="mt-12">
              <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-ink-faint">
                Datasets being served
              </h2>
              <ul className="mt-3 space-y-3">
                {datasets.map(({ presence, item }) => (
                  <li
                    key={`${presence.sub}-${item.id}`}
                    className="rounded-xl border border-rule bg-paper-raised p-5"
                  >
                    <Link
                      href={`/read/${encodeURIComponent(presence.sub)}/${encodeURIComponent(item.id)}`}
                      className="font-serif text-[1.15rem] font-semibold hover:underline"
                    >
                      {item.title}
                    </Link>
                    <p className="mt-1.5 max-w-[62ch] text-[0.88rem] leading-relaxed text-ink-muted">
                      {item.summary}
                    </p>
                    <p className="mt-2 text-[0.76rem] text-ink-faint">
                      served by {presence.displayName}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {located.length === 0 && <Empty query={q} />}
        </>
      )}
    </main>
  );
}

function Empty({ query }: { query: string }) {
  return (
    <div className="mt-10 rounded-xl border border-rule bg-paper-raised px-6 py-12 text-center">
      <h2 className="font-serif text-[1.3rem] font-semibold">
        {query ? "Nothing online matches that" : "Nobody is serving anything"}
      </h2>
      <p className="mx-auto mt-3 max-w-[50ch] text-[0.92rem] leading-relaxed text-ink-muted">
        {query
          ? "Search only reaches what is being served right now. There is no index of what has existed, because keeping one would mean the platform holding a copy."
          : "Cephroom has no archive. Nothing is stored here, so when no contributor is running a node there is genuinely nothing to show."}
      </p>
      <Link
        href="/contribute"
        className="mt-5 inline-block rounded-md border border-field-border px-4 py-2 text-[0.88rem] font-medium transition-colors hover:border-ink-faint"
      >
        Run a node
      </Link>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-faint">{label}</dt>
      <dd className="mt-0.5 font-mono text-[1.05rem] tnum">{value}</dd>
    </div>
  );
}
