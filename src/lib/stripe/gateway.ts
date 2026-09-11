import "server-only";

import Stripe from "stripe";

import { liveGateway } from "./live";
import { localGateway, webhookSecret } from "./local";
import type { StripeGateway } from "./types";

/**
 * One switch: a Stripe secret key selects the real Stripe adapter, and its
 * absence selects the local stand-in. Nothing else in the application branches
 * on which one is active.
 */
export function gateway(): StripeGateway {
  return process.env.STRIPE_SECRET_KEY ? liveGateway() : localGateway();
}

export function usingRealStripe(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Verifies a webhook signature. This is real in both modes: signature
 * verification is pure cryptography, and running the stand-in through it is
 * the point - it means the production code path is the tested one.
 */
export function constructEvent(payload: string, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? webhookSecret();
  const client = new Stripe(
    process.env.STRIPE_SECRET_KEY ?? "sk_test_signature_verification_only",
  );
  return client.webhooks.constructEvent(payload, signature, secret);
}
