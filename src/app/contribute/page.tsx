import type { Metadata } from "next";
import Link from "next/link";

import { registry } from "@/lib/signaling/registry";
import {
  formatPrice,
  SERVING_CAPACITY,
  SERVING_ORDER,
  SERVING_PLANS,
} from "@/lib/stripe/plans";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Run a node",
  description:
    "Your work stays on your machine. Cephroom brokers the connection and holds no copy.",
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
          There is no upload. A Cephroom node reads your columns off your own
          disk and serves them to readers directly; the platform is told an id,
          a title and an address, in memory, for as long as you keep serving.
          Close the process and your work leaves the site.
        </p>
        <p className="mt-3 text-[1rem] leading-relaxed text-ink-muted">
          <strong className="font-semibold text-ink">
            Serving is free and stays free.
          </strong>{" "}
          No account is needed to serve at all, and nothing you publish is
          ever gated by what a reader has paid us — whoever finds your work
          gets all of it. What you charge for it, if anything, is arranged
          between you and them and we are not told.
        </p>
      </header>

      <div className="prose mt-10">
        <h2>Start a node</h2>
        <p>
          Clone the repository and run the node it ships. With no arguments it
          serves the demo content — the receptorome-ki dataset and a handful of
          example columns — so you can see the whole loop working before you
          point it anywhere.
        </p>
      </div>

      <pre
        className="scroll-x mt-5 overflow-x-auto rounded-xl border border-rule bg-paper-sunken p-5 font-mono text-[0.8rem] leading-relaxed"
        role="group"
        aria-label="Command - scroll to see more"
        tabIndex={0}
      >
        {`git clone <this repo> && cd cephroom && npm install
npm run node:serve                       # serves the demo content`}
      </pre>

      <div className="prose mt-8">
        <h3>Serve your own work</h3>
        <p>
          A column is a Markdown file with front matter (a <code>slug</code>{" "}
          and a <code>title</code>; a <code>subtitle</code>, <code>repo</code>{" "}
          and <code>commit</code>{" "}
          if you have them). Put your columns in a
          directory and point the node at it. That directory <em>is</em>{" "}
          your
          manifest — the node serves every <code>.md</code>{" "}
          file it finds, whole, to whoever asks. There is no field for
          withholding part of one.
        </p>
      </div>

      <pre
        className="scroll-x mt-5 overflow-x-auto rounded-xl border border-rule bg-paper-sunken p-5 font-mono text-[0.8rem] leading-relaxed"
        role="group"
        aria-label="Command - scroll to see more"
        tabIndex={0}
      >
        {`npm run node:serve -- \\
  --content ./my-columns \\
  --name "Your Name" \\
  --pay-to "ko-fi.com/you, or a wallet, or nothing" \\
  --port 4600`}
      </pre>

      <div className="prose mt-8">
        <p>
          The node announces what it serves, then heartbeats to keep the lease
          alive. On <code>Ctrl-C</code>{" "}
          it withdraws, and the platform forgets
          it immediately — there is nothing to clean up, because the
          announcement was the only record.
        </p>

        <h3>Serving under your own identity</h3>
        <p>
          Every announcement is signed. In this local build the node borrows
          the platform&rsquo;s signing key and serves under a default subject,
          which is fine for trying it out. To serve as <em>you</em> — so your
          work is namespaced to your subject and nobody else can announce under
          it — sign in, and set the key you are issued as{" "}
          <code>NODE_KEY</code>{" "}
          in the node&rsquo;s environment.
        </p>

        <h2>What the platform learns</h2>
        <p>Exactly this, in memory, until your lease lapses:</p>
      </div>

      <div
        className="mt-5 overflow-x-auto rounded-xl border border-rule"
        role="region"
        aria-label="Table - scroll sideways for more columns"
        tabIndex={0}
      >
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
            <Row
              field="payTo"
              note="Whatever you said in --pay-to, repeated verbatim to readers. Absent if you set nothing. Never parsed, never used to route anything."
            />
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
        <p>
          <strong>And so can anyone else.</strong>{" "}
          That table is the public listing —{" "}
          <code className="font-mono text-[0.82rem]">/api/v1/live</code>{" "}
          answers it to any stranger with no key and no sign-in, because a
          reader who cannot find you cannot read you. What follows is not
          obvious and is worth saying out loud: anybody can ask it on a timer.
          Nothing here keeps a history, but a poller can keep their own, and
          what they get is a record of when your machine is on and off. If you
          serve from the laptop you carry around, that is a record of when you
          are at your desk.
        </p>
        <p>
          There is no version of discovery that avoids it, so it is not
          presented as solved. What you can do about it is put the node
          somewhere that is always on, or accept that your working hours are
          visible to whoever cares to watch over time.
        </p>

        <h2 className="mt-14 font-serif text-[1.35rem] font-semibold tracking-[-0.02em]">
        Getting paid
      </h2>
      <p className="mt-3 max-w-[62ch] text-[0.95rem] leading-relaxed text-ink-muted">
        Directly, by readers, outside this platform. Whatever you put in{" "}
        <code className="font-mono text-[0.82rem]">--pay-to</code>{" "}
        is shown at the foot of your columns, verbatim — a wallet address, a
        page, an institutional account, or a sentence saying not to bother.
      </p>
      <p className="mt-3 max-w-[62ch] text-[0.95rem] leading-relaxed text-ink-muted">
        Cephroom is not a party to any of it. We do not calculate an amount,
        hold anything, route a transfer, or record that one happened, and we
        take no share. We also never pay you ourselves — no bonuses, no
        incentives for popular columns. That is a rule in the contracts rather
        than a current limitation, and{" "}
        <Link href="/how-it-works#contracts" className="text-accent hover:underline">
          the reason is written down
        </Link>
        : a platform that pays out of a pool can have that pool drained by two
        people who agree to say a transfer happened, and we cannot tell,
        because we do not watch what moves between you and a reader.
      </p>

      <h2>What this costs you</h2>
        <ul>
          <li>
            <strong>No archive.</strong>{" "}
            Readers cannot cite your column and
            expect it next year unless you are still serving it.
          </li>
          <li>
            <strong>No reach while offline.</strong>{" "}
            A closed laptop is an
            unreachable column, and the page a reader lands on cannot even name
            it.
          </li>
          <li>
            <strong>You are the host.</strong>{" "}
            Bandwidth, uptime and
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

      <div id="plans" className="prose mt-14 scroll-mt-20">
        <h2>If you need more room</h2>
        <p>
          One subscription exists on this side, and it buys exactly one thing:
          how many items you can have listed at once. Not reach, not ranking,
          not readers. Every contributor who is online gets the same share of
          whatever listing is being built, whatever they pay; what a plan
          changes is how much of your work is eligible to fill your share, not
          how large the share is. If it did change the share, we would be
          selling somebody else&rsquo;s search results.
        </p>
        <p>
          The free plan announces{" "}
          {SERVING_CAPACITY.desk}{" "}
          items. A researcher serving their own columns and the datasets behind
          them is well inside that and will never meet it. It is there for
          groups and institutions with a whole collection online.
        </p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {SERVING_ORDER.map((id) => {
          const plan = SERVING_PLANS[id];
          return (
            <article
              key={id}
              className="flex flex-col rounded-xl border border-rule bg-paper-raised p-5"
            >
              <h3 className="font-serif text-[1.1rem] font-semibold">
                {plan.name}
              </h3>
              <p className="mt-1 text-[0.83rem] leading-relaxed text-ink-muted">
                {plan.tagline}
              </p>
              <p className="mt-4 font-mono text-[1.4rem] leading-none tnum">
                {plan.prices ? formatPrice(plan.prices.month.unitAmount) : "$0"}
                <span className="ml-1 font-sans text-[0.78rem] font-normal text-ink-faint">
                  {plan.prices ? "/mo" : " — free"}
                </span>
              </p>
              <ul className="mt-4 flex-1 space-y-1.5 text-[0.83rem] text-ink-muted">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>

      <p className="mt-5 max-w-[62ch] text-[0.86rem] leading-relaxed text-ink-faint">
        Readers pay us separately, for searching. None of it reaches you, and
        none of it obliges you to treat one reader differently from another —
        there is no way for us to tell you which is which, and nothing in your
        node to act on if there were.
      </p>

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
