import { describe, expect, it } from "vitest";

import { isEntitling, tierAllows, tierFromSubscriptions } from "./access";

const sub = (status: string, tier: "member" | "lab" = "member") => ({
  status,
  tier,
});

describe("isEntitling", () => {
  it.each<[string, boolean]>([
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

describe("tierFromSubscriptions", () => {
  it("is reader with nothing", () => {
    expect(tierFromSubscriptions([])).toBe("reader");
  });

  it("grants the tier while the subscription is entitling", () => {
    expect(tierFromSubscriptions([sub("active", "lab")])).toBe("lab");
    expect(tierFromSubscriptions([sub("past_due")])).toBe("member");
  });

  it("drops to reader once it is not", () => {
    expect(tierFromSubscriptions([sub("canceled", "lab")])).toBe("reader");
    expect(tierFromSubscriptions([sub("unpaid")])).toBe("reader");
  });

  it("picks the highest live tier", () => {
    expect(
      tierFromSubscriptions([sub("active", "member"), sub("active", "lab")]),
    ).toBe("lab");
  });

  it("ignores a lapsed higher tier", () => {
    // Stripe keeps the cancelled row. An upgrade that left one behind must
    // not keep granting the old tier.
    expect(
      tierFromSubscriptions([sub("canceled", "lab"), sub("active", "member")]),
    ).toBe("member");
  });
});

describe("tierAllows", () => {
  it("lets anyone read a public column", () => {
    expect(tierAllows("reader", "public")).toBe(true);
    expect(tierAllows("member", "public")).toBe(true);
  });

  it("gates member columns", () => {
    expect(tierAllows("reader", "member")).toBe(false);
    expect(tierAllows("member", "member")).toBe(true);
    expect(tierAllows("lab", "member")).toBe(true);
  });

  it("gates lab columns above member", () => {
    expect(tierAllows("member", "lab")).toBe(false);
    expect(tierAllows("lab", "lab")).toBe(true);
  });
});
