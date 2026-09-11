import { notFound, redirect } from "next/navigation";

import { usingRealStripe } from "@/lib/stripe/gateway";
import {
  completeCheckout,
  declineCheckout,
  readSession,
} from "@/lib/stripe/local";
import { formatPrice, PLANS } from "@/lib/stripe/plans";

/**
 * Stands in for Stripe's hosted checkout page while no Stripe key is
 * configured. Choosing an outcome here drives the local gateway, which signs
 * and posts the corresponding webhook events to the application's real
 * webhook route — so the decline path is as exercisable as the happy one.
 */
export default async function LocalCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  if (usingRealStripe()) notFound();

  const { session: sessionId } = await searchParams;
  const session = sessionId ? readSession(sessionId) : null;
  if (!session) notFound();

  const plan = PLANS[session.plan];
  const price = plan.prices[session.interval];

  async function pay() {
    "use server";
    await completeCheckout(sessionId!);
    redirect(session!.successUrl);
  }

  async function decline() {
    "use server";
    await declineCheckout(sessionId!);
    redirect(`${session!.successUrl}&outcome=declined`);
  }

  async function abandon() {
    "use server";
    redirect(session!.cancelUrl);
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-6xl items-center justify-center px-5 py-12">
      <div className="w-full max-w-[26rem]">
        <p className="mb-4 rounded-lg border border-drifted/30 bg-drifted-wash px-3 py-2 text-[0.78rem] leading-relaxed text-drifted">
          Local checkout stand-in. Stripe is not configured, so this page
          replaces Stripe Checkout. Whichever outcome you pick sends genuinely
          signed webhook events to <code className="font-mono">/api/stripe/webhook</code>.
        </p>

        <div className="rounded-xl border border-rule bg-paper-raised p-6">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-ink-faint">
            Subscribe to Bindery
          </p>
          <h1 className="mt-2 font-serif text-[1.5rem] font-semibold tracking-[-0.02em]">
            {plan.name}
          </h1>

          <p className="mt-4 flex items-baseline gap-1.5">
            <span className="font-mono text-[2rem] leading-none tnum">
              {formatPrice(price.unitAmount)}
            </span>
            <span className="text-[0.85rem] text-ink-faint">
              per {session.interval}
            </span>
          </p>

          <dl className="mt-5 space-y-1.5 border-t border-rule pt-4 text-[0.8rem]">
            <Row label="Customer" value={session.customerId} />
            <Row label="Price" value={price.priceId} />
            <Row label="Session" value={session.id} />
          </dl>

          <div className="mt-5 rounded-lg border border-rule bg-paper-sunken p-3">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-ink-faint">
              Card
            </p>
            <p className="mt-1.5 font-mono text-[0.9rem] tnum text-ink-muted">
              4242 4242 4242 4242 · 12/34 · 123
            </p>
          </div>

          <div className="mt-5 space-y-2.5">
            <form action={pay}>
              <button
                type="submit"
                className="w-full rounded-md bg-accent px-4 py-2.5 text-[0.9rem] font-medium text-white transition-colors hover:bg-accent-hover"
              >
                Pay {formatPrice(price.unitAmount)}
              </button>
            </form>

            <form action={decline}>
              <button
                type="submit"
                className="w-full rounded-md border border-broken/40 px-4 py-2.5 text-[0.88rem] font-medium text-broken transition-colors hover:bg-broken-wash"
              >
                Simulate a declined card
              </button>
            </form>

            <form action={abandon}>
              <button
                type="submit"
                className="w-full px-4 py-2 text-[0.85rem] text-ink-muted transition-colors hover:text-ink"
              >
                Cancel and go back
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-ink-faint">{label}</dt>
      <dd className="truncate font-mono text-[0.74rem] text-ink-muted">
        {value}
      </dd>
    </div>
  );
}
