import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PLANS, planForPrice } from "@/lib/stripe/plans";
import {
  SUBJECT_METADATA_KEY,
  subjectFromMetadata,
  type CheckoutRequest,
  type StripeGateway,
  type SubscriptionView,
} from "@/lib/stripe/types";

/**
 * A stand-in for Stripe's servers. Development only.
 *
 * This file writes user data to disk, which Contract 1 forbids the platform
 * from doing. It is permitted as bend #3 in docs/CONTRACTS.md on a specific
 * reading: this is not the platform storing user data, it is a simulation of
 * the one party that is allowed to. Live Stripe keys need KYC and a bank
 * account; without a stand-in the billing path cannot be exercised at all.
 *
 * The boundary is structural rather than a comment. Everything under
 * simulated-counterparties/ is outside the platform, the contract tests
 * allowlist exactly this directory, and a test fails if that allowlist grows.
 * Nothing here is loaded when STRIPE_SECRET_KEY is set.
 */

const STORE_PATH = join(process.cwd(), ".stripe-simulated.json");
const MONTH = 30 * 86_400;
const YEAR = 365 * 86_400;

interface Customer {
  id: string;
  /**
   * Keyed by whichever name the platform used when this customer was created.
   * Real Stripe metadata is an open string map and holds records written by
   * older releases, so the stand-in models that rather than a fixed key — it
   * is the shape that made the receptorome → cephroom rename dangerous.
   */
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
    tier: match.plan,
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

/* ------------------------------------------------------------------ *
 * Actions the simulated checkout page drives
 * ------------------------------------------------------------------ */

export function readSession(sessionId: string): Session | null {
  return load().sessions[sessionId] ?? null;
}

export function planFor(sessionId: string) {
  const session = readSession(sessionId);
  if (!session) return null;
  const plan = PLANS[session.request.plan];
  return { session, plan, price: plan.prices[session.request.interval] };
}

/** The happy path. */
export function completeCheckout(sessionId: string): void {
  settle(sessionId, "active");
}

/** The declined-card path: the subscription exists but is not paid for. */
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

/** A retry succeeding, as Stripe would report it days later. */
export function recoverPayment(subscriptionId: string): void {
  mutate(subscriptionId, (subscription) => {
    subscription.status = "active";
  });
}

/** Dunning exhausted: Stripe gives up and cancels. */
export function exhaustDunning(subscriptionId: string): void {
  mutate(subscriptionId, (subscription) => {
    subscription.status = "canceled";
  });
}

/** Period rollover, honouring a scheduled cancellation. */
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

/* ------------------------------------------------------------------ *
 * The gateway
 * ------------------------------------------------------------------ */

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
