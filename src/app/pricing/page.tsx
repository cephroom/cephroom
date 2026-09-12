import type { Metadata } from "next";
import Link from "next/link";

import { PricingTable } from "@/components/pricing-table";
import { getViewer } from "@/lib/auth/session";
import { startCheckout } from "@/lib/stripe/actions";
import { usingRealStripe } from "@/lib/stripe/gateway";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Plans",
  description:
    "Open columns are free to read. Member unlocks member columns and the claim inspector.",
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
        <p className="mt-3 text-[1rem] leading-relaxed text-ink-muted">
          Membership pays for running the broker and building the reading
          tools. It does not pay for hosting, because nothing is hosted here —
          and it does not yet pay contributors, which is the part of this we
          are least happy with and are saying out loud rather than implying
          otherwise.
        </p>
        <p className="mt-3 text-[1rem] leading-relaxed text-ink-muted">
          Publishing is free and always will be. Running a node costs you
          nothing here, at any tier, and we take no share of anything you
          choose to charge for from your own machine.
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
        currentTier={viewer.tier}
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
            Open columns in full, every claim value, and every verdict. What
            you do not get is the inspector behind each number, or the columns
            their authors have marked member-only.
          </Faq>
          <Faq q="Can I cancel?">
            Any time, from your key page. Cancellation takes effect at the end
            of the period you have already paid for. Because your tier lives
            in a signed key rather than a database row, the change reaches you
            when the key next renews — within fifteen minutes at worst.
          </Faq>
          <Faq q="What happens if my card fails?">
            Nothing immediately. Stripe retries over several days and you keep
            reading throughout. We show a banner asking you to update the card,
            and access ends only if the retries are exhausted.
          </Faq>
          <Faq q="What do you store about me?">
            Nothing. No account, no profile, no session, and no copy of your
            subscription. Stripe holds your email and card because someone has
            to hold a payment relationship; we never copy it back.
          </Faq>
          <Faq q="Can I publish here?">
            Anyone signed in can, at any tier, including the free one. Run a
            node and your work is discoverable for as long as you serve it.
            Until cycle 3 the Lab plan listed serving among the things $29 a
            month bought you; it never did, and the line is gone.
          </Faq>
          <Faq q="I cannot afford this.">
            Take the reduced rate. It is the same membership at $36 a year, it
            is there for students, people between posts, and anyone paying out
            of their own pocket, and nobody is asked to prove anything —
            proving would mean us keeping a record of who proved it.
          </Faq>
          <Faq q="Do contributors get paid?">
            Not by us, not yet, and we would rather say so than let the
            pricing imply otherwise. A contributor can charge from their own
            node today, with their own payment relationship, and we take no
            cut of it because the money never passes through here. A share of
            membership going back to the people whose work you came to read is
            the open question on this design — the honest obstacle is that
            splitting revenue fairly means counting who read what, and that
            ledger is the thing Contract 1 forbids.
          </Faq>
          <Faq q="What happens if the site goes down?">
            Nothing happens to anyone's work. It was never here. Contributors
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
