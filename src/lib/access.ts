/**
 * Access policy, with no I/O in it.
 *
 * Kept separate from lib/entitlements so the rules that decide who can read
 * what are testable on their own, without a database or a request context.
 */

export type Plan = "free" | "member" | "lab";
export type Access = "public" | "member" | "lab";

export type SubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";

const RANK: Record<Plan, number> = { free: 0, member: 1, lab: 2 };
const REQUIRED: Record<Access, Plan> = {
  public: "free",
  member: "member",
  lab: "lab",
};

/**
 * Statuses that still grant access.
 *
 * `past_due` is deliberately included. Stripe retries a failed payment over
 * several days; cutting a paying subscriber off at the first declined card
 * punishes an expired card rather than a decision to leave. Access ends when
 * Stripe moves the subscription to `canceled` or `unpaid`.
 */
export const ENTITLING_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  "active",
  "trialing",
  "past_due",
]);

export function isEntitling(status: SubscriptionStatus): boolean {
  return ENTITLING_STATUSES.has(status);
}

export function planFromSubscription(
  subscription: { status: SubscriptionStatus; plan: "member" | "lab" } | null | undefined,
): Plan {
  if (!subscription) return "free";
  return isEntitling(subscription.status) ? subscription.plan : "free";
}

export function planAllows(plan: Plan, access: Access): boolean {
  return RANK[plan] >= RANK[REQUIRED[access]];
}

export function planRank(plan: Plan): number {
  return RANK[plan];
}

/** The strongest plan among several subscriptions, ignoring the lapsed ones. */
export function strongestPlan(
  subscriptions: { status: SubscriptionStatus; plan: "member" | "lab" }[],
): Plan {
  return subscriptions.reduce<Plan>(
    (best, subscription) => {
      const candidate = planFromSubscription(subscription);
      return RANK[candidate] > RANK[best] ? candidate : best;
    },
    "free",
  );
}

export const PLAN_LABEL: Record<Plan, string> = {
  free: "Reader",
  member: "Member",
  lab: "Lab",
};

export const ACCESS_LABEL: Record<Access, string> = {
  public: "Free to read",
  member: "Member",
  lab: "Lab",
};
