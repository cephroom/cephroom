import type { DiscoveryTier } from "@/lib/access";

/**
 * What tier a renewal should stamp, including when Stripe did not answer.
 *
 * The distinction this exists to make: **Stripe saying "no subscription" and
 * Stripe saying nothing are different facts**, and the renewal path treated
 * them as the same one. A paying subscriber who happened to renew during an
 * outage was silently demoted to the free tier — their subscription intact,
 * nobody refunded, the platform simply issuing a key that said otherwise.
 *
 * It was reachable deliberately, which is what made it worth fixing rather
 * than noting. Token issuance calls Stripe once per batch, and an insider
 * farming tokens was measured at ~574 calls an hour from one connection,
 * against the same rate limit sign-in and billing share. Exhaust it and every
 * *other* subscriber renewing in that window drops to reader.
 *
 * Carrying the current tier forward means a cancelled subscriber also keeps
 * theirs for the length of an outage. That is the right side to err on. The
 * platform collects the same money either way; over-serving during its own
 * outage costs nothing measurable, and under-serving a paying customer is a
 * lie about what they bought.
 *
 * Never upward, though. An outage must not become a way to acquire access
 * nobody sold.
 */
export function tierOnRenewal(input: {
  /** What Stripe reported, or null if it could not be reached. */
  fromStripe: DiscoveryTier | null;
  /** The plan the consumer currently holds, or null if they hold none. */
  current: DiscoveryTier | null;
}): DiscoveryTier {
  if (input.fromStripe !== null) return input.fromStripe;
  return input.current ?? "browse";
}
