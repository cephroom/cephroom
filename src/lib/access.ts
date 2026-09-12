import {
  DISCOVERY_RANK,
  SERVING_RANK,
  type DiscoveryTier,
  type ServingTier,
} from "@/lib/stripe/plans";

/**
 * What a subscription means, now that there are two of them and they are
 * about different things.
 *
 * This module used to hold a single ladder — reader, member, lab — and a
 * function called `tierAllows` that decided whether somebody could read
 * somebody else's column. That question no longer exists. A consumer's plan
 * buys reach across the platform's own discovery; a contributor's plan buys
 * room in the platform's own listing. Neither side's plan is visible to the
 * other, and nothing here can gate a column, because nothing gates a column.
 */

export type { DiscoveryTier, ServingTier };

/**
 * Which Stripe statuses count as paying.
 *
 * `past_due` is deliberately included: Stripe is still retrying, and cutting
 * somebody off mid-dunning punishes a failed card rather than a decision.
 * `unpaid` is where the retries have been exhausted, and is excluded.
 */
export const ENTITLING_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing",
  "past_due",
]);

export function isPaying(status: string): boolean {
  return ENTITLING_STATUSES.has(status);
}

export function discoveryRank(tier: DiscoveryTier): number {
  return DISCOVERY_RANK[tier];
}

export function servingRank(tier: ServingTier): number {
  return SERVING_RANK[tier];
}

/** The strongest discovery plan among a customer's live subscriptions. */
export function discoveryFromSubscriptions(
  subscriptions: { status: string; discovery?: DiscoveryTier | null }[],
): DiscoveryTier {
  return subscriptions.reduce<DiscoveryTier>((best, subscription) => {
    if (!isPaying(subscription.status)) return best;
    const tier = subscription.discovery;
    if (!tier) return best;
    return DISCOVERY_RANK[tier] > DISCOVERY_RANK[best] ? tier : best;
  }, "browse");
}

/** The strongest serving plan among a customer's live subscriptions. */
export function servingFromSubscriptions(
  subscriptions: { status: string; serving?: ServingTier | null }[],
): ServingTier {
  return subscriptions.reduce<ServingTier>((best, subscription) => {
    if (!isPaying(subscription.status)) return best;
    const tier = subscription.serving;
    if (!tier) return best;
    return SERVING_RANK[tier] > SERVING_RANK[best] ? tier : best;
  }, "desk");
}

export function governingSubscription<T extends { status: string }>(
  subscriptions: T[],
  matches: (subscription: T) => boolean,
): T | null {
  const relevant = subscriptions.filter(matches);
  return (
    relevant.find((subscription) => isPaying(subscription.status)) ??
    relevant[0] ??
    null
  );
}

export const DISCOVERY_LABEL: Record<DiscoveryTier, string> = {
  browse: "Browse",
  query: "Query",
  sweep: "Sweep",
};

export const SERVING_LABEL: Record<ServingTier, string> = {
  desk: "Desk",
  shelf: "Shelf",
  stacks: "Stacks",
};
