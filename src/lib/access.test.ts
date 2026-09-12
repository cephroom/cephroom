import { describe, expect, it } from "vitest";

import {
  governingSubscription,
  isEntitling,
  tierAllows,
  tierFromSubscriptions,
} from "./access";

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

/**
 * Which subscription is the one talking.
 *
 * Found by taking the reduced rate through checkout as a reader who had
 * cancelled a Member subscription earlier. The customer then had two Member
 * subscriptions — one `canceled`, one `active` — and the account page picked
 * the first that matched the tier, which was the dead one. A paying
 * subscriber was shown "Cancelled · This subscription has ended" directly
 * above a live period end date.
 *
 * The rule: among subscriptions at the tier that is actually granting access,
 * one that entitles beats one that does not.
 */
describe("governingSubscription", () => {
  const cancelled = { status: "canceled", tier: "member" as const, id: "dead" };
  const active = { status: "active", tier: "member" as const, id: "live" };
  const lab = { status: "active", tier: "lab" as const, id: "lab" };

  it("prefers a live subscription over a dead one at the same tier", () => {
    expect(governingSubscription([cancelled, active], "member")?.id).toBe(
      "live",
    );
  });

  it("does not depend on the order Stripe listed them in", () => {
    expect(governingSubscription([active, cancelled], "member")?.id).toBe(
      "live",
    );
  });

  it("picks the subscription at the tier that is granting access", () => {
    expect(governingSubscription([active, lab], "lab")?.id).toBe("lab");
  });

  it("falls back to whatever exists when nothing entitles", () => {
    // A reader whose only subscription has lapsed still needs the account
    // page to say something about it, so it is shown rather than hidden.
    expect(governingSubscription([cancelled], "reader")?.id).toBe("dead");
  });

  it("is null when there is nothing at all", () => {
    expect(governingSubscription([], "reader")).toBeNull();
  });

  it("treats past_due as live, because it keeps access", () => {
    const pastDue = { status: "past_due", tier: "member" as const, id: "retry" };
    expect(governingSubscription([cancelled, pastDue], "member")?.id).toBe(
      "retry",
    );
  });
});
