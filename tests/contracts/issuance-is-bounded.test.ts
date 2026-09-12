import { describe, expect, it } from "vitest";

import { IssuanceGate, ISSUANCE_CONCURRENCY } from "@/lib/tokens/issuance-gate";

/**
 * The platform's cost per subscriber has a ceiling.
 *
 * Found with a hostile consumer who is a genuine paying member. Token
 * issuance had no limit of any kind beyond the twelve-per-batch cap:
 *
 *   2 batches / 24 tokens in 13.6s, refused: 0
 *   sustained: 6,375 tokens/hour from ONE subscriber
 *   each redeemed with no cookie at all -> a 120s member key
 *   used to read a MEMBER column: entitled=true
 *
 * And each batch is expensive in a way nothing was accounting for: twelve
 * blind RSA-2048 signatures plus a Stripe call, measured at 6.3 seconds of
 * platform time. Four concurrent batches took 25.6 seconds — they serialise,
 * because the bottleneck is the platform's own CPU. One subscriber can
 * occupy the signing path indefinitely, and spend 574 Stripe calls an hour
 * doing it, which competes with sign-in and billing for the same rate limit.
 *
 * What this gate does and does not fix, stated plainly, because the
 * difference matters:
 *
 *   - It bounds the *platform's* exposure: CPU and Stripe calls per unit
 *     time are now capped no matter who is asking or how many of them there
 *     are. Adversarial load degrades into refusals instead of exhaustion.
 *   - It does NOT bound how much anonymous access one subscription yields.
 *     A patient farmer simply farms slower. Closing that would need a
 *     per-subscriber counter (person-linkable state at rest, Contract 1), a
 *     consumable balance (Contract 10 — a tier "is not consumed by use"), or
 *     linking issuance to redemption (Contract 7, the whole point of Layer
 *     1). All three are worse than the thing they would fix.
 *
 * So the ceiling is identity-free on purpose. It counts work in flight, not
 * people, and it cannot tell an adversary from a subscriber — which is
 * exactly the property that keeps it legal under Contract 1.
 */

describe("the issuance gate bounds work, not people", () => {
  it("admits up to its capacity", () => {
    const gate = new IssuanceGate(2);
    expect(gate.tryEnter()).toBe(true);
    expect(gate.tryEnter()).toBe(true);
    expect(gate.inFlight()).toBe(2);
  });

  it("refuses beyond it", () => {
    const gate = new IssuanceGate(2);
    gate.tryEnter();
    gate.tryEnter();
    expect(gate.tryEnter()).toBe(false);
    expect(gate.inFlight()).toBe(2);
  });

  it("admits again once work finishes", () => {
    const gate = new IssuanceGate(1);
    expect(gate.tryEnter()).toBe(true);
    expect(gate.tryEnter()).toBe(false);
    gate.leave();
    expect(gate.tryEnter()).toBe(true);
  });

  it("does not leak a slot when the work throws", async () => {
    // The failure that turns a ceiling into an outage: a slot taken and never
    // returned, so the endpoint refuses everybody forever after one error.
    const gate = new IssuanceGate(1);
    await expect(
      gate.run(async () => {
        throw new Error("signing blew up");
      }),
    ).rejects.toThrow("signing blew up");
    expect(gate.inFlight()).toBe(0);
    expect(gate.tryEnter()).toBe(true);
  });

  it("releases the slot on success too", async () => {
    const gate = new IssuanceGate(1);
    expect(await gate.run(async () => "signed")).toBe("signed");
    expect(gate.inFlight()).toBe(0);
  });

  it("never drops below zero, however unbalanced the calls", () => {
    const gate = new IssuanceGate(2);
    gate.leave();
    gate.leave();
    expect(gate.inFlight()).toBe(0);
    expect(gate.tryEnter()).toBe(true);
  });

  it("counts work and knows nothing about who asked", () => {
    // The property that keeps this compatible with Contract 1. A gate that
    // knew subjects would be a per-person rate limiter, which is a per-person
    // activity record kept in memory and consulted on every request.
    const source = IssuanceGate.toString();
    expect(source).not.toMatch(/sub|subject|customer|tier|ip|Map|Set/i);
    expect(Object.getOwnPropertyNames(IssuanceGate.prototype).sort()).toEqual(
      ["constructor", "inFlight", "leave", "run", "tryEnter"].sort(),
    );
  });

  it("leaves room for an honest subscriber topping up", () => {
    // Twelve tokens is a while's reading, so honest issuance is rare and
    // bursty. The ceiling has to be above one.
    expect(ISSUANCE_CONCURRENCY).toBeGreaterThanOrEqual(2);
    // And low enough to actually bound the signing path, which measured
    // ~6.3s of platform time per batch.
    expect(ISSUANCE_CONCURRENCY).toBeLessThanOrEqual(4);
  });
});

describe("a stockpile cannot be built far in advance", () => {
  it("keeps tokens usable for only the live epochs", async () => {
    // The bound that already existed and was never asserted: a token verifies
    // only against a key still in the rotation window, so farming cannot
    // accumulate a year's supply — a farmer has to keep farming, which is
    // what makes the cost ceiling above worth having.
    const { liveEpochs, LIVE_EPOCHS, EPOCH_SECONDS } = await import(
      "@/lib/tokens/issuer"
    );
    const now = Date.now();
    expect(liveEpochs(now)).toHaveLength(LIVE_EPOCHS);

    // A token from two epochs ago is outside the window.
    const old = now - (LIVE_EPOCHS + 1) * EPOCH_SECONDS * 1000;
    const overlap = liveEpochs(old).filter((e) => liveEpochs(now).includes(e));
    expect(overlap).toEqual([]);
  });

  it("bounds the useful life of anything farmed", async () => {
    const { LIVE_EPOCHS, EPOCH_SECONDS } = await import("@/lib/tokens/issuer");
    const usefulHours = (LIVE_EPOCHS * EPOCH_SECONDS) / 3600;
    expect(usefulHours).toBeLessThanOrEqual(2);
  });
});
