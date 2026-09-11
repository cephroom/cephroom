import { describe, expect, it } from "vitest";

import { PLANS } from "./plans";
import { projectSubscription, UnknownPriceError } from "./projection";
import type { SubscriptionSnapshot } from "./types";

const NOW = new Date("2026-09-11T12:00:00Z");
const PERIOD_START = 1_757_500_000;
const PERIOD_END = 1_760_092_000;

function snapshot(
  overrides: Partial<SubscriptionSnapshot> = {},
): SubscriptionSnapshot {
  return {
    id: "sub_123",
    customerId: "cus_123",
    priceId: PLANS.member.prices.month.priceId,
    status: "active",
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    trialEnd: null,
    latestInvoiceId: "in_123",
    ...overrides,
  };
}

describe("projectSubscription", () => {
  it("maps the price back to a plan and interval", () => {
    const row = projectSubscription(
      snapshot({ priceId: PLANS.lab.prices.year.priceId }),
      { now: NOW },
    );
    expect(row.plan).toBe("lab");
    expect(row.interval).toBe("year");
  });

  it("converts Stripe epoch seconds to dates", () => {
    const row = projectSubscription(snapshot(), { now: NOW });
    expect(row.currentPeriodEnd).toEqual(new Date(PERIOD_END * 1000));
    expect(row.currentPeriodStart).toEqual(new Date(PERIOD_START * 1000));
    expect(row.trialEnd).toBeNull();
  });

  it("refuses a price that is not one of ours", () => {
    // Better a failed webhook Stripe will retry than a subscription row with
    // a plan guessed from nothing.
    expect(() =>
      projectSubscription(snapshot({ priceId: "price_someone_elses" })),
    ).toThrow(UnknownPriceError);
  });

  it("carries the cancellation flags through", () => {
    const row = projectSubscription(
      snapshot({ cancelAtPeriodEnd: true, canceledAt: PERIOD_START }),
      { now: NOW },
    );
    expect(row.cancelAtPeriodEnd).toBe(true);
    expect(row.canceledAt).toEqual(new Date(PERIOD_START * 1000));
  });
});

describe("the dunning flag", () => {
  it("is set by a failed invoice", () => {
    const row = projectSubscription(snapshot({ status: "past_due" }), {
      paymentFailed: true,
      now: NOW,
    });
    expect(row.paymentFailedAt).toEqual(NOW);
  });

  it("survives an unrelated event while the subscription is still past due", () => {
    const earlier = new Date("2026-09-09T08:00:00Z");
    const row = projectSubscription(snapshot({ status: "past_due" }), {
      existingPaymentFailedAt: earlier,
      now: NOW,
    });
    expect(row.paymentFailedAt).toEqual(earlier);
  });

  it("is cleared by a paid invoice", () => {
    const row = projectSubscription(snapshot({ status: "past_due" }), {
      paymentSucceeded: true,
      existingPaymentFailedAt: new Date("2026-09-09T08:00:00Z"),
      now: NOW,
    });
    expect(row.paymentFailedAt).toBeNull();
  });

  it("is cleared whenever Stripe says the subscription is active again", () => {
    // Recovery can arrive as a subscription update rather than an invoice
    // event. A stale flag would leave a dunning banner up for someone who has
    // already paid.
    const row = projectSubscription(snapshot({ status: "active" }), {
      existingPaymentFailedAt: new Date("2026-09-09T08:00:00Z"),
      now: NOW,
    });
    expect(row.paymentFailedAt).toBeNull();
  });

  it("is cleared for a trial", () => {
    const row = projectSubscription(snapshot({ status: "trialing" }), {
      existingPaymentFailedAt: new Date("2026-09-09T08:00:00Z"),
      now: NOW,
    });
    expect(row.paymentFailedAt).toBeNull();
  });

  it("is kept on a cancelled subscription, as the record of why", () => {
    const failed = new Date("2026-09-09T08:00:00Z");
    const row = projectSubscription(snapshot({ status: "canceled" }), {
      existingPaymentFailedAt: failed,
      now: NOW,
    });
    expect(row.paymentFailedAt).toEqual(failed);
  });
});
