import { liveGateway } from "./live";
import type { StripeGateway } from "./types";

/**
 * One switch. A Stripe secret key selects the real Stripe adapter; its
 * absence selects the simulated counterparty. Nothing else in the platform
 * branches on which one is active, so going live is a key swap plus the
 * STRIPE_PRICE_* ids and nothing more.
 *
 * The simulated implementation is imported dynamically and lives outside
 * src/, so with Stripe configured it is never loaded and the boundary between
 * the platform and a simulated counterparty stays structural.
 */
export async function gateway(): Promise<StripeGateway> {
  if (process.env.STRIPE_SECRET_KEY) return liveGateway();

  const simulated = await import("@simulated/stripe/store");
  return simulated.simulatedGateway();
}

export function usingRealStripe(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
