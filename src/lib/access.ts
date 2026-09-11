/**
 * Access policy, with no I/O in it.
 *
 * Under Contract 1 there is nothing to look up: a reader's tier arrives in a
 * signed key and these functions decide what it permits. Keeping them pure
 * means the same rules run on the platform, in a contributor's node when it
 * decides whether to serve a member-only column, and in the browser.
 */

export type Tier = "reader" | "member" | "lab";
export type Access = "public" | "member" | "lab";

const RANK: Record<Tier, number> = { reader: 0, member: 1, lab: 2 };
const REQUIRED: Record<Access, Tier> = {
  public: "reader",
  member: "member",
  lab: "lab",
};

/**
 * Stripe statuses that grant a paid tier.
 *
 * `past_due` is deliberately included. Stripe retries a failed payment over
 * several days; cutting a paying subscriber off at the first declined card
 * punishes an expired card rather than a decision to leave. Access ends when
 * Stripe moves the subscription to `canceled` or `unpaid`.
 *
 * Under Contract 1 this is evaluated against Stripe's live answer at key-issue
 * time, never against a local mirror.
 */
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

/**
 * The tier a set of Stripe subscriptions grants. Lapsed subscriptions are
 * ignored, so an upgrade that left a cancelled row behind at Stripe does not
 * keep granting the old tier.
 */
export function tierFromSubscriptions(
  subscriptions: { status: string; tier: "member" | "lab" }[],
): Tier {
  return subscriptions.reduce<Tier>((best, subscription) => {
    if (!isEntitling(subscription.status)) return best;
    return RANK[subscription.tier] > RANK[best] ? subscription.tier : best;
  }, "reader");
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
