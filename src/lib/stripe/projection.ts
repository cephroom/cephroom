import type { SubscriptionStatus } from "@/lib/access";

import { planForPrice, type BillingInterval, type PlanId } from "./plans";
import type { SubscriptionSnapshot } from "./types";

/**
 * Turns a Stripe subscription into the row we store, with no database access
 * so the rules are testable on their own. lib/stripe/sync.ts writes the
 * result; this decides what the result is.
 */

export interface ProjectedSubscription {
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  stripePriceId: string;
  plan: PlanId;
  interval: BillingInterval;
  status: SubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  trialEnd: Date | null;
  paymentFailedAt: Date | null;
  latestInvoiceId: string | null;
}

export interface ProjectionOptions {
  /** True when the triggering event was an invoice.payment_failed. */
  paymentFailed?: boolean;
  /** True when the triggering event was an invoice.paid. */
  paymentSucceeded?: boolean;
  /** Whatever is currently stored, so a flag can survive an unrelated event. */
  existingPaymentFailedAt?: Date | null;
  /** Injected so the projection stays deterministic under test. */
  now?: Date;
}

export class UnknownPriceError extends Error {
  constructor(priceId: string) {
    super(
      `Stripe price ${priceId} does not map to a Bindery plan. Check the STRIPE_PRICE_* environment variables.`,
    );
    this.name = "UnknownPriceError";
  }
}

export function projectSubscription(
  snapshot: SubscriptionSnapshot,
  options: ProjectionOptions = {},
): ProjectedSubscription {
  const match = planForPrice(snapshot.priceId);
  if (!match) throw new UnknownPriceError(snapshot.priceId);

  const now = options.now ?? new Date();

  return {
    stripeSubscriptionId: snapshot.id,
    stripeCustomerId: snapshot.customerId,
    stripePriceId: snapshot.priceId,
    plan: match.plan,
    interval: match.interval,
    status: snapshot.status,
    currentPeriodStart: toDate(snapshot.currentPeriodStart),
    currentPeriodEnd: toDate(snapshot.currentPeriodEnd),
    cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
    canceledAt: toDate(snapshot.canceledAt),
    trialEnd: toDate(snapshot.trialEnd),
    paymentFailedAt: resolvePaymentFailedAt(snapshot, options, now),
    latestInvoiceId: snapshot.latestInvoiceId,
  };
}

/**
 * The dunning flag. It is set by a failed invoice, cleared by a paid one, and
 * cleared unconditionally once Stripe says the subscription is active again -
 * that last rule matters because a recovery can reach us as a subscription
 * update rather than an invoice event, and a stale flag would leave a
 * "your payment failed" banner up for a subscriber who has already paid.
 */
function resolvePaymentFailedAt(
  snapshot: SubscriptionSnapshot,
  options: ProjectionOptions,
  now: Date,
): Date | null {
  if (snapshot.status === "active" || snapshot.status === "trialing") return null;
  if (options.paymentSucceeded) return null;
  if (options.paymentFailed) return now;
  return options.existingPaymentFailedAt ?? null;
}

function toDate(seconds: number | null | undefined): Date | null {
  return seconds ? new Date(seconds * 1000) : null;
}
