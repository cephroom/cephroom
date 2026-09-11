import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { db } from "@/lib/db";
import { stripeEvents } from "@/lib/db/schema";
import { constructEvent, gateway } from "@/lib/stripe/gateway";
import { toSnapshot } from "@/lib/stripe/live";
import { syncSubscription } from "@/lib/stripe/sync";
import type { SubscriptionSnapshot } from "@/lib/stripe/types";

export const dynamic = "force-dynamic";

/** Events we act on. Anything else is acknowledged and ignored. */
const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
]);

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  // The raw body is required: the signature covers the exact bytes sent.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = constructEvent(payload, signature);
  } catch (error) {
    console.error("[stripe] signature verification failed", error);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  // Idempotency. Stripe retries on any non-2xx and can deliver the same event
  // more than once even on success, so the insert is the lock: a duplicate
  // collides on the primary key and the side effects are skipped.
  try {
    await db.insert(stripeEvents).values({
      id: event.id,
      type: event.type,
      payload: event.data.object,
    });
  } catch {
    return NextResponse.json({ received: true, duplicate: true });
  }

  if (!HANDLED.has(event.type)) {
    await markProcessed(event.id);
    return NextResponse.json({ received: true, ignored: true });
  }

  try {
    await handle(event);
    await markProcessed(event.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[stripe] ${event.type} failed`, error);

    // Record the failure and delete the idempotency row so Stripe's retry
    // gets a fresh attempt rather than being swallowed as a duplicate.
    await db
      .update(stripeEvents)
      .set({ error: message })
      .where(eq(stripeEvents.id, event.id));
    await db.delete(stripeEvents).where(eq(stripeEvents.id, event.id));

    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handle(event: Stripe.Event) {
  switch (event.type) {
    /**
     * Checkout finished. The subscription object is not expanded on the
     * session, so fetch it: this is the event that carries the Bindery user
     * id, and it is the only reliable place to attribute a brand-new
     * subscription to an account.
     */
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription" || !session.subscription) return;

      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription.id;

      const userId =
        session.client_reference_id ??
        session.metadata?.binderyUserId ??
        undefined;

      const snapshot = await gateway().retrieveSubscription(subscriptionId);
      await syncSubscription(snapshot, { userId });
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const snapshot = toSnapshot(subscription);

      // A deletion event can arrive with a status that is not yet `canceled`
      // when the cancellation was scheduled; the event itself is the signal.
      if (event.type === "customer.subscription.deleted") {
        snapshot.status = "canceled";
        snapshot.canceledAt ??= Math.floor(Date.now() / 1000);
      }

      await syncSubscription(snapshot, {
        userId: subscription.metadata?.binderyUserId || undefined,
      });
      return;
    }

    case "invoice.paid":
    case "invoice.payment_succeeded": {
      const snapshot = await subscriptionForInvoice(event);
      if (snapshot) {
        await syncSubscription(snapshot, { paymentSucceeded: true });
      }
      return;
    }

    /**
     * A failed charge. Stripe will keep retrying on its own schedule, so this
     * does not revoke access - it records the failure so the account page can
     * ask the subscriber to update their card before the retries run out.
     */
    case "invoice.payment_failed": {
      const snapshot = await subscriptionForInvoice(event);
      if (snapshot) {
        await syncSubscription(snapshot, { paymentFailed: true });
      }
      return;
    }
  }
}

/**
 * Finds the subscription an invoice belongs to. Newer API versions moved the
 * link from `invoice.subscription` to `invoice.parent`, so read both.
 */
async function subscriptionForInvoice(
  event: Stripe.Event,
): Promise<SubscriptionSnapshot | null> {
  const invoice = event.data.object as Stripe.Invoice & {
    subscription?: string | { id: string } | null;
    parent?: {
      subscription_details?: { subscription?: string | { id: string } } | null;
    } | null;
  };

  const raw =
    invoice.subscription ?? invoice.parent?.subscription_details?.subscription;
  const subscriptionId = typeof raw === "string" ? raw : raw?.id;
  if (!subscriptionId) return null;

  return gateway().retrieveSubscription(subscriptionId);
}

async function markProcessed(eventId: string) {
  await db
    .update(stripeEvents)
    .set({ processedAt: new Date() })
    .where(eq(stripeEvents.id, eventId));
}
