import { generateKeyPair, exportSPKI, importSPKI } from "jose";
import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalBytes,
  nextBody,
  verifyChain,
  type Receipt,
  type ReceiptBody,
} from "@/lib/earnings/receipt";
import { planSettlement, type GrantFacts } from "@/lib/earnings/settlement";
import { SessionRegistry, SpentCounter } from "@/lib/earnings/sessions";
import { CONTRIBUTOR_SHARE, PLATFORM_SHARE } from "@/lib/earnings/units";

/**
 * Every adversarial case, worked through — including the two that cannot be
 * prevented, which are stated rather than quietly omitted.
 *
 * The design's enforcement is incentive, not supervision: a consumer who will
 * not write gets no data, a contributor who will not write gets no money.
 * These tests check that the incentives actually point that way, and that
 * where they do not, the *money invariant* still holds regardless of what
 * anybody does.
 */

async function party() {
  const { privateKey, publicKey } = await generateKeyPair("Ed25519", {
    extractable: true,
  });
  return { privateKey, publicKey, spki: await exportSPKI(publicKey) };
}

async function signWith(key: CryptoKey, message: string): Promise<string> {
  return Buffer.from(
    await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(message)),
  ).toString("base64url");
}

const verify = async (spki: string, signature: string, message: string) => {
  try {
    const key = (await importSPKI(spki, "Ed25519")) as CryptoKey;
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

async function dual(
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

const registry = new SessionRegistry();
const counter = new SpentCounter();
afterEach(() => {
  registry.clear();
  counter.clear();
});

/* ------------------------------------------------------------------ */

describe("a contributor handshaking with themselves", () => {
  it("is refused outright — the cheap collusion case is the detectable one", async () => {
    const both = await party();
    const body = await nextBody(null, 50, {
      aid: "a1",
      sid: "s1",
      consumerKey: both.spki,
      contributorKey: both.spki,
      contributorSub: "s_me",
      itemId: "x",
    });
    const receipt = await dual(body, both.privateKey, both.privateKey);

    const result = await verifyChain(
      [receipt],
      { aid: "a1", sid: "s1", consumerKey: both.spki },
      verify,
    );
    expect(result.problems.map((p) => p.reason)).toContain("self-dealing");
    expect(result.units).toBe(0);
  });
});

describe("two contributors trading handshakes", () => {
  it("is NOT prevented, and cannot be without watching the data layer", async () => {
    // Alice's node serves Bob; Bob's node serves Alice. Both pay with their
    // own prepaid grants. Every receipt is genuine — the bytes may even have
    // moved. Nothing distinguishes this from two researchers reading each
    // other's work, and the only thing that would is inspecting what was
    // served, which this platform does not do and will not start doing.
    const alice = await party();
    const bob = await party();

    const body = await nextBody(null, 100, {
      aid: "alice-grant",
      sid: "s1",
      consumerKey: alice.spki,
      contributorKey: bob.spki,
      contributorSub: "s_bob",
      itemId: "bobs-column",
    });
    const receipt = await dual(body, alice.privateKey, bob.privateKey);

    const result = await verifyChain(
      [receipt],
      { aid: "alice-grant", sid: "s1", consumerKey: alice.spki },
      verify,
    );

    // It verifies. That is the honest outcome and the test says so.
    expect(result.ok).toBe(true);
    expect(result.units).toBe(100);
  });

  it("is loss-making, which is the actual defence", () => {
    // Wash trading moves already-purchased units between two people and the
    // platform keeps its share of every one. Two colluders who cycle a grant
    // back and forth are buying units at full price and recovering only the
    // contributor share, so the round trip is strictly negative for them.
    expect(PLATFORM_SHARE).toBeGreaterThan(0);
    expect(CONTRIBUTOR_SHARE).toBeLessThan(1);

    const spent = 1000;
    const recovered = spent * CONTRIBUTOR_SHARE;
    expect(recovered).toBeLessThan(spent);
  });
});

describe("a shared key used from many machines at once", () => {
  it("is refused a second concurrent session on the same grant", () => {
    expect(registry.open("a1", "s1", 100).ok).toBe(true);

    const second = registry.open("a1", "s2", 100);
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.reason).toBe("already-open");
  });

  it("lets the same session re-open, so a reconnect is not a lockout", () => {
    registry.open("a1", "s1", 100);
    expect(registry.open("a1", "s1", 100).ok).toBe(true);
  });

  it("frees the grant when the session closes", () => {
    registry.open("a1", "s1", 100);
    registry.close("a1", "s1");
    expect(registry.open("a1", "s2", 100).ok).toBe(true);
  });

  it("frees it when the session lapses, with no sweeper", () => {
    const now = Date.now();
    registry.open("a1", "s1", 100, now);
    // Two epochs later the lease has lapsed; nothing ran to make that true.
    expect(registry.isOpen("a1", now + 21 * 60 * 1000)).toBe(false);
  });

  it("still bounds payout when sequential sharing gets past the session check", () => {
    // Sharing over time is not prevented and does not need to be: the grant is
    // the ceiling, and the spent counter enforces it across settlements.
    const grants = new Map<string, GrantFacts>([
      ["a1", { aid: "a1", units: 100, period: 3 }],
    ]);

    let drawn = 0;
    let total = 0;
    for (const sid of ["s1", "s2", "s3", "s4", "s5"]) {
      const plan = planSettlement({
        contributorSub: "s_c",
        settledThroughPeriod: 2,
        currentPeriod: 3,
        claims: [
          { contributorSub: "s_c", aid: "a1", sid, period: 3, units: 60 },
        ],
        grants,
        alreadySpent: () => drawn,
      });
      drawn += plan.units;
      total += plan.units;
    }

    expect(total).toBe(100);
  });
});

describe("replaying a signed usage write", () => {
  it("gains nothing: the maximum per session wins, never the sum", () => {
    const plan = planSettlement({
      contributorSub: "s_c",
      settledThroughPeriod: 2,
      currentPeriod: 3,
      claims: [
        { contributorSub: "s_c", aid: "a1", sid: "s1", period: 3, units: 40 },
        { contributorSub: "s_c", aid: "a1", sid: "s1", period: 3, units: 40 },
        { contributorSub: "s_c", aid: "a1", sid: "s1", period: 3, units: 40 },
      ],
      grants: new Map([["a1", { aid: "a1", units: 100, period: 3 }]]),
      alreadySpent: () => 0,
    });
    expect(plan.units).toBe(40);
  });

  it("gains nothing across settlements either, because of the watermark", () => {
    const grants = new Map([["a1", { aid: "a1", units: 100, period: 3 }]]);
    const claims = [
      { contributorSub: "s_c", aid: "a1", sid: "s1", period: 3, units: 40 },
    ];

    const first = planSettlement({
      contributorSub: "s_c",
      settledThroughPeriod: 2,
      currentPeriod: 3,
      claims,
      grants,
      alreadySpent: () => 0,
    });
    expect(first.units).toBe(40);

    // Same receipts, presented again after settlement wrote the new key.
    const second = planSettlement({
      contributorSub: "s_c",
      settledThroughPeriod: first.newSettledThroughPeriod,
      currentPeriod: 4,
      claims,
      grants,
      alreadySpent: () => 40,
    });
    expect(second.units).toBe(0);
  });

  it("cannot be moved to another contributor", () => {
    const plan = planSettlement({
      contributorSub: "s_thief",
      settledThroughPeriod: 2,
      currentPeriod: 3,
      claims: [
        { contributorSub: "s_c", aid: "a1", sid: "s1", period: 3, units: 40 },
      ],
      grants: new Map([["a1", { aid: "a1", units: 100, period: 3 }]]),
      alreadySpent: () => 0,
    });
    expect(plan.units).toBe(0);
    expect(plan.rejected[0].reason).toBe("not-this-contributor");
  });
});

describe("disconnecting at the most favourable moment", () => {
  /**
   * Somebody is exposed by a mid-flight disconnect, and which one is a design
   * choice rather than an accident.
   *
   * The protocol is **receipt-then-data**: the consumer signs for a chunk
   * before the chunk is sent. So a consumer who yanks the cable has already
   * paid for what they received, plus at most the one chunk in flight — and a
   * contributor who yanks it has been paid for a chunk they did not send, also
   * at most one.
   *
   * The exposure is one chunk either way, which is what makes the chunk small.
   * It is deliberately tilted towards the contributor: someone who does the
   * work gets paid for it, and the party who can most cheaply retry is the one
   * who bears the loss.
   */
  it("has already recorded what was transferred when a consumer vanishes", async () => {
    const consumer = await party();
    const contributor = await party();
    const shape = {
      aid: "a1",
      sid: "s1",
      consumerKey: consumer.spki,
      contributorKey: contributor.spki,
      contributorSub: "s_c",
      itemId: "x",
    };

    // Three chunks signed and sent; the fourth signed, then the cable is cut.
    const chain: Receipt[] = [];
    let previous: Receipt | null = null;
    for (let index = 0; index < 4; index += 1) {
      const body = await nextBody(previous, 10, shape);
      const receipt = await dual(body, consumer.privateKey, contributor.privateKey);
      chain.push(receipt);
      previous = receipt;
    }

    const result = await verifyChain(
      chain,
      { aid: "a1", sid: "s1", consumerKey: consumer.spki },
      verify,
    );

    // Forty units recorded for three delivered chunks and one in flight. The
    // contributor is whole; the consumer is out by one chunk.
    expect(result.ok).toBe(true);
    expect(result.units).toBe(40);
  });

  it("leaves a contributor who vanishes before countersigning with nothing", async () => {
    const consumer = await party();
    const contributor = await party();
    const body = await nextBody(null, 10, {
      aid: "a1",
      sid: "s1",
      consumerKey: consumer.spki,
      contributorKey: contributor.spki,
      contributorSub: "s_c",
      itemId: "x",
    });

    // Consumer signed; contributor did not. This is not a receipt.
    const halfSigned = {
      ...body,
      consumerSig: await signWith(consumer.privateKey, canonicalBytes(body)),
      contributorSig: "",
    };

    const result = await verifyChain(
      [halfSigned],
      { aid: "a1", sid: "s1", consumerKey: consumer.spki },
      verify,
    );
    expect(result.units).toBe(0);
    expect(result.problems.map((p) => p.reason)).toContain(
      "bad-contributor-signature",
    );
  });
});

describe("allowance exhaustion is a state, not a failure", () => {
  it("reports partial exhaustion distinctly from total exhaustion", () => {
    const grants = new Map([["a1", { aid: "a1", units: 100, period: 3 }]]);

    const partial = planSettlement({
      contributorSub: "s_c",
      settledThroughPeriod: 2,
      currentPeriod: 3,
      claims: [{ contributorSub: "s_c", aid: "a1", sid: "s1", period: 3, units: 150 }],
      grants,
      alreadySpent: () => 0,
    });
    expect(partial.units).toBe(100);
    expect(partial.rejected[0].reason).toBe("allowance-partially-exhausted");

    const total = planSettlement({
      contributorSub: "s_c",
      settledThroughPeriod: 2,
      currentPeriod: 3,
      claims: [{ contributorSub: "s_c", aid: "a1", sid: "s2", period: 3, units: 10 }],
      grants,
      alreadySpent: () => 100,
    });
    expect(total.rejected[0].reason).toBe("allowance-exhausted");
  });
});

describe("the spent counter is bounded and holds no person", () => {
  it("drops closed periods whole", () => {
    counter.advance([{ aid: "a1", sid: "s1", units: 10 }], 1);
    counter.advance([{ aid: "a2", sid: "s1", units: 10 }], 2);
    expect(counter.size()).toBe(2);

    counter.advance([{ aid: "a3", sid: "s1", units: 10 }], 3);
    // Period 1 is gone with its grants, which expired with it.
    expect(counter.spent("a1", 1)).toBe(0);
    expect(counter.size()).toBe(2);
  });

  it("only ever counts down an allowance, never up a debt", () => {
    // It is not a balance: nothing here grows when money arrives, and nothing
    // here is owed to anybody. It records how much of an already-purchased
    // allowance has been drawn.
    const source = SpentCounter.prototype.advance.toString();
    expect(source).not.toMatch(/balance|owe|credit|deposit/i);
  });
});

describe("an un-revokable old key cannot re-settle a paid session", () => {
  /**
   * Found by probing the live endpoint, and it is the sharpest case here.
   *
   * The watermark stops a replay presented with the *new* key. But keys cannot
   * be revoked in this design — that is written into Contract 1 — so a
   * contributor keeps the pre-settlement key with the old watermark, and
   * presenting the same receipts with it gets straight past the check.
   *
   * The grant cap meant total payout was still bounded, so the headline
   * invariant never broke. But "bounded by the grant" is a much weaker promise
   * than "paid once for work done once": a contributor could drain a
   * 6,300-unit grant by re-settling one 100-unit session sixty-three times.
   *
   * The fix is that the spent counter records the **maximum per session**
   * rather than a sum per grant, so a second presentation of the same session
   * draws the difference, which is zero.
   */
  it("draws nothing the second time, even with the old watermark", () => {
    const grants = new Map([["a1", { aid: "a1", units: 6300, period: 3 }]]);
    const claims = [
      { contributorSub: "s_c", aid: "a1", sid: "sess-1", period: 3, units: 100 },
    ];

    const first = planSettlement({
      contributorSub: "s_c",
      settledThroughPeriod: 2,
      currentPeriod: 3,
      claims,
      grants,
      alreadySpent: () => 0,
      alreadySpentForSession: () => 0,
    });
    expect(first.units).toBe(100);

    counter.advance(first.draws, 3);

    // The old key: watermark still 2, so the period check passes.
    const second = planSettlement({
      contributorSub: "s_c",
      settledThroughPeriod: 2,
      currentPeriod: 3,
      claims,
      grants,
      alreadySpent: (aid) => counter.spent(aid, 3),
      alreadySpentForSession: (aid, sid) => counter.spentForSession(aid, sid, 3),
    });

    expect(second.units).toBe(0);
    expect(second.rejected.map((r) => r.reason)).toContain("session-already-paid");
  });

  it("pays only the increment when a session genuinely grew", () => {
    // The same session, later, with more usage on it. The honest case must
    // still work: pay the difference, not nothing and not the whole thing.
    const grants = new Map([["a1", { aid: "a1", units: 6300, period: 3 }]]);

    const first = planSettlement({
      contributorSub: "s_c",
      settledThroughPeriod: 2,
      currentPeriod: 3,
      claims: [{ contributorSub: "s_c", aid: "a1", sid: "s1", period: 3, units: 100 }],
      grants,
      alreadySpent: () => 0,
      alreadySpentForSession: () => 0,
    });
    counter.advance(first.draws, 3);

    const second = planSettlement({
      contributorSub: "s_c",
      settledThroughPeriod: 2,
      currentPeriod: 3,
      claims: [{ contributorSub: "s_c", aid: "a1", sid: "s1", period: 3, units: 175 }],
      grants,
      alreadySpent: (aid) => counter.spent(aid, 3),
      alreadySpentForSession: (aid, sid) => counter.spentForSession(aid, sid, 3),
    });

    expect(second.units).toBe(75);
    expect(first.units + second.units).toBe(175);
  });

  it("cannot be drained by repeating a session many times", () => {
    const grants = new Map([["a1", { aid: "a1", units: 6300, period: 3 }]]);
    const claims = [
      { contributorSub: "s_c", aid: "a1", sid: "s1", period: 3, units: 100 },
    ];

    let total = 0;
    for (let attempt = 0; attempt < 63; attempt += 1) {
      const plan = planSettlement({
        contributorSub: "s_c",
        settledThroughPeriod: 2,
        currentPeriod: 3,
        claims,
        grants,
        alreadySpent: (aid) => counter.spent(aid, 3),
        alreadySpentForSession: (aid, sid) => counter.spentForSession(aid, sid, 3),
      });
      counter.advance(plan.draws, 3);
      total += plan.units;
    }

    // Sixty-three attempts, one payment.
    expect(total).toBe(100);
  });
});
