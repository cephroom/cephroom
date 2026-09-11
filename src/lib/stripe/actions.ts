"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";

import { db } from "@/lib/db";
import { subscriptions, users } from "@/lib/db/schema";
import { currentSubscription, getViewer } from "@/lib/entitlements";

import { gateway } from "./gateway";
import { PLANS, type BillingInterval, type PlanId } from "./plans";
import { attachCustomer, syncSubscription } from "./sync";

function baseUrl(): string {
  return process.env.AUTH_URL ?? "http://localhost:3000";
}

/**
 * Ensures the signed-in reader has a Stripe customer, creating one on first
 * checkout. Stored on the user so a second subscription reuses it and the
 * billing portal has something to open.
 */
async function ensureCustomer(userId: string): Promise<string> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error("No such user.");
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customerId = await gateway().createCustomer({
    email: user.email,
    name: user.name,
    userId: user.id,
  });
  await attachCustomer(user.id, customerId);
  return customerId;
}

export async function startCheckout(formData: FormData) {
  const plan = String(formData.get("plan") ?? "") as PlanId;
  const interval = String(formData.get("interval") ?? "month") as BillingInterval;
  const from = String(formData.get("from") ?? "/account");

  if (!PLANS[plan]) throw new Error(`Unknown plan "${plan}".`);

  const viewer = await getViewer();
  if (!viewer.id) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/pricing?plan=${plan}&interval=${interval}`)}`);
  }

  const customerId = await ensureCustomer(viewer.id);
  const price = PLANS[plan].prices[interval];

  const session = await gateway().createCheckoutSession({
    customerId,
    priceId: price.priceId,
    plan,
    interval,
    userId: viewer.id,
    successUrl: `${baseUrl()}/account?checkout=success`,
    cancelUrl: `${baseUrl()}${from.startsWith("/") ? from : "/pricing"}?checkout=cancelled`,
  });

  redirect(session.url);
}

export async function openBillingPortal() {
  const viewer = await getViewer();
  if (!viewer.id) redirect("/signin?callbackUrl=/account");

  const customerId = await ensureCustomer(viewer.id);
  const session = await gateway().createBillingPortalSession({
    customerId,
    returnUrl: `${baseUrl()}/account`,
  });

  redirect(session.url);
}

/**
 * Cancellation is always at period end, never immediate. Someone who has paid
 * for the month keeps the month; taking it away would be taking something
 * they bought.
 */
export async function cancelSubscription() {
  const viewer = await getViewer();
  if (!viewer.id) redirect("/signin?callbackUrl=/account");

  const subscription = await currentSubscription(viewer.id);
  if (!subscription) return;

  const snapshot = await gateway().setCancelAtPeriodEnd(
    subscription.stripeSubscriptionId,
    true,
  );
  await syncSubscription(snapshot, { userId: viewer.id });
  refresh();
}

export async function resumeSubscription() {
  const viewer = await getViewer();
  if (!viewer.id) redirect("/signin?callbackUrl=/account");

  const subscription = await currentSubscription(viewer.id);
  if (!subscription) return;

  const snapshot = await gateway().setCancelAtPeriodEnd(
    subscription.stripeSubscriptionId,
    false,
  );
  await syncSubscription(snapshot, { userId: viewer.id });
  refresh();
}

/** Re-reads Stripe and rewrites the local projection. The repair button. */
export async function resyncSubscription() {
  const viewer = await getViewer();
  if (!viewer.id) redirect("/signin?callbackUrl=/account");

  const rows = await db.query.subscriptions.findMany({
    where: eq(subscriptions.userId, viewer.id),
  });

  for (const row of rows) {
    try {
      const snapshot = await gateway().retrieveSubscription(
        row.stripeSubscriptionId,
      );
      await syncSubscription(snapshot, { userId: viewer.id });
    } catch (error) {
      console.error(`[stripe] resync of ${row.stripeSubscriptionId} failed`, error);
    }
  }
  refresh();
}
