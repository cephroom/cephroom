import { generateKeyPair, exportSPKI, importSPKI } from "jose";
import { describe, expect, it } from "vitest";

import {
  canonicalBytes,
  hashReceipt,
  nextBody,
  verifyChain,
  type Receipt,
  type ReceiptBody,
} from "@/lib/earnings/receipt";
import {
  planSettlement,
  settle,
  type Claim,
  type GrantFacts,
  type SettlementStep,
} from "@/lib/earnings/settlement";
import { CONTRIBUTOR_SHARE, payoutMinor, unitsForAmount } from "@/lib/earnings/units";

/**
 * The four properties the earnings design has to hold, tested as properties
 * rather than as happy paths.
 *
 * A happy-path test here would pass against a design that pays before it
 * writes, that lets a shared key mint money, or that believes a chain somebody
 * edited. So each of these is written as "the thing that must never happen",
 * and several watch the *order of effects* rather than the result, because a
 * refactor that inverted the sequence would still produce correct-looking
 * output whenever nothing failed.
 */

/* ------------------------------------------------------------------ *
 * Signing helpers — real Ed25519, not a stub
 * ------------------------------------------------------------------ */

async function party() {
  const { privateKey, publicKey } = await generateKeyPair("Ed25519", {
    extractable: true,
  });
  return { privateKey, publicKey, spki: await exportSPKI(publicKey) };
}

async function signWith(key: CryptoKey, message: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "Ed25519",
    key,
    new TextEncoder().encode(message),
  );
  return Buffer.from(signature).toString("base64url");
}

const verify = async (
  publicKeySpki: string,
  signature: string,
  message: string,
): Promise<boolean> => {
  try {
    const key = (await importSPKI(publicKeySpki, "Ed25519")) as CryptoKey;
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      Uint8Array.from(Buffer.from(signature, "base64url")),
      new TextEncoder().encode(message),
    );
  } catch {
    return false;
  }
};

async function dualSign(
  body: ReceiptBody,
  consumer: CryptoKey,
  contributor: CryptoKey,
): Promise<Receipt> {
  const message = canonicalBytes(body);
  return {
    ...body,
    consumerSig: await signWith(consumer, message),
    contributorSig: await signWith(contributor, message),
  };
}

/** Builds a valid chain of `steps` receipts, `delta` units each. */
async function buildChain(options: {
  consumer: Awaited<ReturnType<typeof party>>;
  contributor: Awaited<ReturnType<typeof party>>;
  aid: string;
  sid: string;
  steps: number;
  delta?: number;
}): Promise<Receipt[]> {
  const shape = {
    aid: options.aid,
    sid: options.sid,
    consumerKey: options.consumer.spki,
    contributorKey: options.contributor.spki,
    contributorSub: "s_contributor",
    itemId: "a-column",
  };

  const chain: Receipt[] = [];
  let previous: Receipt | null = null;
  for (let index = 0; index < options.steps; index += 1) {
    const body = await nextBody(previous, options.delta ?? 10, shape);
    const receipt = await dualSign(
      body,
      options.consumer.privateKey,
      options.contributor.privateKey,
    );
    chain.push(receipt);
    previous = receipt;
  }
  return chain;
}

/* ------------------------------------------------------------------ *
 * 1. Write before pay
 * ------------------------------------------------------------------ */

describe("settlement writes before it pays", () => {
  const plan = {
    contributorSub: "s_contributor",
    units: 100,
    amountMinor: payoutMinor(100),
    newSettledThroughPeriod: 7,
    draws: [{ aid: "a1", sid: "s1", units: 100 }],
    rejected: [],
  };

  it("advances the counter, writes the key, then pays — in that order", async () => {
    const steps: SettlementStep[] = [];
    const outcome = await settle(plan, {
      advanceSpent: async () => void steps.push("advance-spent"),
      writeKey: async () => {
        steps.push("write-key");
        return "new-key";
      },
      pay: async () => void steps.push("pay"),
    });

    // The assertion that matters. If somebody reorders these, this is the
    // test that goes red — and it goes red on the happy path, which a
    // result-only assertion would not.
    expect(steps).toEqual(["advance-spent", "write-key", "pay"]);
    expect(outcome.steps).toEqual(["advance-spent", "write-key", "pay"]);
    expect(outcome.paid).toBe(true);
  });

  it("never pays when the key write fails", async () => {
    let paid = false;
    const outcome = await settle(plan, {
      advanceSpent: async () => {},
      writeKey: async () => {
        throw new Error("disk full");
      },
      pay: async () => void (paid = true),
    });

    // Money out with no record is the failure that makes total paid exceed
    // total received. It must be structurally impossible, not merely unlikely.
    expect(paid).toBe(false);
    expect(outcome.paid).toBe(false);
    expect(outcome.steps).not.toContain("pay");
    expect(outcome.error).toBe("disk full");
  });

  it("never pays when the spent counter cannot be advanced", async () => {
    let paid = false;
    const outcome = await settle(plan, {
      advanceSpent: async () => {
        throw new Error("counter unavailable");
      },
      writeKey: async () => "new-key",
      pay: async () => void (paid = true),
    });

    expect(paid).toBe(false);
    expect(outcome.steps).toEqual([]);
  });

  it("fails in the direction of paying less, never more", async () => {
    // The key was written and the payment failed. The contributor is short and
    // can see it; nobody has been paid twice. The inverse ordering would have
    // paid and forgotten, which is unrecoverable.
    const outcome = await settle(plan, {
      advanceSpent: async () => {},
      writeKey: async () => "new-key",
      pay: async () => {
        throw new Error("stripe down");
      },
    });

    expect(outcome.key).toBe("new-key");
    expect(outcome.paid).toBe(false);
    expect(outcome.steps).toEqual(["advance-spent", "write-key"]);
  });

  it("still advances the watermark when nothing is payable", async () => {
    // Otherwise a contributor who served nothing accumulates an ever-widening
    // window of periods they could re-present later.
    const outcome = await settle(
      { ...plan, units: 0, amountMinor: 0, draws: [] },
      {
        advanceSpent: async () => {},
        writeKey: async () => "new-key",
        pay: async () => {
          throw new Error("should not be called");
        },
      },
    );

    expect(outcome.steps).toEqual(["advance-spent", "write-key"]);
    expect(outcome.key).toBe("new-key");
    expect(outcome.error).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 2. Payable can never exceed what was bought
 * ------------------------------------------------------------------ */

describe("total payable never exceeds total received", () => {
  const grant: GrantFacts = { aid: "a1", units: 100, period: 7 };
  const grants = new Map([["a1", grant]]);

  const claim = (sid: string, units: number): Claim => ({
    contributorSub: "s_contributor",
    aid: "a1",
    sid,
    period: 7,
    units,
  });

  it("caps a single claim at the grant", () => {
    const plan = planSettlement({
      contributorSub: "s_contributor",
      settledThroughPeriod: 6,
      currentPeriod: 7,
      claims: [claim("s1", 500)],
      grants,
      alreadySpent: () => 0,
    });
    expect(plan.units).toBe(100);
  });

  it("caps two contributors drawing on one shared grant, together", () => {
    // The shared-key case. Both hold genuine dual-signed receipts; the grant
    // bought 100 units; between them they can be paid for 100 and no more.
    const first = planSettlement({
      contributorSub: "s_contributor",
      settledThroughPeriod: 6,
      currentPeriod: 7,
      claims: [claim("s1", 80)],
      grants,
      alreadySpent: () => 0,
    });
    expect(first.units).toBe(80);

    const second = planSettlement({
      contributorSub: "s_contributor",
      settledThroughPeriod: 6,
      currentPeriod: 7,
      claims: [claim("s2", 80)],
      grants,
      alreadySpent: () => 80, // the counter, advanced by the first settlement
    });
    expect(second.units).toBe(20);
    expect(first.units + second.units).toBe(grant.units);
  });

  it("pays nothing once a grant is exhausted", () => {
    const plan = planSettlement({
      contributorSub: "s_contributor",
      settledThroughPeriod: 6,
      currentPeriod: 7,
      claims: [claim("s9", 50)],
      grants,
      alreadySpent: () => 100,
    });
    expect(plan.units).toBe(0);
    expect(plan.rejected[0].reason).toBe("allowance-exhausted");
  });

  it("holds the money invariant across arbitrary concurrent sessions", () => {
    // Twenty sessions, each claiming the whole allowance. The sum paid is the
    // allowance. This is the property, not a scenario.
    const claims = Array.from({ length: 20 }, (_, index) =>
      claim(`s${index}`, 100),
    );
    const plan = planSettlement({
      contributorSub: "s_contributor",
      settledThroughPeriod: 6,
      currentPeriod: 7,
      claims,
      grants,
      alreadySpent: () => 0,
    });

    expect(plan.units).toBe(100);
    expect(plan.amountMinor).toBeLessThanOrEqual(
      payoutMinor(grant.units),
    );
  });

  it("never grants more units than the money bought", () => {
    for (const amount of [900, 2900, 9000, 29000, 3600]) {
      const units = unitsForAmount(amount);
      // Payout for every unit sold cannot exceed the contributor share.
      expect(payoutMinor(units)).toBeLessThanOrEqual(amount * CONTRIBUTOR_SHARE);
    }
  });

  it("rounds units down, never up", () => {
    // Rounding in the reader's favour would issue units nobody paid for, which
    // is the one direction that breaks the invariant.
    expect(unitsForAmount(1)).toBe(Math.floor((1 * CONTRIBUTOR_SHARE) / 0.1));
    expect(unitsForAmount(0)).toBe(0);
    expect(unitsForAmount(-500)).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * 3. No balance on the platform between settlements
 * ------------------------------------------------------------------ */

describe("the platform holds no balance between settlements", () => {
  it("derives everything payable from presented receipts and a watermark", () => {
    // `planSettlement` takes claims, grants and a spent counter. There is no
    // parameter for "what we owe this contributor", because nothing anywhere
    // accrues one: the record is the receipts, held by the parties.
    const source = planSettlement.toString();
    expect(source).not.toMatch(/balance|owed|pending|accru/i);
  });

  it("refuses a period the contributor's key says is already settled", () => {
    const plan = planSettlement({
      contributorSub: "s_contributor",
      settledThroughPeriod: 7,
      currentPeriod: 8,
      claims: [
        {
          contributorSub: "s_contributor",
          aid: "a1",
          sid: "s1",
          period: 7,
          units: 50,
        },
      ],
      grants: new Map([["a1", { aid: "a1", units: 100, period: 7 }]]),
      alreadySpent: () => 0,
    });

    // The watermark lives in the contributor's own key. Re-presenting a paid
    // period against a newer key proves nothing.
    expect(plan.units).toBe(0);
    expect(plan.rejected[0].reason).toBe("period-already-settled");
  });

  it("refuses a period that has not closed yet", () => {
    const plan = planSettlement({
      contributorSub: "s_contributor",
      settledThroughPeriod: 6,
      currentPeriod: 7,
      claims: [
        {
          contributorSub: "s_contributor",
          aid: "a1",
          sid: "s1",
          period: 9,
          units: 50,
        },
      ],
      grants: new Map([["a1", { aid: "a1", units: 100, period: 9 }]]),
      alreadySpent: () => 0,
    });
    expect(plan.units).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * 4. A tampered record fails closed, on both sides
 * ------------------------------------------------------------------ */

describe("a tampered usage record fails closed", () => {
  const expected = (consumerSpki: string) => ({
    aid: "a1",
    sid: "s1",
    consumerKey: consumerSpki,
  });

  it("accepts an honest chain and reports what it proves", async () => {
    const consumer = await party();
    const contributor = await party();
    const chain = await buildChain({
      consumer,
      contributor,
      aid: "a1",
      sid: "s1",
      steps: 4,
    });

    const result = await verifyChain(chain, expected(consumer.spki), verify);
    expect(result.ok).toBe(true);
    expect(result.units).toBe(40);
  });

  it("refuses a contributor who inflates the figure", async () => {
    const consumer = await party();
    const contributor = await party();
    const chain = await buildChain({
      consumer,
      contributor,
      aid: "a1",
      sid: "s1",
      steps: 2,
    });

    // The contributor edits the number and re-signs their half. They cannot
    // re-sign the consumer's half, which is the whole defence.
    const tampered = [...chain];
    const body = { ...tampered[1], cumulativeUnits: 9_999 };
    tampered[1] = {
      ...body,
      contributorSig: await signWith(
        contributor.privateKey,
        canonicalBytes(body),
      ),
    };

    const result = await verifyChain(tampered, expected(consumer.spki), verify);
    expect(result.ok).toBe(false);
    expect(result.units).toBe(0);
    expect(result.problems.map((p) => p.reason)).toContain(
      "bad-consumer-signature",
    );
  });

  it("refuses a consumer who deflates the figure", async () => {
    const consumer = await party();
    const contributor = await party();
    const chain = await buildChain({
      consumer,
      contributor,
      aid: "a1",
      sid: "s1",
      steps: 2,
    });

    const body = { ...chain[1], cumulativeUnits: 1 };
    const tampered = [
      chain[0],
      {
        ...body,
        consumerSig: await signWith(consumer.privateKey, canonicalBytes(body)),
      },
    ];

    const result = await verifyChain(tampered, expected(consumer.spki), verify);
    expect(result.ok).toBe(false);
    expect(result.units).toBe(0);
  });

  it("refuses a chain with a link removed", async () => {
    const consumer = await party();
    const contributor = await party();
    const chain = await buildChain({
      consumer,
      contributor,
      aid: "a1",
      sid: "s1",
      steps: 4,
    });

    const withGap = [chain[0], chain[2], chain[3]];
    const result = await verifyChain(withGap, expected(consumer.spki), verify);
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => p.reason)).toContain("broken-link");
  });

  it("believes none of a chain that was edited, not the part that still parses", async () => {
    // Salvaging the valid prefix would reward an editor for editing late.
    const consumer = await party();
    const contributor = await party();
    const chain = await buildChain({
      consumer,
      contributor,
      aid: "a1",
      sid: "s1",
      steps: 5,
    });

    const body = { ...chain[4], cumulativeUnits: 9_999 };
    const tampered = [
      ...chain.slice(0, 4),
      {
        ...body,
        contributorSig: await signWith(
          contributor.privateKey,
          canonicalBytes(body),
        ),
      },
    ];

    const result = await verifyChain(tampered, expected(consumer.spki), verify);
    expect(result.units).toBe(0);
  });

  it("refuses a receipt replayed from another session", async () => {
    const consumer = await party();
    const contributor = await party();
    const fromElsewhere = await buildChain({
      consumer,
      contributor,
      aid: "a1",
      sid: "OTHER",
      steps: 1,
    });

    const result = await verifyChain(
      fromElsewhere,
      expected(consumer.spki),
      verify,
    );
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => p.reason)).toContain("session-mismatch");
  });

  it("refuses a receipt replayed from another grant", async () => {
    const consumer = await party();
    const contributor = await party();
    const chain = await buildChain({
      consumer,
      contributor,
      aid: "OTHER",
      sid: "s1",
      steps: 1,
    });

    const result = await verifyChain(chain, expected(consumer.spki), verify);
    expect(result.problems.map((p) => p.reason)).toContain("grant-mismatch");
  });

  it("refuses a non-monotonic chain", async () => {
    const consumer = await party();
    const contributor = await party();
    const first = await buildChain({
      consumer,
      contributor,
      aid: "a1",
      sid: "s1",
      steps: 1,
    });

    const shape = {
      aid: "a1",
      sid: "s1",
      consumerKey: consumer.spki,
      contributorKey: contributor.spki,
      contributorSub: "s_contributor",
      itemId: "a-column",
    };
    const body: ReceiptBody = {
      ...shape,
      seq: 1,
      prev: await hashReceipt(first[0]),
      cumulativeUnits: 1,
    };
    const receipt = await dualSign(
      body,
      consumer.privateKey,
      contributor.privateKey,
    );

    const result = await verifyChain(
      [first[0], receipt],
      expected(consumer.spki),
      verify,
    );
    expect(result.problems.map((p) => p.reason)).toContain("non-monotonic");
  });

  it("refuses a contributor serving themselves", async () => {
    const both = await party();
    const shape = {
      aid: "a1",
      sid: "s1",
      consumerKey: both.spki,
      contributorKey: both.spki,
      contributorSub: "s_same",
      itemId: "a-column",
    };
    const body = await nextBody(null, 10, shape);
    const receipt = await dualSign(body, both.privateKey, both.privateKey);

    const result = await verifyChain(
      [receipt],
      { aid: "a1", sid: "s1", consumerKey: both.spki },
      verify,
    );
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => p.reason)).toContain("self-dealing");
  });

  it("proves nothing from an empty chain, without erroring", async () => {
    // A consumer who yanks the cable before signing anything has consumed
    // nothing, and that is a legitimate outcome rather than a failure.
    const consumer = await party();
    const result = await verifyChain([], expected(consumer.spki), verify);
    expect(result).toEqual({ ok: true, units: 0, problems: [] });
  });
});
