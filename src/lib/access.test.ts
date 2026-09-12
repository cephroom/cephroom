import { describe, expect, it } from "vitest";

import {
  discoveryFromSubscriptions,
  governingSubscription,
  isPaying,
  servingFromSubscriptions,
} from "./access";

/**
 * What a subscription means, now that there are two of them.
 *
 * This file used to test `tierAllows` — whether a consumer's tier let them
 * read somebody else's column. That question is gone, and so is the function:
 * a consumer's plan buys reach across the platform's own discovery, a
 * contributor's buys room in the platform's own listing, and neither is
 * visible to the other side.
 *
 * What survives unchanged is the judgement about Stripe statuses, which was
 * always the interesting part, and the rule for picking which of several
 * subscriptions to describe.
 */

const sub = (
  fields: Partial<{
    id: string;
    status: string;
    discovery: "browse" | "query" | "sweep" | null;
    serving: "desk" | "shelf" | "stacks" | null;
  }> = {},
) => ({
  id: fields.id ?? "sub_1",
  status: fields.status ?? "active",
  discovery: fields.discovery ?? null,
  serving: fields.serving ?? null,
});

describe("which statuses count as paying", () => {
  it("counts active and trialing", () => {
    expect(isPaying("active")).toBe(true);
    expect(isPaying("trialing")).toBe(true);
  });

  it("counts past_due, because Stripe is still trying", () => {
    // A failed card is not a decision. Cutting somebody off mid-dunning
    // punishes them for their bank's fraud heuristics; Stripe retries for
    // days and most of these recover.
    expect(isPaying("past_due")).toBe(true);
  });

  it("does not count unpaid, where the retries ran out", () => {
    expect(isPaying("unpaid")).toBe(false);
  });

  it("does not count anything else", () => {
    for (const status of ["canceled", "incomplete", "incomplete_expired", "paused"]) {
      expect(isPaying(status), status).toBe(false);
    }
  });
});

describe("the discovery plan a customer is on", () => {
  it("is the free one when they have no subscription", () => {
    expect(discoveryFromSubscriptions([])).toBe("browse");
  });

  it("is the strongest live one when they have several", () => {
    expect(
      discoveryFromSubscriptions([
        sub({ discovery: "query" }),
        sub({ discovery: "sweep" }),
      ]),
    ).toBe("sweep");
  });

  it("ignores one that is not being paid for", () => {
    expect(
      discoveryFromSubscriptions([
        sub({ discovery: "sweep", status: "canceled" }),
        sub({ discovery: "query" }),
      ]),
    ).toBe("query");
  });

  it("ignores a serving subscription entirely", () => {
    // The whole point of the split. A contributor on Stacks browses like
    // anybody else unless they also bought discovery.
    expect(discoveryFromSubscriptions([sub({ serving: "stacks" })])).toBe("browse");
  });
});

describe("the serving plan a contributor is on", () => {
  it("is the free one when they have no subscription", () => {
    expect(servingFromSubscriptions([])).toBe("desk");
  });

  it("is the strongest live one", () => {
    expect(
      servingFromSubscriptions([sub({ serving: "shelf" }), sub({ serving: "stacks" })]),
    ).toBe("stacks");
  });

  it("ignores a discovery subscription entirely", () => {
    // The mirror of the above, and the reason both are tested: a consumer on
    // Sweep gets no extra room to serve, because those are different products.
    expect(servingFromSubscriptions([sub({ discovery: "sweep" })])).toBe("desk");
  });

  it("falls back to free when the only serving plan lapsed", () => {
    expect(
      servingFromSubscriptions([sub({ serving: "stacks", status: "unpaid" })]),
    ).toBe("desk");
  });
});

describe("which subscription to describe on the account page", () => {
  it("prefers a live one over a dead one", () => {
    // A customer who resubscribed after cancelling holds both. Describing the
    // dead one tells a paying customer their subscription has ended.
    const dead = sub({ id: "old", status: "canceled", discovery: "query" });
    const live = sub({ id: "new", status: "active", discovery: "query" });
    expect(
      governingSubscription([dead, live], (s) => s.discovery !== null)?.id,
    ).toBe("new");
  });

  it("falls back to a dead one rather than showing nothing", () => {
    // Somebody who cancelled should still see what they had, and when it ends.
    const dead = sub({ id: "old", status: "canceled", discovery: "query" });
    expect(
      governingSubscription([dead], (s) => s.discovery !== null)?.id,
    ).toBe("old");
  });

  it("returns null when nothing matches", () => {
    expect(
      governingSubscription([sub({ serving: "shelf" })], (s) => s.discovery !== null),
    ).toBeNull();
  });

  it("never crosses the two catalogues", () => {
    const serving = sub({ id: "serve", serving: "shelf" });
    const discovery = sub({ id: "discover", discovery: "query" });
    expect(
      governingSubscription([serving, discovery], (s) => s.serving !== null)?.id,
    ).toBe("serve");
    expect(
      governingSubscription([serving, discovery], (s) => s.discovery !== null)?.id,
    ).toBe("discover");
  });
});
