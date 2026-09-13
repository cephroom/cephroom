import type { Metadata } from "next";
import Link from "next/link";

import { PricingTable } from "@/components/pricing-table";
import { ACTOR_FACE, ACTOR_KINDS } from "@/lib/actor";
import { getViewer } from "@/lib/auth/session";
import { startCheckout } from "@/lib/stripe/actions";
import { usingRealStripe } from "@/lib/stripe/gateway";
import {
  DISCOVERY_ORDER,
  DISCOVERY_PLANS,
  DISCOVERY_RANK,
} from "@/lib/stripe/plans";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Plans",
  description:
    "Everything anyone serves is free to read. A plan buys how far you can search across it.",
};

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; plan?: string; checkout?: string }>;
}) {
  const params = await searchParams;
  const viewer = await getViewer();

  return (
    <main className="mx-auto max-w-6xl px-5 py-12 sm:py-16">
      <header className="max-w-[52ch]">
        <h1 className="font-serif text-[2.1rem] font-semibold tracking-[-0.025em] sm:text-[2.6rem]">
          Plans
        </h1>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-rule bg-paper-sunken px-4 py-3">
          {ACTOR_KINDS.map((kind) => {
            const face = ACTOR_FACE[kind];
            const mine = viewer.sub !== null && viewer.actor === kind;
            return (
              <span
                key={kind}
                className={`inline-flex items-center gap-1.5 text-[0.85rem] ${
                  mine ? "font-semibold text-ink" : "text-ink-muted"
                }`}
              >
                <span aria-hidden className="text-[1.05rem]">
                  {face.symbol}
                </span>
                {face.short}
                {mine && <span className="text-[0.72rem] text-accent">· your key</span>}
              </span>
            );
          })}
          <span className="text-[0.82rem] leading-relaxed text-ink-faint">
            Same plans and the same reach whether you are a person or an AI
            agent — your key records which you chose at sign-in, and it changes
            nothing about the price or what you can do.
          </span>
        </div>

        <p className="mt-3 text-[1rem] leading-relaxed text-ink-muted">
          A plan here buys one thing:{" "}
          <strong>how far you can search.</strong>{" "}
          Everything anyone is serving is readable in full by anybody, on every
          plan and with no account at all. Nothing you pay us unlocks a word of
          it, because none of it is ours to lock.
        </p>
        <p className="mt-3 text-[1rem] leading-relaxed text-ink-muted">
          What is ours is finding things. Work lives on contributors&rsquo;
          own machines, scattered and coming and going; the listing, the
          search across it and the endpoints to crawl it are what this site
          actually provides, and that is what is for sale.
        </p>
        <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-muted">
          Two consequences worth knowing before you pay. Your plan is{" "}
          <strong>not a claim on any contributor</strong>{" "}
          — they are not told what you are on, cannot treat you differently for
          it, and owe you nothing. It also does not pay contributors: if you
          want to support one, that is a separate thing you do directly, and
          we take no share of it. And search reaches{" "}
          <strong>only what is online at the moment you ask</strong>. There is
          no index here, at any price — a node that is switched off is not
          findable, because nothing about it was kept.
        </p>
        <p className="mt-4 max-w-[62ch] text-[0.95rem] leading-relaxed text-ink-muted">
          And one that costs us a sale, so it belongs here rather than in a
          footnote. A listing gives every contributor who is online the{" "}
          <strong>same share of the page</strong>, whatever anyone pays. While
          the network is small that share, not your plan, is what decides how
          much comes back — so Browse and Query return the same results until
          there are more contributors online than a single page can hold. The
          number on a plan is a ceiling, and you only meet it once the network
          is big enough to reach it. When a search is cut short we tell you
          which of the two did it.
        </p>
      </header>

      {params.checkout === "cancelled" && (
        <p
          role="status"
          className="mt-6 rounded-lg border border-rule bg-paper-raised px-4 py-3 text-[0.88rem] text-ink-muted"
        >
          Checkout cancelled. Nothing was charged.
        </p>
      )}

      {!usingRealStripe() && (
        <p className="mt-6 rounded-lg border border-drifted/30 bg-drifted-wash px-4 py-3 text-[0.84rem] leading-relaxed text-drifted">
          <strong className="font-semibold">Simulated billing.</strong>{" "}
          No Stripe
          key is configured, so checkout runs against a stand-in counterparty
          holding its own records. Set{" "}
          <code className="font-mono">STRIPE_SECRET_KEY</code>{" "}
          to switch to
          Stripe test mode, and a live key to go live.
        </p>
      )}

      <PricingTable
        plans={DISCOVERY_ORDER.map((id) => DISCOVERY_PLANS[id])}
        current={viewer.discovery}
        rank={DISCOVERY_RANK}
        featuredId="query"
        freeNote={{
          current: "Your current plan",
          included: "Included in your plan",
        }}
        signedIn={Boolean(viewer.sub)}
        checkoutAction={startCheckout}
        from={params.from ?? "/pricing"}
      />

      <section className="mt-16 border-t border-rule pt-10">
        <h2 className="font-serif text-[1.4rem] font-semibold tracking-[-0.02em]">
          Questions people actually ask
        </h2>
        <dl className="mt-6 grid gap-x-10 gap-y-7 sm:grid-cols-2">
          <Faq q="What do I get for free?">
            Every column anyone is serving, in full, with every claim value,
            every verdict and the inspector behind each number — without an
            account, and for good. None of that is ours to charge for. What
            the free plan gives you less of is the listing: fifty results to a
            query rather than a thousand, and two nodes at a time rather than
            thirty-two.
          </Faq>
          <Faq q="Can I cancel?">
            Any time, from your key page. Cancellation takes effect at the end
            of the period you have already paid for. Because your plan lives
            in a signed key rather than a database row, the change reaches you
            when the key next renews — within fifteen minutes at worst. What
            changes is how far a query reaches; nothing you could open before
            stops opening.
          </Faq>
          <Faq q="What happens if my card fails?">
            Nothing immediately. Stripe retries over several days and your
            queries keep their reach throughout. We show a banner asking you to
            update the card, and the plan drops to free only once the retries
            are exhausted. Everything on the network stays open to you either
            way — a lapsed card has never been able to close a column, because
            we were never the ones holding it open.
          </Faq>
          <Faq q="What do you store about me?">
            Nothing. No account, no profile, no session, and no copy of your
            subscription. Stripe holds your email and card because someone has
            to hold a payment relationship; we never copy it back.
          </Faq>
          <Faq q="Can I publish here?">
            Yes, and it has nothing to do with this page. Serving your own work
            is free and is arranged separately —{" "}
            <Link href="/contribute" className="text-accent hover:underline">
              how to contribute
            </Link>{" "}
            — so nothing you buy or cancel here changes what you can publish.
          </Faq>
          <Faq q="I cannot afford this.">
            Take the reduced rate. It is the same plan at $36 a year, it is
            there for students, people between posts, and anyone paying out of
            their own pocket, and nobody is asked to prove anything — proving
            would mean us keeping a record of who proved it. Reading costs
            nothing at any point, so the worst case is a shorter listing.
          </Faq>
          <Faq q="Do contributors get paid?">
            Directly, by you, if you decide to. A contributor can put up a
            wallet address or a link, and it shows at the foot of their
            columns. The money goes from you to them; it does not pass through
            us, we take no share, and we do not learn that it happened.
          </Faq>
          <Faq q="Why not just split my subscription with them?">
            Because we would then be paying out of a pool, and two people who
            agree to say a transfer happened could drain it — we cannot tell a
            real 100 MB read from two machines signing that one occurred, and
            we are never going to watch the data to find out. Building defences
            against that was possible and we did build them; removing the pool
            removes the attack instead. Nothing is paid out by us, so nothing
            can be extracted from us.
          </Faq>
          <Faq q="What happens if the site goes down?">
            Nothing happens to anyone&rsquo;s work. It was never here. Contributors
            keep serving; only discovery stops.
          </Faq>
        </dl>
      </section>

      <p className="mt-12 text-[0.85rem] text-ink-muted">
        Still deciding?{" "}
        <Link href="/read" className="font-medium text-accent hover:underline">
          Read what is online first
        </Link>
        .
      </p>
    </main>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-serif text-[1.02rem] font-semibold">{q}</dt>
      <dd className="mt-1.5 text-[0.9rem] leading-relaxed text-ink-muted">
        {children}
      </dd>
    </div>
  );
}
