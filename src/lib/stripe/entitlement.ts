import type { DiscoveryTier, ServingTier } from "@/lib/access";
import { discoveryFromSubscriptions, servingFromSubscriptions } from "@/lib/access";

import { gateway } from "./gateway";
import type { SubscriptionView } from "./types";


export interface Entitlement {
  discovery: DiscoveryTier;
  serving: ServingTier;
  customerId: string | null;
  subscriptions: SubscriptionView[];
}

export const NO_ENTITLEMENT: Entitlement = {
  discovery: "browse",
  serving: "desk",
  customerId: null,
  subscriptions: [],
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

  return {
    discovery: discoveryFromSubscriptions(subscriptions),
    serving: servingFromSubscriptions(subscriptions),
    customerId,
    subscriptions,
  };
}
