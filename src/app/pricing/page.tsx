import type { Metadata } from "next";
import Link from "next/link";

import { PricingTable } from "@/components/pricing-table";
import { getViewer } from "@/lib/entitlements";
import { startCheckout } from "@/lib/stripe/actions";
import { usingRealStripe } from "@/lib/stripe/gateway";

export const metadata: Metadata = {
  title: "Plans",
  description:
    "Read the open columns free. Member unlocks the archive, the claim inspector and the dataset explorer.",
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
          Checking claims against a versioned dataset costs something to run.
          Membership is what pays for it, and for the writing.
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
          <strong className="font-semibold">Local billing mode.</strong> No
          Stripe key is configured, so checkout runs against a local stand-in
          that signs and delivers real webhook events to this application. Set{" "}
          <code className="font-mono">STRIPE_SECRET_KEY</code> to switch to
          Stripe test mode, and a live key to go live.
        </p>
      )}

      <PricingTable
        currentPlan={viewer.plan}
        signedIn={Boolean(viewer.id)}
        checkoutAction={startCheckout}
        from={params.from ?? "/pricing"}
      />

      <section className="mt-16 border-t border-rule pt-10">
        <h2 className="font-serif text-[1.4rem] font-semibold tracking-[-0.02em]">
          Questions people actually ask
        </h2>
        <dl className="mt-6 grid gap-x-10 gap-y-7 sm:grid-cols-2">
          <Faq q="What do I get for free?">
            Open columns in full, every claim value, and every build badge.
            What you do not get is the inspector behind each number, member
            columns, or the dataset explorer.
          </Faq>
          <Faq q="Can I cancel?">
            Any time, from your account page. Cancellation takes effect at the
            end of the period you have already paid for — you keep access until
            then, and nothing is prorated away from you.
          </Faq>
          <Faq q="What happens if my card fails?">
            Nothing immediately. Stripe retries over several days and you keep
            reading throughout. We show a banner asking you to update the card,
            and access ends only if the retries are exhausted.
          </Faq>
          <Faq q="Is the data yours?">
            No, and that is the point. The receptorome dataset is derived from
            ChEMBL under CC BY-SA 3.0 and every value traces back to a
            published measurement. We add the checking, not the numbers.
          </Faq>
          <Faq q="Can I publish here?">
            Lab includes authoring with your own datasets. If you want to write
            a one-off column, propose it — the studio is open to any member
            whose proposal is accepted.
          </Faq>
          <Faq q="Institutional access?">
            Not yet. Lab covers small groups; if you need seats for a
            department, say so and we will work out what that looks like.
          </Faq>
        </dl>
      </section>

      <p className="mt-12 text-[0.85rem] text-ink-muted">
        Still deciding?{" "}
        <Link href="/columns" className="font-medium text-accent hover:underline">
          Read the open columns first
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
