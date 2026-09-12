import { describe, expect, it } from "vitest";

import {
  annualSavingMonths,
  formatPrice,
  monthlyEquivalent,
  PLANS,
  PLAN_ORDER,
  priceForId,
  planForPrice,
} from "./plans";

describe("plan catalogue", () => {
  it("gives every plan and interval a distinct price id", () => {
    const ids = PLAN_ORDER.flatMap((plan) =>
      (["month", "year"] as const).map(
        (interval) => PLANS[plan].prices[interval].priceId,
      ),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("prices the annual plan below twelve months", () => {
    for (const plan of PLAN_ORDER) {
      const definition = PLANS[plan];
      expect(definition.prices.year.unitAmount).toBeLessThan(
        definition.prices.month.unitAmount * 12,
      );
    }
  });

  it("orders the tiers by price", () => {
    expect(PLANS.member.prices.month.unitAmount).toBeLessThan(
      PLANS.lab.prices.month.unitAmount,
    );
  });
});

describe("planForPrice", () => {
  it("maps a price id back to its plan and interval", () => {
    expect(planForPrice(PLANS.member.prices.month.priceId)).toEqual({
      plan: "member",
      interval: "month",
    });
    expect(planForPrice(PLANS.lab.prices.year.priceId)).toEqual({
      plan: "lab",
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
    expect(monthlyEquivalent(PLANS.member)).toBe("$7.50");
  });

  it("counts the months an annual plan saves", () => {
    expect(annualSavingMonths(PLANS.member)).toBe(2);
  });
});

describe("the reduced rate is a price, not a tier", () => {
  it("resolves to its plan, so a reduced subscriber is a Member", () => {
    const reduced = PLANS.member.reduced!;
    expect(planForPrice(reduced.priceId)).toEqual({
      plan: "member",
      interval: "year",
    });
  });

  it("is cheaper than the full annual rate", () => {
    expect(PLANS.member.reduced!.unitAmount).toBeLessThan(
      PLANS.member.prices.year.unitAmount,
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
    const reduced = PLANS.member.reduced!;
    expect(priceForId(reduced.priceId)).toEqual({
      plan: PLANS.member,
      price: reduced,
    });
  });

  it("finds the ordinary prices by id too", () => {
    expect(priceForId(PLANS.lab.prices.month.priceId)?.price.unitAmount).toBe(
      PLANS.lab.prices.month.unitAmount,
    );
    expect(priceForId(PLANS.member.prices.year.priceId)?.price.unitAmount).toBe(
      PLANS.member.prices.year.unitAmount,
    );
  });

  it("returns null for a price we do not sell", () => {
    expect(priceForId("price_not_ours")).toBeNull();
  });
});
