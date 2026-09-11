import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { subscriptions, users } from "@/lib/db/schema";

import { planForPrice } from "./plans";
import type { SubscriptionSnapshot } from "./types";

/**
 * The subscription state machine.
 *
 * Stripe owns the state. This writes its view into the local projection that
 * the paywall reads, and is deliberately the only place that does so, so
 * there is exactly one definition of what each Stripe status means to us.
 *
 * Transitions, and what each one means for access (see lib/entitlements):
 *
 *   incomplete        checkout started, first payment not settled   no access
 *   trialing          trial running                                 access
 *   active            paid and current                              access
 *   past_due          payment failed, Stripe is retrying            access kept
 *   unpaid            retries exhausted, Stripe gave up             no access
 *   canceled          ended, by the subscriber or by dunning        no access
 *   paused            collection paused                             no access
 *
 * `past_due` keeping access is the one judgement call: it costs a few days of
 * free reading for an expired card, and it avoids locking out a paying
 * subscriber over a bank decline they have not yet seen an email about.
 */
export async function syncSubscription(
  snapshot: SubscriptionSnapshot,
  options: { userId?: string; paymentFailed?: boolean; paymentSucceeded?: boolean } = {},
) {
  const match = planForPrice(snapshot.priceId);
  if (!match) {
    throw new Error(
      `Stripe price ${snapshot.priceId} does not map to a Bindery plan. Check STRIPE_PRICE_* environment variables.`,
    );
  }

  const existing = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, snapshot.id),
  });

  const userId = options.userId ?? existing?.userId ?? (await userForCustomer(snapshot.customerId));
  if (!userId) {
    throw new Error(
      `No Bindery user is attached to Stripe customer ${snapshot.customerId}.`,
    );
  }

  const paymentFailedAt = options.paymentSucceeded
    ? null
    : options.paymentFailed
      ? new Date()
      : (existing?.paymentFailedAt ?? null);

  const values = {
    userId,
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
    paymentFailedAt: snapshot.status === "active" ? null : paymentFailedAt,
    latestInvoiceId: snapshot.latestInvoiceId,
    updatedAt: new Date(),
  };

  if (existing) {
    await db
      .update(subscriptions)
      .set(values)
      .where(eq(subscriptions.id, existing.id));
    return existing.id;
  }

  const [created] = await db.insert(subscriptions).values(values).returning();
  return created.id;
}

/** Records the Stripe customer id on the user, creating the link once. */
export async function attachCustomer(userId: string, customerId: string) {
  await db
    .update(users)
    .set({ stripeCustomerId: customerId })
    .where(eq(users.id, userId));
}

async function userForCustomer(customerId: string): Promise<string | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.stripeCustomerId, customerId),
  });
  return user?.id ?? null;
}

function toDate(seconds: number | null | undefined): Date | null {
  return seconds ? new Date(seconds * 1000) : null;
}
