import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { subscriptions, users } from "@/lib/db/schema";

import { projectSubscription, type ProjectionOptions } from "./projection";
import type { SubscriptionSnapshot } from "./types";

/**
 * The subscription state machine.
 *
 * Stripe owns the state. This writes its view into the local projection that
 * the paywall reads, and is deliberately the only place that does so, so
 * there is exactly one definition of what each Stripe status means here.
 *
 * What each status means for access is decided in lib/access.ts; what gets
 * stored is decided in lib/stripe/projection.ts. This function is only the
 * part that needs a database: find the row, find the user, write it.
 */
export async function syncSubscription(
  snapshot: SubscriptionSnapshot,
  options: ProjectionOptions & { userId?: string } = {},
) {
  const existing = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, snapshot.id),
  });

  const userId =
    options.userId ??
    existing?.userId ??
    (await userForCustomer(snapshot.customerId));

  if (!userId) {
    throw new Error(
      `No Bindery user is attached to Stripe customer ${snapshot.customerId}.`,
    );
  }

  const projected = projectSubscription(snapshot, {
    ...options,
    existingPaymentFailedAt: existing?.paymentFailedAt ?? null,
  });

  const values = { ...projected, userId, updatedAt: new Date() };

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
