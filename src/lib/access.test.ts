import { describe, expect, it } from "vitest";

import {
  isEntitling,
  planAllows,
  planFromSubscription,
  strongestPlan,
  type SubscriptionStatus,
} from "./access";

const sub = (status: SubscriptionStatus, plan: "member" | "lab" = "member") => ({
  status,
  plan,
});

describe("isEntitling", () => {
  it.each<[SubscriptionStatus, boolean]>([
    ["active", true],
    ["trialing", true],
    // Stripe is still retrying a declined card. Keeping access here is the
    // deliberate choice - see the note in lib/access.
    ["past_due", true],
    ["unpaid", false],
    ["canceled", false],
    ["incomplete", false],
    ["incomplete_expired", false],
    ["paused", false],
  ])("%s -> %s", (status, expected) => {
    expect(isEntitling(status)).toBe(expected);
  });
});

describe("planFromSubscription", () => {
  it("is free with no subscription", () => {
    expect(planFromSubscription(null)).toBe("free");
    expect(planFromSubscription(undefined)).toBe("free");
  });

  it("grants the plan while the subscription is entitling", () => {
    expect(planFromSubscription(sub("active", "lab"))).toBe("lab");
    expect(planFromSubscription(sub("past_due"))).toBe("member");
  });

  it("drops to free once it is not", () => {
    expect(planFromSubscription(sub("canceled", "lab"))).toBe("free");
    expect(planFromSubscription(sub("unpaid"))).toBe("free");
  });
});

describe("planAllows", () => {
  it("lets anyone read a public column", () => {
    expect(planAllows("free", "public")).toBe(true);
    expect(planAllows("member", "public")).toBe(true);
  });

  it("gates member columns", () => {
    expect(planAllows("free", "member")).toBe(false);
    expect(planAllows("member", "member")).toBe(true);
    expect(planAllows("lab", "member")).toBe(true);
  });

  it("gates lab columns above member", () => {
    expect(planAllows("member", "lab")).toBe(false);
    expect(planAllows("lab", "lab")).toBe(true);
  });
});

describe("strongestPlan", () => {
  it("is free with nothing", () => {
    expect(strongestPlan([])).toBe("free");
  });

  it("picks the highest tier among live subscriptions", () => {
    expect(strongestPlan([sub("active", "member"), sub("active", "lab")])).toBe(
      "lab",
    );
  });

  it("ignores a lapsed higher tier", () => {
    // An upgrade creates a second Stripe subscription; the cancelled Lab row
    // must not keep granting Lab after the Member one takes over.
    expect(
      strongestPlan([sub("canceled", "lab"), sub("active", "member")]),
    ).toBe("member");
  });
});
