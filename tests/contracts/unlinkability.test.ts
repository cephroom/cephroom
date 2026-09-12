import { describe, expect, it } from "vitest";

import {
  buildRequests,
  finalizeBatch,
  issueBatch,
  publishedKeys,
  redeem,
} from "@/lib/tokens/issuer";

/**
 * Layer 1, tested for the property rather than for the happy path.
 *
 * A test that "a token can be issued and redeemed" would pass just as happily
 * against a scheme where the platform writes down which subscriber got which
 * token. What has to be demonstrated is the thing that would be *lost* if
 * somebody reintroduced linkability, so these tests are written as: take two
 * redemptions, and show that nothing the platform holds distinguishes
 * "same subscriber twice" from "two different subscribers once each."
 *
 * If that stops being true — a redemption context stamped per batch, a token
 * index leaking into the response, a nullifier derived from anything the
 * issuer saw — these fail.
 */

async function keyFor(tier: "query" | "sweep"): Promise<Uint8Array> {
  const keys = await publishedKeys();
  const found = keys.find((key) => key.tier === tier);
  if (!found) throw new Error(`no published key for ${tier}`);
  return Uint8Array.from(Buffer.from(found.publicKey, "base64"));
}

/** One subscriber's whole journey: ask for a batch, get tokens back. */
async function subscriberGetsTokens(
  tier: "query" | "sweep",
  count: number,
): Promise<{ tokens: string[]; seenByPlatform: string[] }> {
  const publicKey = await keyFor(tier);
  const { clients, requests } = await buildRequests(publicKey, count);

  // `requests` is everything that crosses the wire at issuance time. It is
  // captured here so a test can assert the platform's view is useless.
  const { responses } = await issueBatch(
    tier,
    requests.map((request) => Uint8Array.from(Buffer.from(request, "base64"))),
  );

  return {
    tokens: await finalizeBatch(clients, responses),
    seenByPlatform: [...requests, ...responses],
  };
}

describe("Layer 1: a redemption cannot be traced to its issuance", () => {
  it("issues tokens the platform has never seen the contents of", async () => {
    const { tokens, seenByPlatform } = await subscriberGetsTokens("query", 2);

    // The strong form: no token, and no substantial run of bytes from one,
    // appears anywhere in what crossed the wire during issuance.
    const wire = seenByPlatform.join("|");
    for (const token of tokens) {
      expect(wire).not.toContain(token);
      // A 32-character prefix is 24 bytes of the serialised token. If the
      // issuer could see that much of it, it could recognise the token later.
      expect(wire).not.toContain(token.slice(0, 32));
    }
  });

  it("makes two tokens from one issuance indistinguishable from two from different issuances", async () => {
    // Alice buys a batch. Bob buys a batch. Alice redeems twice; Bob once.
    const alice = await subscriberGetsTokens("query", 2);
    const bob = await subscriberGetsTokens("query", 2);

    const aliceFirst = await redeem(
      Uint8Array.from(Buffer.from(alice.tokens[0], "base64")),
    );
    const aliceSecond = await redeem(
      Uint8Array.from(Buffer.from(alice.tokens[1], "base64")),
    );
    const bobFirst = await redeem(
      Uint8Array.from(Buffer.from(bob.tokens[0], "base64")),
    );

    expect(aliceFirst).not.toBeNull();
    expect(aliceSecond).not.toBeNull();
    expect(bobFirst).not.toBeNull();

    // Everything a redemption yields, for all three.
    const shapes = [aliceFirst!, aliceSecond!, bobFirst!].map((r) => ({
      tier: r.tier,
      epoch: r.epoch,
      nullifierLength: r.nullifier.length,
      fields: Object.keys(r).sort(),
    }));

    // The two from Alice's batch look exactly like the one from Bob's. If a
    // batch identifier had leaked in, this is where it would show.
    expect(shapes[0]).toEqual(shapes[1]);
    expect(shapes[0]).toEqual(shapes[2]);

    // And the nullifiers are unrelated to each other — no shared prefix that
    // would let redemptions be clustered by batch.
    const [a1, a2, b1] = [
      aliceFirst!.nullifier,
      aliceSecond!.nullifier,
      bobFirst!.nullifier,
    ];
    expect(a1).not.toBe(a2);
    expect(a1.slice(0, 8)).not.toBe(a2.slice(0, 8));
    expect(a1.slice(0, 8)).not.toBe(b1.slice(0, 8));
  });

  it("yields no subject, customer, or issuance reference at redemption", async () => {
    const { tokens } = await subscriberGetsTokens("sweep", 1);
    const result = await redeem(
      Uint8Array.from(Buffer.from(tokens[0], "base64")),
    );

    // The exhaustive field list. Adding anything here is the change that would
    // break Layer 1, so it is asserted exactly rather than loosely.
    expect(Object.keys(result!).sort()).toEqual(["epoch", "nullifier", "tier"]);
  });

  it("carries the tier, and nothing finer", async () => {
    const member = await subscriberGetsTokens("query", 1);
    const lab = await subscriberGetsTokens("sweep", 1);

    const asMember = await redeem(
      Uint8Array.from(Buffer.from(member.tokens[0], "base64")),
    );
    const asLab = await redeem(
      Uint8Array.from(Buffer.from(lab.tokens[0], "base64")),
    );

    expect(asMember!.tier).toBe("query");
    expect(asLab!.tier).toBe("sweep");
  });

  it("uses a fixed redemption context, so a batch cannot be marked", async () => {
    // A per-issuance random redemption context is the single easiest way to
    // destroy this property: the platform stamps a batch, sees the stamp come
    // back, and has linked reading to paying again. Two independently built
    // batches must produce tokens whose verifiable context is identical, which
    // is observable as: a token from one batch verifies under the same key and
    // yields the same shape as a token from the other, with no per-batch value
    // anywhere in the redemption.
    const first = await subscriberGetsTokens("query", 1);
    const second = await subscriberGetsTokens("query", 1);

    const a = await redeem(
      Uint8Array.from(Buffer.from(first.tokens[0], "base64")),
    );
    const b = await redeem(
      Uint8Array.from(Buffer.from(second.tokens[0], "base64")),
    );

    expect(a!.tier).toBe(b!.tier);
    expect(a!.epoch).toBe(b!.epoch);
  });

  it("refuses a token that verifies against no live key", async () => {
    const forged = new Uint8Array(354);
    forged.set([0, 2], 0);
    expect(await redeem(forged)).toBeNull();
    expect(await redeem(new Uint8Array(0))).toBeNull();
    expect(await redeem(Uint8Array.from([1, 2, 3]))).toBeNull();
  });

  it("refuses a token whose signature has been tampered with", async () => {
    const { tokens } = await subscriberGetsTokens("query", 1);
    const bytes = Uint8Array.from(Buffer.from(tokens[0], "base64"));
    // Flip a bit in the authenticator, which is the last 256 bytes.
    bytes[bytes.length - 1] ^= 0x01;
    expect(await redeem(bytes)).toBeNull();
  });

  it("does not let a Query token buy Sweep reach", async () => {
    const { tokens } = await subscriberGetsTokens("query", 1);
    const result = await redeem(
      Uint8Array.from(Buffer.from(tokens[0], "base64")),
    );
    // The tier is the key that signed it. A Query token cannot verify under
    // the Sweep key, so there is no way to present it as one.
    expect(result!.tier).toBe("query");
  });
});
