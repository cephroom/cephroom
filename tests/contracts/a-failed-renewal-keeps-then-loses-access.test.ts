import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A failed renewal keeps access through the grace period, then loses it -
 * contracts 6 and 7.
 *
 * This is the other half of a-declined-card-grants-nothing. A first payment
 * that never succeeded (incomplete) grants nothing; a renewal that fails AFTER
 * a real payment (past_due) keeps access, deliberately, while Stripe retries -
 * and then, if the retries are exhausted, access ends. That whole arc is the
 * contract-6 boundary: money already taken keeps its reach for a bounded grace,
 * and reach that is no longer paid for goes away. If past_due entitled forever
 * with no way to end it, one payment plus a cancelled card would buy reach from
 * nothing.
 *
 * The simulated counterparty could not produce past_due at all: its transitions
 * were completeCheckout/declineCheckout/recoverPayment/exhaustDunning/
 * advancePeriod, none of which set past_due, so the grace state was unreachable
 * and its recover/exhaust controls (gated on status === "past_due") were dead.
 * The set membership was asserted in a unit test, but the LIFECYCLE was never
 * driven through the counterparty. This drives it.
 */
let scratch: string;
let cwd: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "cephroom-renewal-"));
  writeFileSync(
    join(scratch, ".stripe-simulated.json"),
    JSON.stringify({ customers: {}, subscriptions: {}, sessions: {} }),
  );
  cwd = process.cwd();
  process.chdir(scratch);
  vi.resetModules();
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(scratch, { recursive: true, force: true });
});

async function store() {
  return import("../../simulated-counterparties/stripe/store");
}

async function activeQuery(sub: string): Promise<string> {
  const s = await store();
  const gw = s.simulatedGateway();
  const session = await gw.createCheckoutSession({
    sub,
    customerId: null,
    priceId: "price_local_query_month",
    plan: "query",
    interval: "month",
    successUrl: "http://localhost:3000/api/auth/restamp",
    cancelUrl: "http://localhost:3000/pricing",
  });
  s.completeCheckout(session.id);
  return s.subscriptionsForSubject(sub)[0].id;
}

async function discovery(sub: string): Promise<string> {
  const { entitlementFor } = await import("@/lib/stripe/entitlement");
  return (await entitlementFor(sub)).discovery;
}

describe("the dunning grace period can actually be reached", () => {
  it("moves an active subscription to past_due on a failed renewal", async () => {
    const s = await store();
    const id = await activeQuery("s_grace");
    s.failRenewal(id);
    expect(s.subscriptionsForSubject("s_grace")[0].status).toBe("past_due");
  });

  it("keeps full reach while past_due - the grace after a real payment", async () => {
    const s = await store();
    const id = await activeQuery("s_grace2");
    expect(await discovery("s_grace2")).toBe("query");
    s.failRenewal(id);
    expect(
      await discovery("s_grace2"),
      "A renewal that failed after a real payment keeps access during Stripe's retries.",
    ).toBe("query");
  });
});

describe("the grace period ends one way or the other", () => {
  it("a successful retry restores the subscription to active", async () => {
    const s = await store();
    const id = await activeQuery("s_recover");
    s.failRenewal(id);
    s.recoverPayment(id);
    expect(s.subscriptionsForSubject("s_recover")[0].status).toBe("active");
    expect(await discovery("s_recover")).toBe("query");
  });

  it("exhausted retries end access - reach that is no longer paid for goes away", async () => {
    const s = await store();
    const id = await activeQuery("s_exhaust");
    s.failRenewal(id);
    s.exhaustDunning(id);
    expect(s.subscriptionsForSubject("s_exhaust")[0].status).toBe("canceled");
    expect(
      await discovery("s_exhaust"),
      "Once the grace runs out, the reach must be gone - otherwise one payment buys reach forever.",
    ).toBe("browse");
  });
});

describe("a failed renewal is not a way to revive a dead subscription", () => {
  it("does not move a canceled subscription back into an entitling state", async () => {
    const s = await store();
    const id = await activeQuery("s_dead");
    s.failRenewal(id);
    s.exhaustDunning(id); // canceled
    s.failRenewal(id); // must not resurrect
    const status = s.subscriptionsForSubject("s_dead")[0].status;
    const { isPaying } = await import("@/lib/access");
    expect(
      isPaying(status),
      `failRenewal moved a canceled subscription to "${status}", which entitles. A dead subscription must stay dead.`,
    ).toBe(false);
  });

  it("recoverPayment does not revive a canceled subscription", async () => {
    // guard() checks ownership but not status, so a crafted POST of
    // recoverPaymentAction with the caller's own canceled subscription id must
    // not conjure a live subscription - that is reach from nothing.
    const s = await store();
    const id = await activeQuery("s_revive");
    s.failRenewal(id);
    s.exhaustDunning(id); // canceled
    s.recoverPayment(id); // must not bring a dead subscription back to life
    const status = s.subscriptionsForSubject("s_revive")[0].status;
    const { isPaying } = await import("@/lib/access");
    expect(
      isPaying(status),
      `recoverPayment revived a canceled subscription to "${status}". Recovery is for a dunning subscription, not a dead one.`,
    ).toBe(false);
    expect(await discovery("s_revive")).toBe("browse");
  });
});
