import type { Tier } from "@/lib/access";
import { governingSubscription, tierFromSubscriptions } from "@/lib/access";

import { gateway } from "./gateway";

/**
 * Deriving a tier from Stripe, live.
 *
 * Contract 1 forbids mirroring Stripe's records locally, so there is no
 * `subscription` table to read and no webhook keeping one current. The
 * question "what is this reader entitled to" is answered by asking Stripe at
 * key-issue and at every renewal, and the answer is then stamped into a
 * 15-minute key.
 *
 * The cost is a Stripe call per renewal per active reader. That is the price
 * of not holding the data, and it is accepted.
 */

export interface Entitlement {
  tier: Tier;
  customerId: string | null;
  /** Stripe's own status words, for the account page. Never persisted. */
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

/**
 * Finds the Stripe customer for a subject.
 *
 * The subject-to-customer mapping lives in Stripe's customer metadata, which
 * is the point: Stripe is the stateful party, so Stripe holds the mapping.
 * The platform asks rather than remembers.
 */
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
