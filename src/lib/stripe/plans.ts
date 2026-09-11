export type PlanId = "member" | "lab";
export type BillingInterval = "month" | "year";

export interface PricePoint {
  interval: BillingInterval;
  /** Amount in the smallest currency unit, as Stripe reports it. */
  unitAmount: number;
  priceId: string;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  tagline: string;
  features: string[];
  prices: Record<BillingInterval, PricePoint>;
}

/**
 * Price IDs come from the environment so that moving from test mode to live
 * is a change of keys and price IDs and nothing else. The `price_local_*`
 * fallbacks are only ever used by the local Stripe stand-in.
 */
function priceId(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  member: {
    id: "member",
    name: "Member",
    tagline: "Every column in full, and the evidence behind every number.",
    features: [
      "The complete archive, including member columns",
      "The claim inspector: query, evidence count, drift",
      "The dataset explorer with full provenance",
      "Propose edits to any published column",
      "Fork a column and publish your own version",
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
  },
  lab: {
    id: "lab",
    name: "Lab",
    tagline: "For groups who publish their own checked work.",
    features: [
      "Everything in Member",
      "Lab columns: the long methodological pieces",
      "Private drafts and unlimited check runs",
      "Upload your own datasets for claims to resolve against",
      "Read-only API access to claims and check history",
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

/** Reverse lookup, used by the webhook to name the plan a price belongs to. */
export function planForPrice(
  stripePriceId: string,
): { plan: PlanId; interval: BillingInterval } | null {
  for (const plan of PLAN_ORDER) {
    for (const interval of ["month", "year"] as const) {
      if (PLANS[plan].prices[interval].priceId === stripePriceId) {
        return { plan, interval };
      }
    }
  }
  return null;
}

export function formatPrice(unitAmount: number): string {
  const amount = unitAmount / 100;
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/** Monthly-equivalent price of an annual plan, for the comparison line. */
export function monthlyEquivalent(plan: PlanDefinition): string {
  return formatPrice(Math.round(plan.prices.year.unitAmount / 12));
}

export function annualSavingMonths(plan: PlanDefinition): number {
  const full = plan.prices.month.unitAmount * 12;
  const saved = full - plan.prices.year.unitAmount;
  return Math.round(saved / plan.prices.month.unitAmount);
}
