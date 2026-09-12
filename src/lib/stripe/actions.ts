"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";
import { accessCookie } from "@/lib/auth/session";
import { mintAccessKey } from "@/lib/keys/tokens";
import { entitlementFor } from "@/lib/stripe/entitlement";

import { gateway } from "./gateway";
import {
  planById,
  type AnyPlanId,
  type BillingInterval,
} from "./plans";

function baseUrl(): string {
  return process.env.AUTH_URL ?? "http://localhost:3000";
}

export async function startCheckout(formData: FormData) {
  const plan = String(formData.get("plan") ?? "") as AnyPlanId;
  const interval = String(formData.get("interval") ?? "month") as BillingInterval;
  const from = String(formData.get("from") ?? "/account");
  const wantsReduced = String(formData.get("reduced") ?? "") === "1";

  const definition = planById(plan);
  if (!definition?.prices) throw new Error(`Unknown or free plan "${plan}".`);

  const reduced = wantsReduced ? definition.reduced : undefined;

  const viewer = await getViewer();
  if (!viewer.sub) {
    redirect(
      `/signin?next=${encodeURIComponent(`/pricing?plan=${plan}&interval=${interval}`)}`,
    );
  }

  const { customerId } = await entitlementFor(viewer.sub);

  const session = await (await gateway()).createCheckoutSession({
    sub: viewer.sub,
    customerId,
    priceId: reduced?.priceId ?? definition.prices[interval].priceId,
    plan,
    interval: reduced ? "year" : interval,
    successUrl: `${baseUrl()}/api/auth/restamp?next=${encodeURIComponent("/account?checkout=success")}`,
    cancelUrl: `${baseUrl()}${from.startsWith("/") ? from : "/pricing"}?checkout=cancelled`,
  });

  redirect(session.url);
}

export async function openBillingPortal() {
  const viewer = await getViewer();
  if (!viewer.sub) redirect("/signin?next=/account");

  const { customerId } = await entitlementFor(viewer.sub);
  if (!customerId) redirect("/pricing");

  const session = await (await gateway()).createBillingPortalSession({
    customerId,
    returnUrl: `${baseUrl()}/account`,
  });
  redirect(session.url);
}

export async function cancelSubscription(formData: FormData) {
  await setCancellation(String(formData.get("subscriptionId") ?? ""), true);
}

export async function resumeSubscription(formData: FormData) {
  await setCancellation(String(formData.get("subscriptionId") ?? ""), false);
}

async function setCancellation(subscriptionId: string, cancel: boolean) {
  const viewer = await getViewer();
  if (!viewer.sub) redirect("/signin?next=/account");

  const { customerId } = await entitlementFor(viewer.sub);
  if (!customerId) redirect("/pricing");

  const mine = await (await gateway()).listSubscriptions(customerId);
  if (!mine.some((subscription) => subscription.id === subscriptionId)) {
    throw new Error("That subscription is not yours.");
  }

  await (await gateway()).setCancelAtPeriodEnd(subscriptionId, cancel);
  await restampKey();
}

export async function restampKey() {
  const viewer = await getViewer();
  if (!viewer.sub) return;

  const entitlement = await entitlementFor(viewer.sub);
  const token = await mintAccessKey({
    sub: viewer.sub,
    discovery: entitlement.discovery,
  });

  (await cookies()).set(accessCookie(token));
}
