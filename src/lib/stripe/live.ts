import Stripe from "stripe";

import { planForPrice } from "./plans";
import {
  SUBJECT_METADATA_KEY,
  SUBJECT_METADATA_KEYS,
  type StripeGateway,
  type SubscriptionView,
} from "./types";

let client: Stripe | null = null;

function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
  client ??= new Stripe(key, { appInfo: { name: "Cephroom" } });
  return client;
}

function periodEnd(subscription: Stripe.Subscription): number | null {
  const item = subscription.items?.data?.[0] as
    | (Stripe.SubscriptionItem & { current_period_end?: number })
    | undefined;
  const legacy = subscription as Stripe.Subscription & {
    current_period_end?: number;
  };
  return legacy.current_period_end ?? item?.current_period_end ?? null;
}

function toView(subscription: Stripe.Subscription): SubscriptionView | null {
  const priceId = subscription.items.data[0]?.price.id ?? "";
  const match = planForPrice(priceId);
  // A subscription to a price we do not sell is not one of ours. Ignoring it
  // is safer than guessing a tier from it.
  if (!match) return null;

  return {
    id: subscription.id,
    tier: match.plan,
    interval: match.interval,
    status: subscription.status,
    currentPeriodEnd: periodEnd(subscription),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    priceId,
  };
}

export function liveGateway(): StripeGateway {
  const key = process.env.STRIPE_SECRET_KEY ?? "";

  return {
    mode: key.startsWith("sk_live") ? "live" : "test",

    async findCustomerBySubject(sub) {
      // Stripe holds the subject-to-customer mapping in customer metadata,
      // so the platform does not have to. Every metadata key this platform
      // has ever used is searched, newest first — see SUBJECT_METADATA_KEYS
      // for why dropping one would orphan returning subscribers.
      for (const key of SUBJECT_METADATA_KEYS) {
        const found = await stripe().customers.search({
          query: `metadata['${key}']:'${sub}'`,
          limit: 1,
        });
        const id = found.data[0]?.id;
        if (!id) continue;

        if (key !== SUBJECT_METADATA_KEY) {
          // Migrate the mapping forward so the legacy search is paid once per
          // customer rather than on every renewal. Writing to Stripe is
          // allowed; writing it here would not be.
          await stripe().customers.update(id, {
            metadata: { [SUBJECT_METADATA_KEY]: sub },
          });
        }
        return id;
      }
      return null;
    },

    async listSubscriptions(customerId) {
      const list = await stripe().subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 20,
      });
      return list.data
        .map(toView)
        .filter((view): view is SubscriptionView => view !== null);
    },

    async createCheckoutSession(input) {
      const customer =
        input.customerId ??
        (
          await stripe().customers.create({
            metadata: { [SUBJECT_METADATA_KEY]: input.sub },
          })
        ).id;

      const session = await stripe().checkout.sessions.create({
        mode: "subscription",
        customer,
        line_items: [{ price: input.priceId, quantity: 1 }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        allow_promotion_codes: true,
        // Carried so that a customer created by Checkout still answers the
        // metadata lookup above.
        subscription_data: { metadata: { [SUBJECT_METADATA_KEY]: input.sub } },
      });

      if (!session.url) throw new Error("Stripe returned no checkout URL.");
      return { id: session.id, url: session.url };
    },

    async setCancelAtPeriodEnd(subscriptionId, cancelAtPeriodEnd) {
      await stripe().subscriptions.update(subscriptionId, {
        cancel_at_period_end: cancelAtPeriodEnd,
      });
    },

    async createBillingPortalSession({ customerId, returnUrl }) {
      const session = await stripe().billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });
      return { url: session.url };
    },
  };
}
