"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";
import { accessCookie } from "@/lib/auth/session";
import { mintAccessKey } from "@/lib/keys/tokens";
import { entitlementFor } from "@/lib/stripe/entitlement";

import { gateway } from "./gateway";
import { PLANS, type BillingInterval, type PlanId } from "./plans";

function baseUrl(): string {
  return process.env.AUTH_URL ?? "http://localhost:3000";
}

export async function startCheckout(formData: FormData) {
  const plan = String(formData.get("plan") ?? "") as PlanId;
  const interval = String(formData.get("interval") ?? "month") as BillingInterval;
  const from = String(formData.get("from") ?? "/account");
  // The reduced rate is a price, not a tier. It is honoured only where the
  // plan actually offers one, so a crafted form field cannot conjure a
  // discount on a plan that has none — this is a public endpoint like every
  // other server action.
  const wantsReduced = String(formData.get("reduced") ?? "") === "1";

  if (!PLANS[plan]) throw new Error(`Unknown plan "${plan}".`);

  const reduced = wantsReduced ? PLANS[plan].reduced : undefined;

  const viewer = await getViewer();
  if (!viewer.sub) {
    redirect(
      `/signin?next=${encodeURIComponent(`/pricing?plan=${plan}&interval=${interval}`)}`,
    );
  }

  const session = await (await gateway()).createCheckoutSession({
    sub: viewer.sub,
    customerId: viewer.cus,
    priceId: reduced?.priceId ?? PLANS[plan].prices[interval].priceId,
    plan,
    interval: reduced ? "year" : interval,
    // Through the re-stamp handler, because the key still says what it
    // said before the payment and a page cannot set a cookie while rendering.
    successUrl: `${baseUrl()}/api/auth/restamp?next=${encodeURIComponent("/account?checkout=success")}`,
    cancelUrl: `${baseUrl()}${from.startsWith("/") ? from : "/pricing"}?checkout=cancelled`,
  });

  redirect(session.url);
}

export async function openBillingPortal() {
  const viewer = await getViewer();
  if (!viewer.sub) redirect("/signin?next=/account");
  if (!viewer.cus) redirect("/pricing");

  const session = await (await gateway()).createBillingPortalSession({
    customerId: viewer.cus,
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
  if (!viewer.sub || !viewer.cus) redirect("/signin?next=/account");

  // A server action is a public endpoint. Confirm the subscription really
  // belongs to this customer before touching it, by asking Stripe rather than
  // trusting the form.
  const mine = await (await gateway()).listSubscriptions(viewer.cus);
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
    tier: entitlement.tier,
    cus: entitlement.customerId ?? undefined,
    name: viewer.name ?? undefined,
  });

  (await cookies()).set(accessCookie(token));
}
