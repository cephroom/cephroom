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
  /**
   * A self-declared reduced annual rate, for students and anyone for whom the
   * full price is the reason they are not here.
   *
   * A norm in this field rather than a discount gimmick: SfN charges $245 a
   * year for a regular membership and $95 for a graduate student, OHBM $220
   * against $100. Both verify status with a letter from a department head —
   * which Contract 1 forbids us from doing, because verifying means holding a
   * record of who proved what. So it is asked, not proved. The reader picks
   * this price at checkout and nothing about the choice is written down.
   *
   * It buys the same tier. Nothing about the reading experience differs, and
   * nothing marks a reduced-rate key, because a key that said "student" would
   * be a stored fact about a person riding around in their browser.
   */
  reduced?: PricePoint & { label: string; note: string };
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
    // No API over "check history" — there is no stored history to expose.
    // Lab is about serving your own work, not about us keeping more of it.
    // Two entries were removed here in cycle 3: "Serve your own columns and
    // datasets from your node" and "Serve under your own signed identity".
    // Both are free at every tier, by contract, and were never enforced — so
    // the only thing they did was tell a prospective contributor that
    // publishing costs $29 a month. Selling something free is worse than a
    // bug. tests/contracts/serving-is-free.test.ts keeps them out.
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

/**
 * Reverse lookup: which plan does this Stripe price belong to.
 *
 * The reduced rate resolves to its plan's annual interval, so a reduced-rate
 * subscriber is a Member subscriber in every respect the rest of the system
 * can see. That is deliberate: the tier is the entitlement, and what someone
 * paid is between them and Stripe.
 */
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

/**
 * Finds a price by its Stripe price id.
 *
 * A checkout session is identified by a price id, not by a plan and an
 * interval — so anything rendering what a session costs has to look it up
 * this way. Reconstructing it from `plan` + `interval` silently loses any
 * price that is not one of the two on that axis, which is how the simulated
 * checkout came to offer the reduced rate at the full annual price.
 */
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

/** Monthly-equivalent price of an annual plan, for the comparison line. */
export function monthlyEquivalent(plan: PlanDefinition): string {
  return formatPrice(Math.round(plan.prices.year.unitAmount / 12));
}

export function annualSavingMonths(plan: PlanDefinition): number {
  const full = plan.prices.month.unitAmount * 12;
  const saved = full - plan.prices.year.unitAmount;
  return Math.round(saved / plan.prices.month.unitAmount);
}
