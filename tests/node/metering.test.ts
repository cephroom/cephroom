import { generateKeyPair, exportSPKI, importSPKI } from "jose";
import { describe, expect, it } from "vitest";

import {
  canonicalBytes,
  nextBody,
  type Receipt,
} from "../../src/lib/earnings/receipt";
import {
  CHUNK_BYTES,
  exhaustionBody,
  meter,
  quote,
  type MeterState,
} from "../../node/metering";

/**
 * The contributor's side, where the incentive is supposed to do the work.
 *
 * The thing being checked is not that metering counts correctly — that is the
 * receipt chain's job and it is tested there. It is that the node's *interest*
 * and honest behaviour point the same way, and that running out of allowance
 * reads as a state rather than as a fault.
 */

async function party() {
  const { privateKey, publicKey } = await generateKeyPair("Ed25519", {
    extractable: true,
  });
  return { privateKey, publicKey, spki: await exportSPKI(publicKey) };
}

const signWith = async (key: CryptoKey, message: string) =>
  Buffer.from(
    await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(message)),
  ).toString("base64url");

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

async function setUp(grantUnits = 100) {
  const consumer = await party();
  const contributor = await party();
  const state: MeterState = {
    aid: "a1",
    sid: "s1",
    grantUnits,
    consumerKey: consumer.spki,
    contributorKey: contributor.spki,
    contributorSub: "s_c",
    itemId: "a-column",
    chain: [],
  };
  return { consumer, contributor, state };
}

async function offer(
  state: MeterState,
  consumer: CryptoKey,
  delta: number,
): Promise<Omit<Receipt, "contributorSig">> {
  const body = await nextBody(state.chain[state.chain.length - 1] ?? null, delta, {
    aid: state.aid,
    sid: state.sid,
    consumerKey: state.consumerKey,
    contributorKey: state.contributorKey,
    contributorSub: state.contributorSub,
    itemId: state.itemId,
  });
  return {
    ...body,
    consumerSig: await signWith(consumer, canonicalBytes(body)),
  };
}

describe("metering a chunk", () => {
  it("countersigns a well-formed receipt and reports what is left", async () => {
    const { consumer, contributor, state } = await setUp(100);
    const outcome = await meter(
      state,
      await offer(state, consumer.privateKey, 32),
      (message) => signWith(contributor.privateKey, message),
      verify,
    );

    expect(outcome.kind).toBe("accepted");
    expect(outcome.kind === "accepted" && outcome.unitsNow).toBe(32);
    expect(outcome.kind === "accepted" && outcome.unitsLeft).toBe(68);
    expect(state.chain).toHaveLength(1);
  });

  it("refuses to countersign a receipt signed by the wrong key", async () => {
    // A countersignature is the node's commitment to serve, so everything that
    // could make the receipt worthless is checked before it signs.
    const { contributor, state } = await setUp();
    const impostor = await party();

    const outcome = await meter(
      state,
      await offer(state, impostor.privateKey, 10),
      (message) => signWith(contributor.privateKey, message),
      verify,
    );

    expect(outcome.kind).toBe("rejected");
    expect(outcome.kind === "rejected" && outcome.reason).toBe(
      "bad-consumer-signature",
    );
    expect(state.chain).toHaveLength(0);
  });

  it("refuses a receipt that does not continue the chain", async () => {
    const { consumer, contributor, state } = await setUp();
    await meter(
      state,
      await offer(state, consumer.privateKey, 10),
      (m) => signWith(contributor.privateKey, m),
      verify,
    );

    // A second receipt claiming to be the first again.
    const body = await nextBody(null, 10, {
      aid: state.aid,
      sid: state.sid,
      consumerKey: state.consumerKey,
      contributorKey: state.contributorKey,
      contributorSub: state.contributorSub,
      itemId: state.itemId,
    });
    const outcome = await meter(
      state,
      { ...body, consumerSig: await signWith(consumer.privateKey, canonicalBytes(body)) },
      (m) => signWith(contributor.privateKey, m),
      verify,
    );

    expect(outcome.kind).toBe("rejected");
    expect(state.chain).toHaveLength(1);
  });

  it("does not grow the chain when it rejects", async () => {
    const { contributor, state } = await setUp();
    const impostor = await party();
    await meter(
      state,
      await offer(state, impostor.privateKey, 10),
      (m) => signWith(contributor.privateKey, m),
      verify,
    );
    expect(state.chain).toHaveLength(0);
  });
});

describe("allowance exhaustion is a state, not a fault", () => {
  it("stops once the allowance is spent, and says so in numbers", async () => {
    const { consumer, contributor, state } = await setUp(30);

    await meter(
      state,
      await offer(state, consumer.privateKey, 30),
      (m) => signWith(contributor.privateKey, m),
      verify,
    );

    const outcome = await meter(
      state,
      await offer(state, consumer.privateKey, 10),
      (m) => signWith(contributor.privateKey, m),
      verify,
    );

    expect(outcome.kind).toBe("exhausted");
    if (outcome.kind !== "exhausted") return;
    expect(outcome.unitsSpent).toBe(30);
    expect(outcome.grantUnits).toBe(30);
    // The message names the numbers and rules out the two things a reader
    // would otherwise suspect.
    expect(outcome.message).toContain("30");
    expect(outcome.message).toMatch(/nothing is wrong/i);
  });

  it("reports what is left rather than refusing an over-large ask", async () => {
    const { consumer, contributor, state } = await setUp(50);
    const outcome = await meter(
      state,
      await offer(state, consumer.privateKey, 80),
      (m) => signWith(contributor.privateKey, m),
      verify,
    );

    expect(outcome.kind).toBe("exhausted");
    expect(outcome.kind === "exhausted" && outcome.message).toContain("50");
  });

  it("says that what was already served stays valid", async () => {
    const body = exhaustionBody({
      kind: "exhausted",
      unitsSpent: 30,
      grantUnits: 30,
      message: "used up",
    });

    // The connection ending is not a loss of the bytes already delivered, and
    // a reader should not have to guess that.
    expect(body.error).toBe("allowance-exhausted");
    expect(body.servedSoFarIsValid).toBe(true);
    expect(body.unitsLeft).toBe(0);
  });

  it("needs no enforcement: continuing would earn the node nothing", async () => {
    // The node stops because carrying on is unpaid, not because anybody made
    // it. This test pins the consequence — an exhausted state produces no
    // receipt, and no receipt is no money.
    const { consumer, contributor, state } = await setUp(10);
    await meter(
      state,
      await offer(state, consumer.privateKey, 10),
      (m) => signWith(contributor.privateKey, m),
      verify,
    );
    const before = state.chain.length;

    await meter(
      state,
      await offer(state, consumer.privateKey, 1),
      (m) => signWith(contributor.privateKey, m),
      verify,
    );
    expect(state.chain.length).toBe(before);
  });
});

describe("quoting", () => {
  it("prices a chunk in whole units, rounding up", () => {
    expect(quote(1)).toBe(1);
    expect(quote(1024)).toBe(1);
    expect(quote(1025)).toBe(2);
  });

  it("never quotes more than one chunk", () => {
    expect(quote(CHUNK_BYTES * 10)).toBe(quote(CHUNK_BYTES));
  });
});
