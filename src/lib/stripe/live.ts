import "server-only";

import Stripe from "stripe";

import type {
  CheckoutRequest,
  CheckoutSession,
  InvoiceSummary,
  StripeGateway,
  SubscriptionSnapshot,
} from "./types";

let client: Stripe | null = null;

export function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. The live gateway cannot be used.",
    );
  }
  client ??= new Stripe(key, { appInfo: { name: "Bindery" } });
  return client;
}

/**
 * Recent Stripe API versions moved the billing period onto the subscription
 * item rather than the subscription. Read whichever one is present so this
 * keeps working across an API version bump.
 */
function periodOf(subscription: Stripe.Subscription): {
  start: number | null;
  end: number | null;
} {
  const item = subscription.items?.data?.[0] as
    | (Stripe.SubscriptionItem & {
        current_period_start?: number;
        current_period_end?: number;
      })
    | undefined;
  const legacy = subscription as Stripe.Subscription & {
    current_period_start?: number;
    current_period_end?: number;
  };

  return {
    start: legacy.current_period_start ?? item?.current_period_start ?? null,
    end: legacy.current_period_end ?? item?.current_period_end ?? null,
  };
}

export function toSnapshot(
  subscription: Stripe.Subscription,
): SubscriptionSnapshot {
  const period = periodOf(subscription);
  const latestInvoice = subscription.latest_invoice;

  return {
    id: subscription.id,
    customerId:
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id,
    priceId: subscription.items.data[0]?.price.id ?? "",
    status: subscription.status,
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: subscription.canceled_at ?? null,
    trialEnd: subscription.trial_end ?? null,
    latestInvoiceId:
      typeof latestInvoice === "string" ? latestInvoice : (latestInvoice?.id ?? null),
  };
}

export function liveGateway(): StripeGateway {
  const stripe = stripeClient();
  const key = process.env.STRIPE_SECRET_KEY ?? "";

  return {
    mode: key.startsWith("sk_live") ? "live" : "test",

    async createCustomer({ email, name, userId }) {
      const customer = await stripe.customers.create({
        email: email ?? undefined,
        name: name ?? undefined,
        metadata: { binderyUserId: userId },
      });
      return customer.id;
    },

    async createCheckoutSession(
      input: CheckoutRequest,
    ): Promise<CheckoutSession> {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: input.customerId,
        line_items: [{ price: input.priceId, quantity: 1 }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        allow_promotion_codes: true,
        // Carried onto the subscription so the webhook can attribute it
        // without a second lookup.
        subscription_data: {
          metadata: {
            binderyUserId: input.userId,
            binderyPlan: input.plan,
            binderyInterval: input.interval,
          },
        },
        client_reference_id: input.userId,
        metadata: { binderyUserId: input.userId, binderyPlan: input.plan },
      });

      if (!session.url) {
        throw new Error("Stripe returned a checkout session with no URL.");
      }
      return { id: session.id, url: session.url };
    },

    async retrieveSubscription(id) {
      return toSnapshot(await stripe.subscriptions.retrieve(id));
    },

    async setCancelAtPeriodEnd(id, cancelAtPeriodEnd) {
      return toSnapshot(
        await stripe.subscriptions.update(id, {
          cancel_at_period_end: cancelAtPeriodEnd,
        }),
      );
    },

    async cancelImmediately(id) {
      return toSnapshot(await stripe.subscriptions.cancel(id));
    },

    async createBillingPortalSession({ customerId, returnUrl }) {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });
      return { url: session.url };
    },

    async listInvoices(customerId): Promise<InvoiceSummary[]> {
      const invoices = await stripe.invoices.list({
        customer: customerId,
        limit: 12,
      });
      return invoices.data.map((invoice) => ({
        id: invoice.id ?? "",
        number: invoice.number,
        created: invoice.created,
        amountPaid: invoice.amount_paid,
        amountDue: invoice.amount_due,
        currency: invoice.currency,
        status: invoice.status,
        hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      }));
    },
  };
}
