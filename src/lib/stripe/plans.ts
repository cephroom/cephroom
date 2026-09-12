/**
 * Two subscriptions, unrelated to each other.
 *
 * The old catalogue sold one thing: a consumer tier that a contributor's node
 * was expected to honour. The consumer paid us; the contributor did the work
 * and received nothing. It was a promise somebody else had to keep, with no
 * mechanism to make them keep it and no reason to want to — a contributor who
 * noticed would rationally ignore the tier, or serve subscribers worse to
 * push them towards paying directly.
 *
 * Each subscription now buys something the platform itself provides, and
 * neither obliges the other side to do anything:
 *
 *   - **Discovery**, for consumers. Content lives on other people's machines,
 *     but finding it is ours. Deeper queries, more results, higher
 *     concurrency, the API.
 *   - **Serving capacity**, for contributors. How much may be announced and
 *     listed at once. The fair-share mechanism that exists because one
 *     contributor announced five hundred items and took 97% of the page is
 *     the same mechanism; this states it as a plan rather than only as an
 *     abuse control.
 *
 * Serving itself is free, and that has to stay unmistakable — see
 * tests/contracts/serving-is-free.test.ts, which exists because a prospective
 * contributor who concludes publishing costs money simply leaves.
 */

export type BillingInterval = "month" | "year";

/** What a consumer's plan buys: reach across the live network. */
export type DiscoveryTier = "browse" | "query" | "sweep";

/** What a contributor's plan buys: room in the listing. */
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
  /** Free plans have no prices. They are still plans. */
  prices?: Record<BillingInterval, PricePoint>;
  reduced?: PricePoint & { label: string; note: string };
}

function priceId(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

/* ------------------------------------------------------------------ *
 * Consumer: discovery
 * ------------------------------------------------------------------ */

/**
 * How many results a listing returns, by tier.
 *
 * This is the whole of what a discovery plan buys, and it is deliberately a
 * quantity rather than a capability: there is no query a paying consumer can
 * run that a free one cannot, only further. Nothing here reaches into a
 * contributor's machine.
 */
export const DISCOVERY_REACH: Record<DiscoveryTier, number> = {
  browse: 50,
  query: 200,
  sweep: 1000,
};

/** Concurrent node fetches a client is cleared to run while crawling. */
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

/* ------------------------------------------------------------------ *
 * Contributor: serving capacity
 * ------------------------------------------------------------------ */

/**
 * How many items a contributor may have listed at once, by tier.
 *
 * The free number is deliberately enough to publish with. A working
 * researcher serving their own columns and the datasets behind them is well
 * inside it, and will never see this limit. It is volume that is paid for,
 * not publishing.
 */
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
      "Ten times as much of it eligible for any given listing",
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
