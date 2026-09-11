"use server";

import { refresh } from "next/cache";

import { getViewer } from "@/lib/entitlements";

import { usingRealStripe } from "./gateway";
import { endPeriod, exhaustDunning, recoverPayment } from "./local";

/**
 * Server actions behind the local billing controls. Each one asks the local
 * stand-in to deliver a signed webhook; the application handles it through
 * the ordinary webhook route.
 */

async function guard(formData: FormData): Promise<string> {
  if (usingRealStripe()) {
    throw new Error("Local billing controls are unavailable with a Stripe key set.");
  }

  const viewer = await getViewer();
  const subscriptionId = String(formData.get("subscriptionId") ?? "");

  // A server action is a public endpoint. Only let a reader drive events for
  // the subscription that is actually theirs.
  if (
    !viewer.id ||
    viewer.subscription?.stripeSubscriptionId !== subscriptionId
  ) {
    throw new Error("Not your subscription.");
  }
  return subscriptionId;
}

export async function recoverPaymentAction(formData: FormData) {
  await recoverPayment(await guard(formData));
  refresh();
}

export async function exhaustDunningAction(formData: FormData) {
  await exhaustDunning(await guard(formData));
  refresh();
}

export async function endPeriodAction(formData: FormData) {
  await endPeriod(await guard(formData));
  refresh();
}
