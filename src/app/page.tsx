import Link from "next/link";

import { registry } from "@/lib/signaling/registry";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const online = registry().list();
  const items = online.flatMap((presence) =>
    presence.items.map((item) => ({ item, sub: presence.sub })),
  );

  return (
    <main>
      {}
      <section className="border-b border-rule">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
          <div className="max-w-3xl">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-rule bg-paper-raised px-3 py-1 text-[0.72rem] font-medium uppercase tracking-[0.08em] text-ink-muted">
              <span
                className={`h-1.5 w-1.5 rounded-full ${online.length > 0 ? "bg-verified" : "bg-stale"}`}
              />
              {online.length > 0
                ? `${online.length} contributor${online.length === 1 ? "" : "s"} serving right now`
                : "Nobody is serving right now"}
            </p>

            <h1 className="font-serif text-[2.6rem] font-semibold leading-[1.08] tracking-[-0.025em] sm:text-[3.6rem]">
              Science writing with a build step.
            </h1>

            <p className="mt-6 max-w-[56ch] text-[1.1rem] leading-relaxed text-ink-muted">
              A review article is frozen the day it is written. The databases
              underneath it are not. Cephroom columns state their numbers as
              queries against a dataset, and every reader&rsquo;s browser
              re-runs them on the way in — so a sentence that has quietly
              become wrong says so on the page.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/read"
                className="rounded-md bg-accent px-5 py-2.5 text-[0.92rem] font-medium text-accent-ink transition-colors hover:bg-accent-hover"
              >
                {online.length > 0 ? "Read what is online" : "See what is online"}
              </Link>
              <Link
                href="/how-it-works"
                className="rounded-md border border-field-border px-5 py-2.5 text-[0.92rem] font-medium text-ink transition-colors hover:border-ink-faint"
              >
                How it works
              </Link>
            </div>
          </div>

          {}
          <figure className="mt-14 max-w-3xl rounded-xl border border-rule bg-paper-raised p-5 sm:p-7">
            <figcaption className="mb-4 text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-ink-faint">
              What an author writes
            </figcaption>
            <pre
              className="scroll-x overflow-x-auto rounded-lg border border-rule bg-paper-sunken p-4 font-mono text-[0.78rem] leading-relaxed text-ink-muted"
              role="group"
              aria-label="Example column source - scroll to see more"
              tabIndex={0}
            >
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
              Fetched from the author&rsquo;s machine and checked against the
              dataset in your own browser, a few hundred milliseconds ago. Not
              a badge from a build that ran three weeks back.
            </p>
          </figure>
        </div>
      </section>

      {}
      <section className="border-b border-rule bg-paper-sunken">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="font-serif text-[1.7rem] font-semibold tracking-[-0.02em]">
            Two constraints, and what follows from them
          </h2>
          <p className="mt-3 max-w-[62ch] text-[0.98rem] leading-relaxed text-ink-muted">
            Most of what this platform does not do is not an omission. It is
            what is left after taking two rules seriously.
          </p>

          <div className="mt-10 grid gap-10 md:grid-cols-2">
            <div>
              <p className="font-mono text-[0.72rem] text-accent">01</p>
              <h3 className="mt-2 font-serif text-[1.25rem] font-semibold">
                Nothing about you is kept
              </h3>
              <p className="mt-2 max-w-[52ch] text-[0.92rem] leading-relaxed text-ink-muted">
                No user table, no profile, no session store, and no copy of
                your subscription. You sign in with Google to prove who you
                are, and walk away with a signed key that says what you may
                read. Every check after that is a signature, not a lookup.
              </p>
              <ul className="mt-4 space-y-2 text-[0.88rem] text-ink-muted">
                <Consequence>
                  Your plan is read from Stripe when the key is issued, because
                  Stripe is the only party allowed to remember anything.
                </Consequence>
                <Consequence>
                  Keys cannot be revoked, only outlived. They last fifteen
                  minutes and renew quietly.
                </Consequence>
                <Consequence>
                  There is no password, because a password is something we
                  would have to store.
                </Consequence>
              </ul>
            </div>

            <div>
              <p className="font-mono text-[0.72rem] text-accent">02</p>
              <h3 className="mt-2 font-serif text-[1.25rem] font-semibold">
                Nothing anyone writes is kept either
              </h3>
              <p className="mt-2 max-w-[52ch] text-[0.92rem] leading-relaxed text-ink-muted">
                A contributor&rsquo;s work lives on their own machine and is
                served from there. Cephroom brokers the connection and holds no
                copy — your browser fetches the bytes from theirs. Stop the
                process and the work leaves the site immediately.
              </p>
              <ul className="mt-4 space-y-2 text-[0.88rem] text-ink-muted">
                <Consequence>
                  There is no archive. You can only read what someone is
                  standing behind right now.
                </Consequence>
                <Consequence>
                  Discovery is presence. Search reaches what is online, because
                  an index of everything would be a copy of everything.
                </Consequence>
                <Consequence>
                  Claims are checked in your browser at read time, so a green
                  badge is never stale.
                </Consequence>
              </ul>
            </div>
          </div>

          <Link
            href="/how-it-works#contracts"
            className="mt-9 inline-block text-[0.9rem] font-medium text-accent hover:underline"
          >
            Read the contracts, including where they bend →
          </Link>
        </div>
      </section>

      {}
      <section>
        <div className="mx-auto max-w-6xl px-5 py-16">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <h2 className="font-serif text-[1.7rem] font-semibold tracking-[-0.02em]">
              {online.length > 0 ? "Online now" : "Nothing is online"}
            </h2>
            {online.length > 0 && (
              <Link
                href="/read"
                className="shrink-0 text-[0.88rem] font-medium text-accent hover:underline"
              >
                All of it →
              </Link>
            )}
          </div>

          {online.length === 0 ? (
            <div className="rounded-xl border border-rule bg-paper-raised p-8">
              <p className="max-w-[58ch] text-[0.95rem] leading-relaxed text-ink-muted">
                This is not an error state. Cephroom holds nothing, so when no
                contributor is running a node there is genuinely nothing here
                to show — and no cached copy to fall back on.
              </p>
              <Link
                href="/contribute"
                className="mt-5 inline-block rounded-md bg-accent px-5 py-2.5 text-[0.9rem] font-medium text-accent-ink transition-colors hover:bg-accent-hover"
              >
                Run a node
              </Link>
            </div>
          ) : (
            <ul className="grid gap-x-8 gap-y-px sm:grid-cols-2">
              {items.slice(0, 6).map(({ item, sub }) => (
                <li key={`${sub}-${item.id}`} className="border-b border-rule">
                  <Link
                    href={`/read/${encodeURIComponent(sub)}/${encodeURIComponent(item.id)}`}
                    className="group block py-6"
                  >
                    <p className="mb-1.5 text-[0.72rem] uppercase tracking-[0.06em] text-ink-faint">
                      {item.kind}
                    </p>
                    <h3 className="font-serif text-[1.2rem] font-semibold leading-snug group-hover:underline">
                      {item.title}
                    </h3>
                    {item.summary && (
                      <p className="mt-2 max-w-[56ch] text-[0.9rem] leading-relaxed text-ink-muted">
                        {item.summary}
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}

function Consequence({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        aria-hidden
        className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-accent"
      />
      <span>{children}</span>
    </li>
  );
}
