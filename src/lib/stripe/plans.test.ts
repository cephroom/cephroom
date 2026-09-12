import { describe, expect, it } from "vitest";

import {
  annualSavingMonths,
  DISCOVERY_ORDER,
  DISCOVERY_PLANS,
  formatPrice,
  monthlyEquivalent,
  priceForId,
  planForPrice,
  SERVING_ORDER,
  SERVING_PLANS,
} from "./plans";

/** Every plan in both catalogues that actually has a price. */
const PAID = [
  ...DISCOVERY_ORDER.map((id) => DISCOVERY_PLANS[id]),
  ...SERVING_ORDER.map((id) => SERVING_PLANS[id]),
].filter((plan) => plan.prices);

describe("plan catalogue", () => {
  it("gives every plan and interval a distinct price id", () => {
    const ids = PAID.flatMap((plan) =>
      (["month", "year"] as const).map(
        (interval) => plan.prices![interval].priceId,
      ),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("prices the annual plan below twelve months", () => {
    for (const plan of PAID) {
      expect(plan.prices!.year.unitAmount).toBeLessThan(
        plan.prices!.month.unitAmount * 12,
      );
    }
  });

  it("orders the tiers by price", () => {
    expect(DISCOVERY_PLANS.query.prices!.month.unitAmount).toBeLessThan(
      DISCOVERY_PLANS.sweep.prices!.month.unitAmount,
    );
    expect(SERVING_PLANS.shelf.prices!.month.unitAmount).toBeLessThan(
      SERVING_PLANS.stacks.prices!.month.unitAmount,
    );
  });
});

describe("planForPrice", () => {
  it("maps a price id back to its plan and interval", () => {
    expect(planForPrice(DISCOVERY_PLANS.query.prices!.month.priceId)).toEqual({
      plan: "query",
      interval: "month",
    });
    expect(planForPrice(DISCOVERY_PLANS.sweep.prices!.year.priceId)).toEqual({
      plan: "sweep",
      interval: "year",
    });
  });

  it("returns null for a price we do not sell", () => {
    // The webhook turns this into a loud failure rather than a silent
    // subscription with no plan attached.
    expect(planForPrice("price_from_some_other_product")).toBeNull();
  });
});

describe("price formatting", () => {
  it("drops the cents when there are none", () => {
    expect(formatPrice(900)).toBe("$9");
    expect(formatPrice(2900)).toBe("$29");
    expect(formatPrice(1250)).toBe("$12.50");
  });

  it("states the annual plan as a monthly equivalent", () => {
    expect(monthlyEquivalent(DISCOVERY_PLANS.query)).toBe("$7.50");
  });

  it("counts the months an annual plan saves", () => {
    expect(annualSavingMonths(DISCOVERY_PLANS.query)).toBe(2);
  });
});

describe("the reduced rate is a price, not a tier", () => {
  it("resolves to its plan, so a reduced subscriber is on Query", () => {
    const reduced = DISCOVERY_PLANS.query.reduced!;
    expect(planForPrice(reduced.priceId)).toEqual({
      plan: "query",
      interval: "year",
    });
  });

  it("is cheaper than the full annual rate", () => {
    expect(DISCOVERY_PLANS.query.reduced!.unitAmount).toBeLessThan(
      DISCOVERY_PLANS.query.prices!.year.unitAmount,
    );
  });

  /**
   * Found by taking the reduced rate through the simulated checkout: the page
   * offered "Member — $90 per year" for a session whose `priceId` was the $36
   * one. The stand-in reconstructed the price from `plan` + `interval` and
   * ignored the price id it had been handed.
   *
   * Real Stripe Checkout reads the price id and would have charged $36, so
   * nobody was ever going to be overcharged. That is exactly why it is worth
   * fixing rather than shrugging at: the stand-in exists so the billing path
   * is exercised honestly in development, and one that quietly disagrees with
   * Stripe about the amount is worse than no stand-in at all.
   */
  it("can be found by price id, which is what a checkout is given", () => {
    const reduced = DISCOVERY_PLANS.query.reduced!;
    expect(priceForId(reduced.priceId)).toEqual({
      plan: DISCOVERY_PLANS.query,
      price: reduced,
    });
  });

  it("finds the ordinary prices by id too", () => {
    expect(
      priceForId(DISCOVERY_PLANS.sweep.prices!.month.priceId)?.price.unitAmount,
    ).toBe(DISCOVERY_PLANS.sweep.prices!.month.unitAmount);
    expect(
      priceForId(SERVING_PLANS.shelf.prices!.year.priceId)?.price.unitAmount,
    ).toBe(SERVING_PLANS.shelf.prices!.year.unitAmount);
  });

  it("returns null for a price we do not sell", () => {
    expect(priceForId("price_not_ours")).toBeNull();
  });
});
