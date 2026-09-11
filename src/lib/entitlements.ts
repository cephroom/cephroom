import "server-only";

import { desc, eq } from "drizzle-orm";

import {
  isEntitling,
  planAllows,
  planFromSubscription,
  planRank,
  type Access,
  type Plan,
} from "@/lib/access";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { subscriptions, users } from "@/lib/db/schema";
import type { Subscription } from "@/lib/db/schema";

export {
  ACCESS_LABEL,
  PLAN_LABEL,
  planAllows,
  planFromSubscription,
  type Access,
  type Plan,
} from "@/lib/access";

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
    inDunning: subscription?.status === "past_due",
  };
}

/**
 * The subscription that governs access. A reader can accumulate rows over
 * time (an upgrade creates a new Stripe subscription); the strongest
 * entitling one wins, and failing that the most recent row is shown so the
 * account page can explain what happened to it.
 */
export async function currentSubscription(userId: string) {
  const rows = await db.query.subscriptions.findMany({
    where: eq(subscriptions.userId, userId),
    orderBy: [desc(subscriptions.createdAt)],
  });
  if (rows.length === 0) return null;

  const entitling = rows
    .filter((row) => isEntitling(row.status))
    .sort((a, b) => planRank(b.plan) - planRank(a.plan))[0];

  return entitling ?? rows[0];
}

export function canRead(viewer: Viewer, access: Access): boolean {
  return planAllows(viewer.plan, access);
}
