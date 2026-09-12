import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  isDiscoveryTier,
  isServingTier,
  planById,
  planForPrice,
  priceForId,
} from "@/lib/stripe/plans";
import {
  SUBJECT_METADATA_KEY,
  subjectFromMetadata,
  type CheckoutRequest,
  type StripeGateway,
  type SubscriptionView,
} from "@/lib/stripe/types";


const STORE_PATH = join(process.cwd(), ".stripe-simulated.json");
const MONTH = 30 * 86_400;
const YEAR = 365 * 86_400;

interface Customer {
  id: string;
  metadata: Record<string, string>;
}

interface Subscription {
  id: string;
  customer: string;
  priceId: string;
  status: string;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
}

interface Session {
  id: string;
  request: CheckoutRequest;
  customer: string;
  status: "open" | "complete";
}

interface Store {
  customers: Record<string, Customer>;
  subscriptions: Record<string, Subscription>;
  sessions: Record<string, Session>;
}

const EMPTY: Store = { customers: {}, subscriptions: {}, sessions: {} };

function load(): Store {
  if (!existsSync(STORE_PATH)) return structuredClone(EMPTY);
  try {
    return {
      ...structuredClone(EMPTY),
      ...JSON.parse(readFileSync(STORE_PATH, "utf8")),
    };
  } catch {
    return structuredClone(EMPTY);
  }
}

function save(store: Store) {
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function id(prefix: string): string {
  return `${prefix}_sim${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function toView(subscription: Subscription): SubscriptionView | null {
  const match = planForPrice(subscription.priceId);
  if (!match) return null;
  return {
    id: subscription.id,
    plan: match.plan,
    discovery: isDiscoveryTier(match.plan) ? match.plan : null,
    serving: isServingTier(match.plan) ? match.plan : null,
    interval: match.interval,
    status: subscription.status,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    priceId: subscription.priceId,
  };
}

function baseUrl(): string {
  return process.env.AUTH_URL ?? "http://localhost:3000";
}


export function readSession(sessionId: string): Session | null {
  return load().sessions[sessionId] ?? null;
}

export function planFor(sessionId: string) {
  const session = readSession(sessionId);
  if (!session) return null;

  // By price id, which is what the session actually carries. Rebuilding it
  // from plan + interval drops any price off that axis — the reduced rate was
  // offered at the full annual price for exactly that reason.
  const byId = priceForId(session.request.priceId);
  if (byId) return { session, plan: byId.plan, price: byId.price };

  // A free plan has no price and cannot be checked out, so a session naming
  // one is malformed rather than something to guess at.
  const plan = planById(session.request.plan);
  const price = plan?.prices?.[session.request.interval];
  if (!plan || !price) return null;
  return { session, plan, price };
}

export function completeCheckout(sessionId: string): void {
  settle(sessionId, "active");
}

export function declineCheckout(sessionId: string): void {
  settle(sessionId, "past_due");
}

function settle(sessionId: string, status: string): void {
  const store = load();
  const session = store.sessions[sessionId];
  if (!session) throw new Error("Unknown simulated checkout session.");

  const span = session.request.interval === "year" ? YEAR : MONTH;
  const subscription: Subscription = {
    id: id("sub"),
    customer: session.customer,
    priceId: session.request.priceId,
    status,
    currentPeriodStart: now(),
    currentPeriodEnd: now() + span,
    cancelAtPeriodEnd: false,
  };

  store.subscriptions[subscription.id] = subscription;
  store.sessions[sessionId] = { ...session, status: "complete" };
  save(store);
}

export function recoverPayment(subscriptionId: string): void {
  mutate(subscriptionId, (subscription) => {
    subscription.status = "active";
  });
}

export function exhaustDunning(subscriptionId: string): void {
  mutate(subscriptionId, (subscription) => {
    subscription.status = "canceled";
  });
}

export function advancePeriod(subscriptionId: string): void {
  mutate(subscriptionId, (subscription) => {
    if (subscription.cancelAtPeriodEnd) {
      subscription.status = "canceled";
      return;
    }
    const span = subscription.currentPeriodEnd - subscription.currentPeriodStart;
    subscription.currentPeriodStart = subscription.currentPeriodEnd;
    subscription.currentPeriodEnd = subscription.currentPeriodStart + span;
  });
}

export function subscriptionsForSubject(sub: string): Subscription[] {
  const store = load();
  const customer = Object.values(store.customers).find(
    (candidate) => subjectFromMetadata(candidate.metadata) === sub,
  );
  if (!customer) return [];
  return Object.values(store.subscriptions).filter(
    (subscription) => subscription.customer === customer.id,
  );
}

function mutate(
  subscriptionId: string,
  change: (subscription: Subscription) => void,
): void {
  const store = load();
  const subscription = store.subscriptions[subscriptionId];
  if (!subscription) throw new Error("Unknown simulated subscription.");
  change(subscription);
  save(store);
}


export function simulatedGateway(): StripeGateway {
  return {
    mode: "simulated",

    async findCustomerBySubject(sub) {
      const store = load();
      const customer = Object.values(store.customers).find(
        (candidate) => subjectFromMetadata(candidate.metadata) === sub,
      );
      if (!customer) return null;

      // Migrate a customer found under an older metadata key forward, exactly
      // as the live gateway does, so the stand-in exercises that path too.
      if (!customer.metadata[SUBJECT_METADATA_KEY]) {
        customer.metadata = { [SUBJECT_METADATA_KEY]: sub };
        save(store);
      }
      return customer.id;
    },

    async listSubscriptions(customerId) {
      const store = load();
      return Object.values(store.subscriptions)
        .filter((subscription) => subscription.customer === customerId)
        .map(toView)
        .filter((view): view is SubscriptionView => view !== null);
    },

    async createCheckoutSession(request) {
      const store = load();

      let customerId = request.customerId;
      if (!customerId) {
        const existing = Object.values(store.customers).find(
          (candidate) => subjectFromMetadata(candidate.metadata) === request.sub,
        );
        if (existing) customerId = existing.id;
      }
      if (!customerId) {
        customerId = id("cus");
        store.customers[customerId] = {
          id: customerId,
          metadata: { [SUBJECT_METADATA_KEY]: request.sub },
        };
      }

      const sessionId = id("cs");
      store.sessions[sessionId] = {
        id: sessionId,
        request,
        customer: customerId,
        status: "open",
      };
      save(store);

      return {
        id: sessionId,
        url: `${baseUrl()}/simulated/checkout?session=${sessionId}`,
      };
    },

    async setCancelAtPeriodEnd(subscriptionId, cancelAtPeriodEnd) {
      mutate(subscriptionId, (subscription) => {
        subscription.cancelAtPeriodEnd = cancelAtPeriodEnd;
      });
    },

    async createBillingPortalSession({ customerId, returnUrl }) {
      return {
        url: `${baseUrl()}/simulated/portal?customer=${customerId}&return=${encodeURIComponent(returnUrl)}`,
      };
    },
  };
}
