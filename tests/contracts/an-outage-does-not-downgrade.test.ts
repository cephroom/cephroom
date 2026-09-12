import { describe, expect, it } from "vitest";

import { tierOnRenewal } from "@/lib/stripe/renewal";

/**
 * Not hearing from Stripe is not the same as Stripe saying no.
 *
 * Found while running the subscription lifecycle continuously. Entitlement
 * tracks Stripe exactly — 136 checks across seventeen transitions and all
 * seven statuses, no mismatches — in every case where Stripe *answers*. The
 * hole is the case where it does not:
 *
 *     try { tier = (await entitlementFor(key.sub)).tier; }
 *     catch { tier = "browse"; }
 *
 * A paying subscriber renewing during a Stripe outage was silently demoted to
 * the free plan. Their subscription was fine; nobody was refunded; the
 * platform simply stopped believing in it and issued a key saying so. That is
 * the one direction the money guarantee cares most about — "no window where a
 * paying one loses it" — and it was wide open for as long as any outage
 * lasted.
 *
 * It is reachable on purpose, too, which is what moves it from unlucky to
 * exploitable. Token issuance calls Stripe once per batch, and an insider
 * farming tokens was measured at ~574 calls an hour from a single connection
 * against the same rate limit sign-in and billing share. Exhaust it and every
 * *other* subscriber renewing in that window drops to reader. One hostile
 * member degrades everybody's service without touching them.
 *
 * The two call sites also disagreed, which is usually the tell. `restamp`
 * already did the right thing — leave the existing key alone and let the next
 * renewal sort it out — while `refresh` invented a downgrade. The policy now
 * lives in one function that both use.
 *
 * The trade, stated rather than buried: carrying the current tier forward
 * means a *cancelled* subscriber also keeps their tier for the length of an
 * outage. That is the correct side to err on. Over-serving during our own
 * outage costs nothing anyone can measure; under-serving a paying customer is
 * a lie about what they bought, and the platform collects the same either way.
 */

describe("when Stripe answers, entitlement is exactly what it said", () => {
  it("takes the tier Stripe reports, upward", () => {
    expect(tierOnRenewal({ fromStripe: "sweep", current: "query" })).toBe("sweep");
  });

  it("takes the tier Stripe reports, downward", () => {
    // A real cancellation must still demote. This is the whole point of
    // asking on every renewal.
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
    // Fail-open on the tier they already had, never above it. An outage must
    // not become a way to acquire access nobody sold.
    expect(tierOnRenewal({ fromStripe: null, current: "browse" })).toBe("browse");
  });

  it("does not demote either, which was the bug", () => {
    // The exact regression: a lab subscriber renewing during an outage came
    // back as a free reader.
    expect(tierOnRenewal({ fromStripe: null, current: "sweep" })).not.toBe("browse");
  });

  it("falls back to reader only when there is no current tier to carry", () => {
    // Nothing to preserve and nothing to ask: the honest answer is the
    // smallest one.
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
    // And no longer contains the invented downgrade.
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
    // This path was already right: on failure it sets no cookie at all, so
    // the reader keeps exactly what they had.
    const catchBlock = restamp.slice(restamp.indexOf("} catch"));
    expect(catchBlock).not.toContain("cookies.set");
  });
});
