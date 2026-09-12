import { notFound, redirect } from "next/navigation";

import { restampKey } from "@/lib/stripe/actions";
import { usingRealStripe } from "@/lib/stripe/gateway";
import { formatPrice } from "@/lib/stripe/plans";

export const dynamic = "force-dynamic";

/**
 * Stands in for Stripe's hosted checkout while no Stripe key is configured.
 * Whichever outcome is chosen moves the simulated counterparty's own records,
 * which the platform then reads back through the ordinary gateway.
 */
export default async function SimulatedCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  if (usingRealStripe()) notFound();

  const { session: sessionId } = await searchParams;
  const store = await import("@simulated/stripe/store");
  const found = sessionId ? store.planFor(sessionId) : null;
  if (!found || !sessionId) notFound();

  const { session, plan, price } = found;

  async function pay() {
    "use server";
    const inner = await import("@simulated/stripe/store");
    inner.completeCheckout(sessionId!);
    // Real Stripe returns the browser to successUrl (the restamp route) as a
    // genuine top-level navigation, so its Set-Cookie lands. This page is a
    // server action instead, and the redirect it throws is followed as an
    // RSC navigation that drops the intermediate route's cookie — so the
    // reader would land on /account still stamped Reader. Re-stamp here, in
    // the action, where cookies().set() actually sticks.
    await restampKey();
    redirect(session.request.successUrl);
  }

  async function decline() {
    "use server";
    const inner = await import("@simulated/stripe/store");
    inner.declineCheckout(sessionId!);
    await restampKey();
    redirect(session.request.successUrl);
  }

  async function abandon() {
    "use server";
    redirect(session.request.cancelUrl);
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-6xl items-center justify-center px-5 py-12">
      <div className="w-full max-w-[26rem]">
        <p className="mb-4 rounded-lg border border-drifted/30 bg-drifted-wash px-3 py-2 text-[0.78rem] leading-relaxed text-drifted">
          Simulated checkout. Stripe is not configured, so a stand-in
          counterparty is holding these records. Set STRIPE_SECRET_KEY and this
          page is replaced by Stripe Checkout.
        </p>

        <div className="rounded-xl border border-rule bg-paper-raised p-6">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-ink-faint">
            Subscribe to Cephroom
          </p>
          <h1 className="mt-2 font-serif text-[1.5rem] font-semibold tracking-[-0.02em]">
            {plan.name}
          </h1>

          <p className="mt-4 flex items-baseline gap-1.5">
            <span className="font-mono text-[2rem] leading-none tnum">
              {formatPrice(price.unitAmount)}
            </span>
            <span className="text-[0.85rem] text-ink-faint">
              per {session.request.interval}
            </span>
          </p>

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
                className="w-full rounded-md bg-accent px-4 py-2.5 text-[0.9rem] font-medium text-accent-ink transition-colors hover:bg-accent-hover"
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
