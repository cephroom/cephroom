import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A card that never succeeded grants no reach - contracts 6 and 7.
 *
 * Contract 6 is "never create money from nothing", and its billing form is:
 * entitlement must correspond to money actually taken. A subscription whose
 * very first payment was declined has taken nothing, so it must grant nothing.
 *
 * Stripe models this exactly: a failed initial payment leaves the subscription
 * `incomplete` (no access) - it becomes `active` only after the first payment
 * succeeds, and only a LATER failed renewal becomes `past_due`, where a grace
 * period is a deliberate choice (see an-outage-does-not-downgrade). The
 * simulated counterparty had conflated the two, settling a declined card
 * straight to `past_due`, which entitles. Clicking "Simulate a declined card"
 * then handed out Query reach for free.
 */
let scratch: string;
let cwd: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "cephroom-decline-"));
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

async function checkoutFor(sub: string, priceId: string) {
  const gw = (await store()).simulatedGateway();
  const session = await gw.createCheckoutSession({
    sub,
    customerId: null,
    priceId,
    plan: "query",
    interval: "month",
    successUrl: "http://localhost:3000/api/auth/restamp",
    cancelUrl: "http://localhost:3000/pricing",
  });
  return session.id;
}

describe("a declined initial checkout entitles nothing", () => {
  it("leaves the subscription in a non-entitling state", async () => {
    const s = await store();
    const id = await checkoutFor("s_decliner", "price_local_query_month");
    s.declineCheckout(id);

    const { isPaying } = await import("@/lib/access");
    const subs = s.subscriptionsForSubject("s_decliner");
    expect(subs.length).toBeGreaterThan(0);
    for (const sub of subs) {
      expect(
        isPaying(sub.status),
        `A declined card produced status "${sub.status}", which entitles. A first payment that never succeeded must grant nothing.`,
      ).toBe(false);
    }
  });

  it("yields Browse discovery, not Query, after a decline", async () => {
    const s = await store();
    const id = await checkoutFor("s_decliner2", "price_local_query_month");
    s.declineCheckout(id);

    const { entitlementFor } = await import("@/lib/stripe/entitlement");
    const ent = await entitlementFor("s_decliner2");
    expect(ent.discovery).toBe("browse");
    expect(ent.serving).toBe("desk");
  });

  it("uses the status Stripe uses for a failed first payment", async () => {
    const s = await store();
    const id = await checkoutFor("s_decliner3", "price_local_query_month");
    s.declineCheckout(id);
    const sub = s.subscriptionsForSubject("s_decliner3")[0];
    expect(sub.status).toBe("incomplete");
  });
});

describe("a successful checkout still entitles", () => {
  it("grants the plan when the card is accepted", async () => {
    const s = await store();
    const id = await checkoutFor("s_payer", "price_local_query_month");
    s.completeCheckout(id);

    const { entitlementFor } = await import("@/lib/stripe/entitlement");
    expect((await entitlementFor("s_payer")).discovery).toBe("query");
  });
});

describe("a failed renewal keeps access, which is a different case", () => {
  it("still entitles past_due, because that is a grace period after a real payment", async () => {
    const { ENTITLING_STATUSES } = await import("@/lib/access");
    expect(
      ENTITLING_STATUSES.has("past_due"),
      "past_due is a renewal that failed after a prior success - keeping access there is deliberate. Only the initial-decline path was wrong.",
    ).toBe(true);
    expect(ENTITLING_STATUSES.has("incomplete")).toBe(false);
  });
});
