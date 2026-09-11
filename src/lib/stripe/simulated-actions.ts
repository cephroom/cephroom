"use server";

import { getViewer } from "@/lib/auth/session";

import { gateway, usingRealStripe } from "./gateway";
import { restampKey } from "./actions";

/**
 * Drives the events Stripe would send on its own schedule - a retry
 * succeeding, a dunning cycle running out, a period rolling over - so the
 * whole subscription lifecycle can be walked through now rather than over a
 * week. Only available while the simulated counterparty is in use.
 */
async function guard(formData: FormData): Promise<string> {
  if (usingRealStripe()) {
    throw new Error("Unavailable with a Stripe key set.");
  }

  const viewer = await getViewer();
  const subscriptionId = String(formData.get("subscriptionId") ?? "");
  if (!viewer.sub || !viewer.cus) throw new Error("Sign in first.");

  // A server action is a public endpoint. Confirm ownership with the
  // counterparty rather than trusting the form.
  const mine = await (await gateway()).listSubscriptions(viewer.cus);
  if (!mine.some((subscription) => subscription.id === subscriptionId)) {
    throw new Error("Not your subscription.");
  }
  return subscriptionId;
}

export async function recoverPaymentAction(formData: FormData) {
  const id = await guard(formData);
  const store = await import("@simulated/stripe/store");
  store.recoverPayment(id);
  await restampKey();
}

export async function exhaustDunningAction(formData: FormData) {
  const id = await guard(formData);
  const store = await import("@simulated/stripe/store");
  store.exhaustDunning(id);
  await restampKey();
}

export async function advancePeriodAction(formData: FormData) {
  const id = await guard(formData);
  const store = await import("@simulated/stripe/store");
  store.advancePeriod(id);
  await restampKey();
}
