import "server-only";

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import Stripe from "stripe";

import { PLANS, planForPrice } from "./plans";
import type {
  CheckoutRequest,
  CheckoutSession,
  InvoiceSummary,
  StripeGateway,
  SubscriptionSnapshot,
} from "./types";

/**
 * A local stand-in for Stripe's servers.
 *
 * Live Stripe keys need KYC and a bank account, so the payment path cannot be
 * exercised on a developer machine. Rather than mock the application's own
 * billing code - which would test nothing - this mocks the *counterparty*:
 * it stores customers, subscriptions and invoices, serves a checkout page,
 * and posts genuinely signed webhook events back to the application's real
 * webhook route.
 *
 * Everything above src/lib/stripe/gateway.ts therefore runs identically here
 * and in production, including signature verification, event idempotency and
 * the subscription state machine. Setting STRIPE_SECRET_KEY switches the
 * gateway to the live adapter and this file stops being loaded.
 */

const STORE_PATH = join(process.cwd(), ".stripe-local.json");

interface LocalStore {
  customers: Record<string, { id: string; email: string | null; name: string | null; userId: string }>;
  sessions: Record<string, CheckoutRequest & { id: string; status: string }>;
  subscriptions: Record<string, LocalSubscription>;
  invoices: Record<string, LocalInvoice>;
  eventSeq: number;
}

export interface LocalSubscription {
  id: string;
  customer: string;
  status: SubscriptionSnapshot["status"];
  priceId: string;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  canceledAt: number | null;
  trialEnd: number | null;
  latestInvoiceId: string | null;
  metadata: Record<string, string>;
}

interface LocalInvoice {
  id: string;
  customer: string;
  subscription: string;
  number: string;
  created: number;
  amountDue: number;
  amountPaid: number;
  currency: string;
  status: "paid" | "open" | "uncollectible" | "void";
  attemptCount: number;
}

const EMPTY: LocalStore = {
  customers: {},
  sessions: {},
  subscriptions: {},
  invoices: {},
  eventSeq: 0,
};

function load(): LocalStore {
  if (!existsSync(STORE_PATH)) return structuredClone(EMPTY);
  try {
    return { ...structuredClone(EMPTY), ...JSON.parse(readFileSync(STORE_PATH, "utf8")) };
  } catch {
    return structuredClone(EMPTY);
  }
}

function save(store: LocalStore) {
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function id(prefix: string): string {
  return `${prefix}_local${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
}

const MONTH_MS = 30 * 86_400_000;
const YEAR_MS = 365 * 86_400_000;

/* ------------------------------------------------------------------ *
 * Shaping local records as Stripe objects
 * ------------------------------------------------------------------ */

export function asStripeSubscription(
  subscription: LocalSubscription,
): Record<string, unknown> {
  return {
    id: subscription.id,
    object: "subscription",
    customer: subscription.customer,
    status: subscription.status,
    cancel_at_period_end: subscription.cancelAtPeriodEnd,
    canceled_at: subscription.canceledAt,
    trial_end: subscription.trialEnd,
    current_period_start: subscription.currentPeriodStart,
    current_period_end: subscription.currentPeriodEnd,
    latest_invoice: subscription.latestInvoiceId,
    metadata: subscription.metadata,
    items: {
      object: "list",
      data: [
        {
          id: `si_${subscription.id.slice(4)}`,
          object: "subscription_item",
          price: { id: subscription.priceId, object: "price" },
          current_period_start: subscription.currentPeriodStart,
          current_period_end: subscription.currentPeriodEnd,
        },
      ],
    },
  };
}

function asStripeInvoice(invoice: LocalInvoice): Record<string, unknown> {
  return {
    id: invoice.id,
    object: "invoice",
    customer: invoice.customer,
    subscription: invoice.subscription,
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: invoice.subscription },
    },
    number: invoice.number,
    created: invoice.created,
    amount_due: invoice.amountDue,
    amount_paid: invoice.amountPaid,
    currency: invoice.currency,
    status: invoice.status,
    attempt_count: invoice.attemptCount,
    hosted_invoice_url: null,
  };
}

function toSnapshot(subscription: LocalSubscription): SubscriptionSnapshot {
  return {
    id: subscription.id,
    customerId: subscription.customer,
    priceId: subscription.priceId,
    status: subscription.status,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    canceledAt: subscription.canceledAt,
    trialEnd: subscription.trialEnd,
    latestInvoiceId: subscription.latestInvoiceId,
  };
}

/* ------------------------------------------------------------------ *
 * Webhook delivery
 * ------------------------------------------------------------------ */

export function webhookSecret(): string {
  return process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_local_development_secret";
}

function baseUrl(): string {
  return process.env.AUTH_URL ?? "http://localhost:3000";
}

/**
 * Signs and delivers an event to the application's own webhook route, using
 * Stripe's real signature scheme. The receiving handler verifies it with
 * stripe.webhooks.constructEvent exactly as it would a production delivery.
 */
export async function deliverEvent(
  type: string,
  object: Record<string, unknown>,
  previousAttributes?: Record<string, unknown>,
): Promise<void> {
  const store = load();
  store.eventSeq += 1;
  save(store);

  const payload = JSON.stringify({
    id: `evt_local${store.eventSeq}${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`,
    object: "event",
    api_version: "2025-08-27.basil",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type,
    data: {
      object,
      ...(previousAttributes ? { previous_attributes: previousAttributes } : {}),
    },
  });

  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret(),
  });

  const response = await fetch(`${baseUrl()}/api/stripe/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
    },
    body: payload,
  });

  if (!response.ok) {
    throw new Error(
      `Local webhook delivery of ${type} failed: ${response.status} ${await response.text()}`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Checkout simulation, driven by /dev/stripe/checkout
 * ------------------------------------------------------------------ */

export function readSession(sessionId: string) {
  return load().sessions[sessionId] ?? null;
}

/** The happy path: subscription created, first invoice paid. */
export async function completeCheckout(sessionId: string) {
  const store = load();
  const session = store.sessions[sessionId];
  if (!session) throw new Error("Unknown local checkout session.");

  const now = Math.floor(Date.now() / 1000);
  const span = session.interval === "year" ? YEAR_MS : MONTH_MS;

  const subscription: LocalSubscription = {
    id: id("sub"),
    customer: session.customerId,
    status: "active",
    priceId: session.priceId,
    currentPeriodStart: now,
    currentPeriodEnd: now + Math.floor(span / 1000),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    trialEnd: null,
    latestInvoiceId: null,
    metadata: {
      binderyUserId: session.userId,
      binderyPlan: session.plan,
      binderyInterval: session.interval,
    },
  };

  const invoice = createInvoice(store, subscription, "paid");
  subscription.latestInvoiceId = invoice.id;

  store.subscriptions[subscription.id] = subscription;
  store.sessions[sessionId] = { ...session, status: "complete" };
  save(store);

  // Stripe delivers these in this order; the handler must tolerate either.
  await deliverEvent("checkout.session.completed", {
    id: sessionId,
    object: "checkout_session",
    mode: "subscription",
    customer: session.customerId,
    subscription: subscription.id,
    client_reference_id: session.userId,
    metadata: { binderyUserId: session.userId, binderyPlan: session.plan },
    payment_status: "paid",
    status: "complete",
  });
  await deliverEvent(
    "customer.subscription.created",
    asStripeSubscription(subscription),
  );
  await deliverEvent("invoice.paid", asStripeInvoice(invoice));

  return subscription;
}

/** The declined-card path: subscription exists but is not paid for. */
export async function declineCheckout(sessionId: string) {
  const store = load();
  const session = store.sessions[sessionId];
  if (!session) throw new Error("Unknown local checkout session.");

  const now = Math.floor(Date.now() / 1000);
  const span = session.interval === "year" ? YEAR_MS : MONTH_MS;

  const subscription: LocalSubscription = {
    id: id("sub"),
    customer: session.customerId,
    status: "past_due",
    priceId: session.priceId,
    currentPeriodStart: now,
    currentPeriodEnd: now + Math.floor(span / 1000),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    trialEnd: null,
    latestInvoiceId: null,
    metadata: {
      binderyUserId: session.userId,
      binderyPlan: session.plan,
      binderyInterval: session.interval,
    },
  };

  const invoice = createInvoice(store, subscription, "open");
  subscription.latestInvoiceId = invoice.id;

  store.subscriptions[subscription.id] = subscription;
  store.sessions[sessionId] = { ...session, status: "complete" };
  save(store);

  await deliverEvent("checkout.session.completed", {
    id: sessionId,
    object: "checkout_session",
    mode: "subscription",
    customer: session.customerId,
    subscription: subscription.id,
    client_reference_id: session.userId,
    metadata: { binderyUserId: session.userId, binderyPlan: session.plan },
    payment_status: "unpaid",
    status: "complete",
  });
  await deliverEvent(
    "customer.subscription.created",
    asStripeSubscription(subscription),
  );
  await deliverEvent("invoice.payment_failed", asStripeInvoice(invoice));

  return subscription;
}

/** Dunning recovery: the retry succeeds and the subscription goes active. */
export async function recoverPayment(subscriptionId: string) {
  const store = load();
  const subscription = store.subscriptions[subscriptionId];
  if (!subscription) throw new Error("Unknown local subscription.");

  subscription.status = "active";
  const invoice = createInvoice(store, subscription, "paid");
  subscription.latestInvoiceId = invoice.id;
  save(store);

  await deliverEvent("invoice.paid", asStripeInvoice(invoice));
  await deliverEvent(
    "customer.subscription.updated",
    asStripeSubscription(subscription),
    { status: "past_due" },
  );
  return subscription;
}

/** Dunning exhausted: Stripe gives up and cancels. */
export async function exhaustDunning(subscriptionId: string) {
  const store = load();
  const subscription = store.subscriptions[subscriptionId];
  if (!subscription) throw new Error("Unknown local subscription.");

  subscription.status = "canceled";
  subscription.canceledAt = Math.floor(Date.now() / 1000);
  save(store);

  await deliverEvent(
    "customer.subscription.deleted",
    asStripeSubscription(subscription),
  );
  return subscription;
}

/** Period rollover for a subscription already flagged cancel_at_period_end. */
export async function endPeriod(subscriptionId: string) {
  const store = load();
  const subscription = store.subscriptions[subscriptionId];
  if (!subscription) throw new Error("Unknown local subscription.");

  if (subscription.cancelAtPeriodEnd) {
    subscription.status = "canceled";
    subscription.canceledAt = Math.floor(Date.now() / 1000);
    save(store);
    await deliverEvent(
      "customer.subscription.deleted",
      asStripeSubscription(subscription),
    );
    return subscription;
  }

  const span = subscription.currentPeriodEnd - subscription.currentPeriodStart;
  subscription.currentPeriodStart = subscription.currentPeriodEnd;
  subscription.currentPeriodEnd = subscription.currentPeriodStart + span;
  const invoice = createInvoice(store, subscription, "paid");
  subscription.latestInvoiceId = invoice.id;
  save(store);

  await deliverEvent("invoice.paid", asStripeInvoice(invoice));
  await deliverEvent(
    "customer.subscription.updated",
    asStripeSubscription(subscription),
  );
  return subscription;
}

export function listLocalSubscriptions(): LocalSubscription[] {
  return Object.values(load().subscriptions);
}

function createInvoice(
  store: LocalStore,
  subscription: LocalSubscription,
  status: LocalInvoice["status"],
): LocalInvoice {
  const amount = amountFor(subscription.priceId);
  const invoice: LocalInvoice = {
    id: id("in"),
    customer: subscription.customer,
    subscription: subscription.id,
    number: `BINDERY-${String(Object.keys(store.invoices).length + 1).padStart(4, "0")}`,
    created: Math.floor(Date.now() / 1000),
    amountDue: amount,
    amountPaid: status === "paid" ? amount : 0,
    currency: "usd",
    status,
    attemptCount: 1,
  };
  store.invoices[invoice.id] = invoice;
  return invoice;
}

function amountFor(priceId: string): number {
  const match = planForPrice(priceId);
  return match ? PLANS[match.plan].prices[match.interval].unitAmount : 0;
}

/* ------------------------------------------------------------------ *
 * The gateway
 * ------------------------------------------------------------------ */

export function localGateway(): StripeGateway {
  return {
    mode: "local",

    async createCustomer({ email, name, userId }) {
      const store = load();
      const customerId = id("cus");
      store.customers[customerId] = { id: customerId, email, name, userId };
      save(store);
      return customerId;
    },

    async createCheckoutSession(input): Promise<CheckoutSession> {
      const store = load();
      const sessionId = id("cs");
      store.sessions[sessionId] = { ...input, id: sessionId, status: "open" };
      save(store);
      return {
        id: sessionId,
        url: `${baseUrl()}/dev/stripe/checkout?session=${sessionId}`,
      };
    },

    async retrieveSubscription(subscriptionId) {
      const subscription = load().subscriptions[subscriptionId];
      if (!subscription) throw new Error("No such subscription.");
      return toSnapshot(subscription);
    },

    async setCancelAtPeriodEnd(subscriptionId, cancelAtPeriodEnd) {
      const store = load();
      const subscription = store.subscriptions[subscriptionId];
      if (!subscription) throw new Error("No such subscription.");

      const previous = subscription.cancelAtPeriodEnd;
      subscription.cancelAtPeriodEnd = cancelAtPeriodEnd;
      save(store);

      await deliverEvent(
        "customer.subscription.updated",
        asStripeSubscription(subscription),
        { cancel_at_period_end: previous },
      );
      return toSnapshot(subscription);
    },

    async cancelImmediately(subscriptionId) {
      const store = load();
      const subscription = store.subscriptions[subscriptionId];
      if (!subscription) throw new Error("No such subscription.");

      subscription.status = "canceled";
      subscription.canceledAt = Math.floor(Date.now() / 1000);
      save(store);

      await deliverEvent(
        "customer.subscription.deleted",
        asStripeSubscription(subscription),
      );
      return toSnapshot(subscription);
    },

    async createBillingPortalSession({ customerId, returnUrl }) {
      return {
        url: `${baseUrl()}/dev/stripe/portal?customer=${customerId}&return=${encodeURIComponent(returnUrl)}`,
      };
    },

    async listInvoices(customerId): Promise<InvoiceSummary[]> {
      return Object.values(load().invoices)
        .filter((invoice) => invoice.customer === customerId)
        .sort((a, b) => b.created - a.created)
        .map((invoice) => ({
          id: invoice.id,
          number: invoice.number,
          created: invoice.created,
          amountPaid: invoice.amountPaid,
          amountDue: invoice.amountDue,
          currency: invoice.currency,
          status: invoice.status,
          hostedInvoiceUrl: null,
        }));
    },
  };
}
