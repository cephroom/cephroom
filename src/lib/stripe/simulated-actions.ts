"use server";

import { getViewer } from "@/lib/auth/session";

import { entitlementFor } from "./entitlement";
import { gateway, usingRealStripe } from "./gateway";
import { restampKey } from "./actions";

async function guard(formData: FormData): Promise<string> {
  if (usingRealStripe()) {
    throw new Error("Unavailable with a Stripe key set.");
  }

  const viewer = await getViewer();
  const subscriptionId = String(formData.get("subscriptionId") ?? "");
  if (!viewer.sub) throw new Error("Sign in first.");

  const { customerId } = await entitlementFor(viewer.sub);
  if (!customerId) throw new Error("No subscription.");

  const mine = await (await gateway()).listSubscriptions(customerId);
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
