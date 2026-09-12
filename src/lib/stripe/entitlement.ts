import type { Tier } from "@/lib/access";
import { governingSubscription, tierFromSubscriptions } from "@/lib/access";

import { gateway } from "./gateway";


export interface Entitlement {
  tier: Tier;
  customerId: string | null;
  status: string | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
}

export const NO_ENTITLEMENT: Entitlement = {
  tier: "reader",
  customerId: null,
  status: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

export async function entitlementFor(sub: string): Promise<Entitlement> {
  const customerId = await (await gateway()).findCustomerBySubject(sub);
  if (!customerId) return NO_ENTITLEMENT;
  return entitlementForCustomer(customerId);
}

export async function entitlementForCustomer(
  customerId: string,
): Promise<Entitlement> {
  const subscriptions = await (await gateway()).listSubscriptions(customerId);

  const tier = tierFromSubscriptions(
    subscriptions.map((subscription) => ({
      status: subscription.status,
      tier: subscription.tier,
    })),
  );

  // The subscription that is actually granting access, for display. Not
  // simply the first at that tier: a customer who resubscribed after
  // cancelling holds both, and describing the dead one tells a paying reader
  // their subscription has ended.
  const governing = governingSubscription(subscriptions, tier);

  return {
    tier,
    customerId,
    status: governing?.status ?? null,
    currentPeriodEnd: governing?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: governing?.cancelAtPeriodEnd ?? false,
  };
}
