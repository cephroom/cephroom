import type { BillingInterval, PlanId } from "./plans";

/**
 * The narrow port the platform talks to Stripe through.
 *
 * Deliberately read-mostly and deliberately small. Under Contract 1 the
 * platform holds no subscription records, so everything it needs from Stripe
 * it asks for at the moment it needs it — which keeps this surface to a
 * lookup, a list, and the three actions a reader can take on their own
 * billing.
 */

export interface SubscriptionView {
  id: string;
  tier: "member" | "lab";
  interval: BillingInterval;
  status: string;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  priceId: string;
}

export interface CheckoutRequest {
  /** Pseudonymous subject, written to customer metadata so Stripe holds the map. */
  sub: string;
  customerId: string | null;
  priceId: string;
  plan: PlanId;
  interval: BillingInterval;
  successUrl: string;
  cancelUrl: string;
}

export interface StripeGateway {
  /** "live" and "test" mean a real Stripe account; "simulated" is the stand-in. */
  mode: "live" | "test" | "simulated";

  /** Asks Stripe which customer carries this subject in its metadata. */
  findCustomerBySubject(sub: string): Promise<string | null>;

  listSubscriptions(customerId: string): Promise<SubscriptionView[]>;

  createCheckoutSession(
    input: CheckoutRequest,
  ): Promise<{ id: string; url: string }>;

  setCancelAtPeriodEnd(
    subscriptionId: string,
    cancelAtPeriodEnd: boolean,
  ): Promise<void>;

  createBillingPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
}
