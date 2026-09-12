import { describe, expect, it } from "vitest";

import { tierOnRenewal } from "@/lib/stripe/renewal";


describe("when Stripe answers, entitlement is exactly what it said", () => {
  it("takes the tier Stripe reports, upward", () => {
    expect(tierOnRenewal({ fromStripe: "sweep", current: "query" })).toBe("sweep");
  });

  it("takes the tier Stripe reports, downward", () => {
    expect(tierOnRenewal({ fromStripe: "browse", current: "sweep" })).toBe("browse");
  });

  it("takes reader when Stripe genuinely has no subscription", () => {
    expect(tierOnRenewal({ fromStripe: "browse", current: "browse" })).toBe("browse");
  });
});

describe("when Stripe does not answer, nothing is invented", () => {
  it("keeps a paying subscriber at the tier they hold", () => {
    expect(tierOnRenewal({ fromStripe: null, current: "sweep" })).toBe("sweep");
    expect(tierOnRenewal({ fromStripe: null, current: "query" })).toBe("query");
  });

  it("does not promote anybody during an outage", () => {
    expect(tierOnRenewal({ fromStripe: null, current: "browse" })).toBe("browse");
  });

  it("does not demote either, which was the bug", () => {
    expect(tierOnRenewal({ fromStripe: null, current: "sweep" })).not.toBe("browse");
  });

  it("falls back to reader only when there is no current tier to carry", () => {
    expect(tierOnRenewal({ fromStripe: null, current: null })).toBe("browse");
  });
});

describe("both renewal paths share the policy", () => {
  it("is used by the refresh endpoint", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { ROOT, stripCommentsOnly } = await import("./scan");

    const refresh = stripCommentsOnly(
      readFileSync(
        join(ROOT, "src", "app", "api", "auth", "refresh", "route.ts"),
        "utf8",
      ),
    );
    expect(refresh).toContain("tierOnRenewal");
    expect(refresh).not.toMatch(/catch\s*\{\s*tier\s*=\s*"browse"/);
  });

  it("leaves the key untouched in restamp when Stripe is silent", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { ROOT, stripCommentsOnly } = await import("./scan");

    const restamp = stripCommentsOnly(
      readFileSync(
        join(ROOT, "src", "app", "api", "auth", "restamp", "route.ts"),
        "utf8",
      ),
    );
    const catchBlock = restamp.slice(restamp.indexOf("} catch"));
    expect(catchBlock).not.toContain("cookies.set");
  });
});
