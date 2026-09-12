import { liveGateway } from "./live";
import type { StripeGateway } from "./types";

export async function gateway(): Promise<StripeGateway> {
  if (process.env.STRIPE_SECRET_KEY) return liveGateway();

  const simulated = await import("@simulated/stripe/store");
  return simulated.simulatedGateway();
}

export function usingRealStripe(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
