import {
  DISCOVERY_RANK,
  SERVING_RANK,
  type DiscoveryTier,
  type ServingTier,
} from "@/lib/stripe/plans";


export type { DiscoveryTier, ServingTier };

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
