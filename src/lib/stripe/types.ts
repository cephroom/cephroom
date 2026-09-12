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

/* ------------------------------------------------------------------ *
 * The subject-to-customer mapping, which Stripe holds so we need not
 * ------------------------------------------------------------------ */

/**
 * The customer-metadata key Stripe stores a reader's pseudonymous subject
 * under.
 *
 * Contract 1 forbids the platform from keeping the subject-to-customer map,
 * so it lives in Stripe's customer metadata and the platform searches for it.
 * The consequence is easy to miss: **this key name is stored data the
 * platform does not control.** Renaming it does not rename the millions of
 * bytes already sitting in Stripe. The lookup then misses, and a returning
 * subscriber is treated as brand new — a fresh customer is created alongside
 * their live subscription, and they are silently downgraded to Reader while
 * still being billed.
 *
 * This platform was called `receptorome` before it was called `cephroom`, and
 * that rename walked straight into it. So: new customers are written with
 * {@link SUBJECT_METADATA_KEY}, and every name the platform has ever used is
 * still searched, newest first. A customer found under a legacy key is
 * migrated forward on the spot, so the extra search happens once per customer
 * and then never again.
 *
 * Adding a name here is cheap. Removing one orphans everybody who has not
 * signed in since the rename, so nothing is ever removed.
 */
export const SUBJECT_METADATA_KEY = "cephroomSub";

/** Names this platform has used before. Searched, never written. */
export const LEGACY_SUBJECT_METADATA_KEYS = ["receptoromeSub"] as const;

/** Every name, newest first. The order the lookup tries them in. */
export const SUBJECT_METADATA_KEYS: readonly string[] = [
  SUBJECT_METADATA_KEY,
  ...LEGACY_SUBJECT_METADATA_KEYS,
];

/** The subject a customer's metadata carries, under whichever name. */
export function subjectFromMetadata(
  metadata: Record<string, string | undefined> | null | undefined,
): string | null {
  if (!metadata) return null;
  for (const key of SUBJECT_METADATA_KEYS) {
    const value = metadata[key];
    if (value) return value;
  }
  return null;
}
