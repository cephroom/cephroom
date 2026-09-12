
export type Tier = "reader" | "member" | "lab";
export type Access = "public" | "member" | "lab";

const RANK: Record<Tier, number> = { reader: 0, member: 1, lab: 2 };
const REQUIRED: Record<Access, Tier> = {
  public: "reader",
  member: "member",
  lab: "lab",
};

export const ENTITLING_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing",
  "past_due",
]);

export function isEntitling(status: string): boolean {
  return ENTITLING_STATUSES.has(status);
}

export function tierAllows(tier: Tier, access: Access): boolean {
  return RANK[tier] >= RANK[REQUIRED[access]];
}

export function tierRank(tier: Tier): number {
  return RANK[tier];
}

export function tierFromSubscriptions(
  subscriptions: { status: string; tier: "member" | "lab" }[],
): Tier {
  return subscriptions.reduce<Tier>((best, subscription) => {
    if (!isEntitling(subscription.status)) return best;
    return RANK[subscription.tier] > RANK[best] ? subscription.tier : best;
  }, "reader");
}

export function governingSubscription<
  T extends { status: string; tier: "member" | "lab" },
>(subscriptions: T[], tier: Tier): T | null {
  const atTier = subscriptions.filter(
    (subscription) => subscription.tier === tier,
  );
  return (
    atTier.find((subscription) => isEntitling(subscription.status)) ??
    atTier[0] ??
    subscriptions.find((subscription) => isEntitling(subscription.status)) ??
    subscriptions[0] ??
    null
  );
}

export const TIER_LABEL: Record<Tier, string> = {
  reader: "Reader",
  member: "Member",
  lab: "Lab",
};

export const ACCESS_LABEL: Record<Access, string> = {
  public: "Free to read",
  member: "Member",
  lab: "Lab",
};
