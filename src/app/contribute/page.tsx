import type { Metadata } from "next";
import Link from "next/link";

import { registry } from "@/lib/signaling/registry";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Run a node",
  description:
    "Your work stays on your machine. Receptorome brokers the connection and holds no copy.",
};

export default async function ContributePage() {
  const online = registry().list();

  return (
    <main className="mx-auto max-w-[46rem] px-5 py-12 sm:py-16">
      <header className="border-b border-rule pb-8">
        <h1 className="font-serif text-[2.1rem] font-semibold tracking-[-0.025em] sm:text-[2.5rem]">
          Publishing here means running something
        </h1>
        <p className="mt-3 text-[1rem] leading-relaxed text-ink-muted">
          There is no upload. A Receptorome node reads your columns off your own
          disk and serves them to readers directly; the platform is told an id,
          a title and an address, in memory, for as long as you keep serving.
          Close the process and your work leaves the site.
        </p>
      </header>

      <div className="prose mt-10">
        <h2>Start a node</h2>
        <p>
          The repository ships one, with the receptorome dataset and a handful
          of columns as its example content. Point it at your own directory and
          it serves that instead.
        </p>
      </div>

      <pre className="scroll-x mt-5 overflow-x-auto rounded-xl border border-rule bg-paper-sunken p-5 font-mono text-[0.8rem] leading-relaxed">
        {`npm run node:serve

# or, with your own identity and port
npm run node:serve -- --port 4600 --name "Your Name"`}
      </pre>

      <div className="prose mt-8">
        <p>
          The node announces what it serves, then heartbeats to keep the lease
          alive. On <code>Ctrl-C</code> it withdraws, and the platform forgets
          it immediately — there is nothing to clean up, because the
          announcement was the only record.
        </p>

        <h2>What the platform learns</h2>
        <p>Exactly this, in memory, until your lease lapses:</p>
      </div>

      <div className="mt-5 overflow-x-auto rounded-xl border border-rule">
        <table className="w-full text-[0.85rem]">
          <thead>
            <tr className="border-b border-rule bg-paper-sunken text-left">
              <Th>Field</Th>
              <Th>What it is</Th>
            </tr>
          </thead>
          <tbody>
            <Row field="sub" note="Your pseudonymous subject. Not an email, and not reversible to one." />
            <Row field="displayName" note="Whatever name you choose to serve under." />
            <Row field="address" note="Where readers should fetch from. Stated by you, never read off the socket." />
            <Row field="items" note="Ids, titles, tags. Enough to link to you; not enough to be a copy." />
          </tbody>
        </table>
      </div>

      <div className="prose mt-8">
        <p>
          Never written to disk, never logged, and gone when the lease lapses.
          The residual exposure is stated plainly in the contracts: while you
          are connected, the platform holds the association between your
          subject and a network address in RAM, and an operator could observe
          that.
        </p>

        <h2>What this costs you</h2>
        <ul>
          <li>
            <strong>No archive.</strong> Readers cannot cite your column and
            expect it next year unless you are still serving it.
          </li>
          <li>
            <strong>No reach while offline.</strong> A closed laptop is an
            unreachable column, and the page a reader lands on cannot even name
            it.
          </li>
          <li>
            <strong>You are the host.</strong> Bandwidth, uptime and
            reachability are yours. The default address is localhost, which is
            the honest starting point: a tunnel or a public address is a
            deliberate step you take.
          </li>
        </ul>
        <p>
          In exchange, nobody can take your work down, change it, or keep
          serving it after you have stopped standing behind it.
        </p>
      </div>

      <section className="mt-10 rounded-xl border border-rule bg-paper-sunken p-5">
        <h2 className="font-serif text-[1.15rem] font-semibold">
          {online.length > 0 ? "Serving right now" : "Nobody is serving"}
        </h2>
        {online.length === 0 ? (
          <p className="mt-2 text-[0.9rem] text-ink-muted">
            Start a node and it appears here within a second or two.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {online.map((presence) => (
              <li
                key={presence.sub}
                className="flex flex-wrap items-baseline gap-x-3 text-[0.88rem]"
              >
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-verified" aria-hidden />
                  {presence.displayName}
                </span>
                <span className="text-ink-muted">
                  {presence.items.length} items
                </span>
                <span className="font-mono text-[0.74rem] text-ink-faint">
                  {presence.address}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link
          href="/read"
          className="mt-4 inline-block text-[0.88rem] font-medium text-accent hover:underline"
        >
          Read what is online →
        </Link>
      </section>
    </main>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-[0.72rem] font-semibold uppercase tracking-[0.06em] text-ink-faint">
      {children}
    </th>
  );
}

function Row({ field, note }: { field: string; note: string }) {
  return (
    <tr className="border-b border-rule align-top last:border-0">
      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[0.8rem]">
        {field}
      </td>
      <td className="px-4 py-2.5 leading-relaxed text-ink-muted">{note}</td>
    </tr>
  );
}
