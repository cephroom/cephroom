import type { DiscoveryTier, ServingTier } from "@/lib/access";
import { discoveryFromSubscriptions, servingFromSubscriptions } from "@/lib/access";

import { gateway } from "./gateway";
import type { SubscriptionView } from "./types";


/**
 * What the two subscriptions add up to for one subject.
 *
 * Both are reported because one customer may hold either, both, or neither,
 * and the two say nothing about each other. A contributor on Stacks with no
 * discovery plan browses like anybody else; a consumer on Sweep who serves
 * nothing has the free serving capacity they never use.
 */
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
