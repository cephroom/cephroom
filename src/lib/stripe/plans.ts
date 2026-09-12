
export type BillingInterval = "month" | "year";

export type DiscoveryTier = "browse" | "query" | "sweep";

export type ServingTier = "desk" | "shelf" | "stacks";

export interface PricePoint {
  interval: BillingInterval;
  unitAmount: number;
  priceId: string;
}

export interface PlanDefinition<Id extends string> {
  id: Id;
  name: string;
  tagline: string;
  features: string[];
  prices?: Record<BillingInterval, PricePoint>;
  reduced?: PricePoint & { label: string; note: string };
}

function priceId(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}


/**
 * Every amount below is an integer of minor units - contract 7.
 *
 * Not style. "Payout never exceeds intake" once failed by about two parts in a
 * hundred million million, in the direction of overpaying. The size is not the
 * interesting part: the obvious repair is a tolerance, and an invariant that
 * needs a tolerance is not an invariant - it is a heuristic with a confidence
 * interval that will be wrong at some scale nobody tested.
 *
 * money-is-integer.test.ts bans fractional literals in this module outright,
 * bans scaling any money value by one anywhere in the platform, and
 * demonstrates the failure rather than asserting the rule, so the next person
 * under time pressure can see it rather than take it on trust. Division happens
 * only to render, and returns a string.
 */
export const DISCOVERY_REACH: Record<DiscoveryTier, number> = {
  browse: 50,
  query: 200,
  sweep: 1000,
};

export const DISCOVERY_CONCURRENCY: Record<DiscoveryTier, number> = {
  browse: 2,
  query: 8,
  sweep: 32,
};

export const DISCOVERY_PLANS: Record<DiscoveryTier, PlanDefinition<DiscoveryTier>> = {
  browse: {
    id: "browse",
    name: "Browse",
    tagline: "Everything anyone is serving, free, for as long as they serve it.",
    features: [
      "The full listing of what is online right now",
      `Search titles, summaries and tags, up to ${DISCOVERY_REACH.browse} results`,
      "Read anything you find, whole — nothing here is gated",
      "Check every claim in your own browser",
      "Propose edits straight to the author's machine",
    ],
  },
  query: {
    id: "query",
    name: "Query",
    tagline: "Search across everything online at once, and go through it properly.",
    features: [
      `Up to ${DISCOVERY_REACH.query} results per query, ranked and filterable`,
      `Fetch from ${DISCOVERY_CONCURRENCY.query} nodes at a time while your client searches inside them`,
      "The v1 API, with the same answers the site gets",
      "Resolve a claim's dataset across every node serving it",
    ],
    prices: {
      month: {
        interval: "month",
        unitAmount: 900,
        priceId: priceId("STRIPE_PRICE_QUERY_MONTHLY", "price_local_query_month"),
      },
      year: {
        interval: "year",
        unitAmount: 9000,
        priceId: priceId("STRIPE_PRICE_QUERY_YEARLY", "price_local_query_year"),
      },
    },
    reduced: {
      interval: "year",
      unitAmount: 3600,
      priceId: priceId("STRIPE_PRICE_QUERY_REDUCED", "price_local_query_reduced"),
      label: "Student and reduced",
      note: "If the full price is the reason you are not here, take this one. Students, between posts, unfunded, or paying for it yourself — no proof asked for, because asking for proof would mean keeping it.",
    },
  },
  sweep: {
    id: "sweep",
    name: "Sweep",
    tagline: "Crawl the whole live network from your own machine, at speed.",
    features: [
      "Everything in Query",
      `Up to ${DISCOVERY_REACH.sweep} results, enough to enumerate the network`,
      `Fetch from ${DISCOVERY_CONCURRENCY.sweep} nodes at once`,
      "Endpoint manifests for scripted crawling and bulk claim-checking",
    ],
    prices: {
      month: {
        interval: "month",
        unitAmount: 2900,
        priceId: priceId("STRIPE_PRICE_SWEEP_MONTHLY", "price_local_sweep_month"),
      },
      year: {
        interval: "year",
        unitAmount: 29000,
        priceId: priceId("STRIPE_PRICE_SWEEP_YEARLY", "price_local_sweep_year"),
      },
    },
  },
};


export const SERVING_CAPACITY: Record<ServingTier, number> = {
  desk: 25,
  shelf: 250,
  stacks: 2500,
};

export const FREE_SERVING_TIER: ServingTier = "desk";
export const FREE_SERVING_CAPACITY = SERVING_CAPACITY[FREE_SERVING_TIER];

export const SERVING_PLANS: Record<ServingTier, PlanDefinition<ServingTier>> = {
  desk: {
    id: "desk",
    name: "Desk",
    tagline: "Serve your work, free. This is the plan, not a preview of one.",
    features: [
      `Announce up to ${SERVING_CAPACITY.desk} columns and datasets at once`,
      "Your own subject, so nobody else can announce under your name",
      "Your byline and your --pay-to string, relayed to readers unread",
      "Proposals delivered to your machine, never through ours",
    ],
  },
  shelf: {
    id: "shelf",
    name: "Shelf",
    tagline: "For a group or an archive with more online than one desk holds.",
    features: [
      `Announce up to ${SERVING_CAPACITY.shelf} items at once`,
      "Ten times as much work online at once",
    ],
    prices: {
      month: {
        interval: "month",
        unitAmount: 1900,
        priceId: priceId("STRIPE_PRICE_SHELF_MONTHLY", "price_local_shelf_month"),
      },
      year: {
        interval: "year",
        unitAmount: 19000,
        priceId: priceId("STRIPE_PRICE_SHELF_YEARLY", "price_local_shelf_year"),
      },
    },
  },
  stacks: {
    id: "stacks",
    name: "Stacks",
    tagline: "For an institution putting a whole collection online.",
    features: [
      `Announce up to ${SERVING_CAPACITY.stacks} items at once`,
      "Everything in Shelf",
    ],
    prices: {
      month: {
        interval: "month",
        unitAmount: 9900,
        priceId: priceId("STRIPE_PRICE_STACKS_MONTHLY", "price_local_stacks_month"),
      },
      year: {
        interval: "year",
        unitAmount: 99000,
        priceId: priceId("STRIPE_PRICE_STACKS_YEARLY", "price_local_stacks_year"),
      },
    },
  },
};

export const DISCOVERY_ORDER: DiscoveryTier[] = ["browse", "query", "sweep"];
export const SERVING_ORDER: ServingTier[] = ["desk", "shelf", "stacks"];

export const DISCOVERY_RANK: Record<DiscoveryTier, number> = {
  browse: 0,
  query: 1,
  sweep: 2,
};
export const SERVING_RANK: Record<ServingTier, number> = {
  desk: 0,
  shelf: 1,
  stacks: 2,
};

export type AnyPlanId = DiscoveryTier | ServingTier;

const ALL_PLANS: Record<string, PlanDefinition<AnyPlanId>> = {
  ...(DISCOVERY_PLANS as Record<string, PlanDefinition<AnyPlanId>>),
  ...(SERVING_PLANS as Record<string, PlanDefinition<AnyPlanId>>),
};

export function planById(id: string): PlanDefinition<AnyPlanId> | null {
  return ALL_PLANS[id] ?? null;
}

export function isDiscoveryTier(id: string): id is DiscoveryTier {
  return id in DISCOVERY_PLANS;
}

export function isServingTier(id: string): id is ServingTier {
  return id in SERVING_PLANS;
}

export function planForPrice(
  stripePriceId: string,
): { plan: AnyPlanId; interval: BillingInterval } | null {
  for (const [id, plan] of Object.entries(ALL_PLANS)) {
    for (const interval of ["month", "year"] as const) {
      if (plan.prices?.[interval].priceId === stripePriceId) {
        return { plan: id as AnyPlanId, interval };
      }
    }
    if (plan.reduced?.priceId === stripePriceId) {
      return { plan: id as AnyPlanId, interval: "year" };
    }
  }
  return null;
}

export function priceForId(
  stripePriceId: string,
): { plan: PlanDefinition<AnyPlanId>; price: PricePoint } | null {
  for (const plan of Object.values(ALL_PLANS)) {
    for (const interval of ["month", "year"] as const) {
      const price = plan.prices?.[interval];
      if (price?.priceId === stripePriceId) return { plan, price };
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

export function monthlyEquivalent(plan: PlanDefinition<AnyPlanId>): string {
  if (!plan.prices) return "free";
  return formatPrice(Math.round(plan.prices.year.unitAmount / 12));
}

export function annualSavingMonths(plan: PlanDefinition<AnyPlanId>): number {
  if (!plan.prices) return 0;
  const full = plan.prices.month.unitAmount * 12;
  const saved = full - plan.prices.year.unitAmount;
  return Math.round(saved / plan.prices.month.unitAmount);
}
