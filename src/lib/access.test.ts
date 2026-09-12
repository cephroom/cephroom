import { describe, expect, it } from "vitest";

import {
  discoveryFromSubscriptions,
  governingSubscription,
  isPaying,
  servingFromSubscriptions,
} from "./access";


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
    const dead = sub({ id: "old", status: "canceled", discovery: "query" });
    const live = sub({ id: "new", status: "active", discovery: "query" });
    expect(
      governingSubscription([dead, live], (s) => s.discovery !== null)?.id,
    ).toBe("new");
  });

  it("falls back to a dead one rather than showing nothing", () => {
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
