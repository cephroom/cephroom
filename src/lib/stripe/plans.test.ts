import { describe, expect, it } from "vitest";

import {
  annualSavingMonths,
  formatPrice,
  monthlyEquivalent,
  PLANS,
  PLAN_ORDER,
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
