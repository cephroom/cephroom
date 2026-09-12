import type {
  AnyPlanId,
  BillingInterval,
  DiscoveryTier,
  ServingTier,
} from "./plans";


export interface SubscriptionView {
  id: string;
  plan: AnyPlanId;
  discovery: DiscoveryTier | null;
  serving: ServingTier | null;
  interval: BillingInterval;
  status: string;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  priceId: string;
}

export interface CheckoutRequest {
  sub: string;
  customerId: string | null;
  priceId: string;
  plan: AnyPlanId;
  interval: BillingInterval;
  successUrl: string;
  cancelUrl: string;
}

export interface StripeGateway {
  mode: "live" | "test" | "simulated";

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


export const SUBJECT_METADATA_KEY = "cephroomSub";

export const LEGACY_SUBJECT_METADATA_KEYS = ["receptoromeSub"] as const;

export const SUBJECT_METADATA_KEYS: readonly string[] = [
  SUBJECT_METADATA_KEY,
  ...LEGACY_SUBJECT_METADATA_KEYS,
];

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
