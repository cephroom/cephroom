import type { BillingInterval, PlanId } from "./plans";

/**
 * The subset of a Stripe subscription the application actually depends on.
 * Both the live adapter and the local stand-in produce this shape, so nothing
 * above the gateway needs to know which one is in play.
 */
export interface SubscriptionSnapshot {
  id: string;
  customerId: string;
  priceId: string;
  status:
    | "incomplete"
    | "incomplete_expired"
    | "trialing"
    | "active"
    | "past_due"
    | "canceled"
    | "unpaid"
    | "paused";
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: number | null;
  trialEnd: number | null;
  latestInvoiceId: string | null;
}

export interface InvoiceSummary {
  id: string;
  number: string | null;
  created: number;
  amountPaid: number;
  amountDue: number;
  currency: string;
  status: string | null;
  hostedInvoiceUrl: string | null;
}

export interface CheckoutRequest {
  customerId: string;
  priceId: string;
  plan: PlanId;
  interval: BillingInterval;
  userId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  id: string;
  url: string;
}

export interface StripeGateway {
  /** "live" and "test" both mean a real Stripe account; "local" is the stand-in. */
  mode: "live" | "test" | "local";
  createCustomer(input: {
    email: string | null;
    name: string | null;
    userId: string;
  }): Promise<string>;
  createCheckoutSession(input: CheckoutRequest): Promise<CheckoutSession>;
  retrieveSubscription(id: string): Promise<SubscriptionSnapshot>;
  setCancelAtPeriodEnd(
    id: string,
    cancelAtPeriodEnd: boolean,
  ): Promise<SubscriptionSnapshot>;
  cancelImmediately(id: string): Promise<SubscriptionSnapshot>;
  createBillingPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
  listInvoices(customerId: string): Promise<InvoiceSummary[]>;
}
