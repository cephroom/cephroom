export type PlanId = "member" | "lab";
export type BillingInterval = "month" | "year";

export interface PricePoint {
  interval: BillingInterval;
  unitAmount: number;
  priceId: string;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  tagline: string;
  features: string[];
  prices: Record<BillingInterval, PricePoint>;
  reduced?: PricePoint & { label: string; note: string };
}

function priceId(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  member: {
    id: "member",
    name: "Member",
    tagline: "Every column in full, and the evidence behind every number.",
    // No "archive" or "fork" — both were cut by the contracts (there is no
    // stored history, and forking would mean the platform holding a copy).
    // Selling a feature the product does not have is worse than a bug.
    features: [
      "Every member column in full, from whoever is serving it",
      "The claim inspector: query, evidence count, drift",
      "The dataset explorer, fetched from the author's node",
      "Propose edits, delivered straight to the author",
      "Your key verified by the node, not by us",
    ],
    prices: {
      month: {
        interval: "month",
        unitAmount: 900,
        priceId: priceId("STRIPE_PRICE_MEMBER_MONTHLY", "price_local_member_month"),
      },
      year: {
        interval: "year",
        unitAmount: 9000,
        priceId: priceId("STRIPE_PRICE_MEMBER_YEARLY", "price_local_member_year"),
      },
    },
    reduced: {
      interval: "year",
      unitAmount: 3600,
      priceId: priceId(
        "STRIPE_PRICE_MEMBER_REDUCED",
        "price_local_member_reduced",
      ),
      label: "Student and reduced",
      note: "If the full price is the reason you are not here, take this one. Students, between posts, unfunded, or paying for it yourself — no proof asked for, because asking for proof would mean keeping it.",
    },
  },
  lab: {
    id: "lab",
    name: "Lab",
    tagline: "For groups reading and arguing with each other's work.",
    features: [
      "Everything in Member",
      "Lab columns: the long methodological pieces",
      "The whole dataset explorer, including the evidence matrices",
      "Bulk proposals across a group's columns",
    ],
    prices: {
      month: {
        interval: "month",
        unitAmount: 2900,
        priceId: priceId("STRIPE_PRICE_LAB_MONTHLY", "price_local_lab_month"),
      },
      year: {
        interval: "year",
        unitAmount: 29000,
        priceId: priceId("STRIPE_PRICE_LAB_YEARLY", "price_local_lab_year"),
      },
    },
  },
};

export const PLAN_ORDER: PlanId[] = ["member", "lab"];

export function planForPrice(
  stripePriceId: string,
): { plan: PlanId; interval: BillingInterval } | null {
  for (const plan of PLAN_ORDER) {
    for (const interval of ["month", "year"] as const) {
      if (PLANS[plan].prices[interval].priceId === stripePriceId) {
        return { plan, interval };
      }
    }
    if (PLANS[plan].reduced?.priceId === stripePriceId) {
      return { plan, interval: "year" };
    }
  }
  return null;
}

export function priceForId(
  stripePriceId: string,
): { plan: PlanDefinition; price: PricePoint } | null {
  for (const planId of PLAN_ORDER) {
    const plan = PLANS[planId];
    for (const interval of ["month", "year"] as const) {
      if (plan.prices[interval].priceId === stripePriceId) {
        return { plan, price: plan.prices[interval] };
      }
    }
    if (plan.reduced?.priceId === stripePriceId) {
      return { plan, price: plan.reduced };
    }
  }
  return null;
}

export function formatPrice(unitAmount: number): string {
  const amount = unitAmount / 100;
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

export function monthlyEquivalent(plan: PlanDefinition): string {
  return formatPrice(Math.round(plan.prices.year.unitAmount / 12));
}

export function annualSavingMonths(plan: PlanDefinition): number {
  const full = plan.prices.month.unitAmount * 12;
  const saved = full - plan.prices.year.unitAmount;
  return Math.round(saved / plan.prices.month.unitAmount);
}
