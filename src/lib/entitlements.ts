import "server-only";

import { desc, eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { subscriptions, users } from "@/lib/db/schema";
import type { Subscription } from "@/lib/db/schema";

export type Plan = "free" | "member" | "lab";
export type Access = "public" | "member" | "lab";

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
const ENTITLING_STATUSES = new Set<Subscription["status"]>([
  "active",
  "trialing",
  "past_due",
]);

export function planFromSubscription(
  subscription: Pick<Subscription, "status" | "plan"> | null | undefined,
): Plan {
  if (!subscription) return "free";
  return ENTITLING_STATUSES.has(subscription.status)
    ? subscription.plan
    : "free";
}

export function planAllows(plan: Plan, access: Access): boolean {
  return RANK[plan] >= RANK[REQUIRED[access]];
}

export interface Viewer {
  id: string | null;
  name: string | null;
  email: string | null;
  image: string | null;
  handle: string | null;
  role: string;
  plan: Plan;
  subscription: Subscription | null;
  /** True while Stripe is retrying a failed payment. Drives the dunning banner. */
  inDunning: boolean;
}

export const ANONYMOUS: Viewer = {
  id: null,
  name: null,
  email: null,
  image: null,
  handle: null,
  role: "reader",
  plan: "free",
  subscription: null,
  inDunning: false,
};

/**
 * The current reader and what they are entitled to.
 *
 * Entitlements are read from the database on every call rather than from the
 * session token: a checkout that completed thirty seconds ago must unlock the
 * paywall without the reader signing out and back in.
 */
export async function getViewer(): Promise<Viewer> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return ANONYMOUS;

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return ANONYMOUS;

  const subscription = await currentSubscription(userId);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    handle: user.handle,
    role: user.role,
    plan: planFromSubscription(subscription),
    subscription: subscription ?? null,
    inDunning:
      subscription?.status === "past_due" ||
      Boolean(subscription?.paymentFailedAt && subscription.status !== "active"),
  };
}

/**
 * The subscription that governs access. A user can accumulate rows over time
 * (an upgrade creates a new Stripe subscription); the entitling one wins, and
 * failing that the most recent.
 */
export async function currentSubscription(userId: string) {
  const rows = await db.query.subscriptions.findMany({
    where: eq(subscriptions.userId, userId),
    orderBy: [desc(subscriptions.createdAt)],
  });
  if (rows.length === 0) return null;

  const entitling = rows
    .filter((row) => ENTITLING_STATUSES.has(row.status))
    .sort((a, b) => RANK[b.plan] - RANK[a.plan])[0];

  return entitling ?? rows[0];
}

export function canRead(viewer: Viewer, access: Access): boolean {
  return planAllows(viewer.plan, access);
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
