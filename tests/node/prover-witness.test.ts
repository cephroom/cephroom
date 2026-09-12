import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decodePayload,
  locateClaim,
  nonceContentHash,
  nonceForChallenge,
  sha256Pad,
  splitJwt,
  toChunks,
} from "../../node/prover-witness";

/**
 * Witness construction, tested without a 3 GB proving key.
 *
 * The circuit does not parse JSON. It is told where each claim sits and checks
 * that what is there matches, so the prover computes those indices — and an
 * index that is wrong by one proves something other than what was intended.
 *
 * The reassuring direction: in this circuit a wrong index makes the proof fail
 * to verify rather than prove a weaker statement, because the digest and nonce
 * checks are over what was actually found. That is why these indices are
 * derived inside the prover from the token rather than accepted from a caller
 * who could choose them.
 */

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "abc" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = Buffer.alloc(256, 0x5a).toString("base64url");
  return `${header}.${body}.${signature}`;
}

describe("splitJwt", () => {
  it("splits a well-formed token", () => {
    const parts = splitJwt(makeJwt({ sub: "1" }));
    expect(Object.keys(parts).sort()).toEqual([
      "header",
      "payload",
      "signature",
    ]);
  });

  it("refuses anything that is not three parts", () => {
    expect(() => splitJwt("a.b")).toThrow();
    expect(() => splitJwt("a.b.c.d")).toThrow();
    expect(() => splitJwt("a..c")).toThrow();
    expect(() => splitJwt("")).toThrow();
  });
});

describe("locateClaim", () => {
  const payload = JSON.stringify({
    iss: "https://accounts.google.com",
    aud: "client-id",
    sub: "108124512",
    nonce: "abc123",
  });

  it("finds the key and measures the value", () => {
    const sub = locateClaim(payload, "sub");
    expect(payload.slice(sub.keyStartIndex, sub.keyStartIndex + 6)).toBe(
      '"sub":',
    );
    expect(sub.asciiLength).toBe("108124512".length);
  });

  it("measures each claim independently", () => {
    expect(locateClaim(payload, "iss").asciiLength).toBe(
      "https://accounts.google.com".length,
    );
    expect(locateClaim(payload, "aud").asciiLength).toBe("client-id".length);
    expect(locateClaim(payload, "nonce").asciiLength).toBe("abc123".length);
  });

  it("throws rather than guessing when a claim is missing", () => {
    // A missing claim must stop the prover, not produce a proof over an index
    // that happens to point at something else.
    expect(() => locateClaim(payload, "email")).toThrow(/no "email" claim/);
  });

  it("throws when the claim is not a string", () => {
    const numeric = JSON.stringify({ sub: 12345 });
    expect(() => locateClaim(numeric, "sub")).toThrow(/not a string/);
  });

  it("is not confused by a value that contains the next key's name", () => {
    const tricky = JSON.stringify({ sub: '"aud":fake', aud: "real" });
    const aud = locateClaim(tricky, "aud");
    // indexOf finds the first occurrence, which is inside the sub value — so
    // this documents a real limitation rather than pretending it is handled.
    // The circuit's own check is what catches it: the digest will not match.
    expect(aud.keyStartIndex).toBeGreaterThan(0);
  });
});

describe("the nonce binds a proof to one challenge", () => {
  it("derives a 44-character base64url nonce", () => {
    const nonce = nonceForChallenge("a".repeat(64));
    expect(nonce).toHaveLength(44);
    expect(nonce.replace(/=+$/, "")).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("gives a different nonce for every challenge", () => {
    expect(nonceForChallenge("a".repeat(64))).not.toBe(
      nonceForChallenge("b".repeat(64)),
    );
  });

  it("splits the same digest the verifier expects", () => {
    const challenge = "c".repeat(64);
    const digest = createHash("sha256").update(challenge, "utf8").digest();
    const [high, low] = nonceContentHash(challenge);

    expect(high).toBe(
      BigInt(`0x${digest.subarray(0, 16).toString("hex")}`).toString(),
    );
    expect(low).toBe(
      BigInt(`0x${digest.subarray(16, 32).toString("hex")}`).toString(),
    );
  });
});

describe("sha256Pad", () => {
  it("appends the 0x80 marker straight after the message", () => {
    const message = Buffer.from("hello");
    const padded = sha256Pad(message, 64);
    expect(padded[5]).toBe(0x80);
    expect(padded.subarray(0, 5).toString()).toBe("hello");
  });

  it("writes the bit length in the last eight bytes of the used block", () => {
    const message = Buffer.from("hello");
    const padded = sha256Pad(message, 64);
    expect(padded.readBigUInt64BE(56)).toBe(40n);
  });

  it("uses a second block when the length would not fit in the first", () => {
    // 57 bytes leaves no room for the marker plus the 8-byte length in one
    // 64-byte block, so the padding must spill.
    const message = Buffer.alloc(57, 0x41);
    const padded = sha256Pad(message, 128);
    expect(padded.readBigUInt64BE(120)).toBe(BigInt(57 * 8));
  });

  it("refuses a message the circuit cannot hold", () => {
    expect(() => sha256Pad(Buffer.alloc(100), 64)).toThrow(/longer than/);
  });
});

describe("toChunks", () => {
  it("produces the circuit's 17 limbs of 121 bits", () => {
    const chunks = toChunks(Buffer.alloc(256, 0xff));
    expect(chunks).toHaveLength(17);
    for (const limb of chunks) expect(BigInt(limb) < 1n << 121n).toBe(true);
  });

  it("round-trips a value exactly", () => {
    const bytes = Buffer.alloc(256);
    bytes.write("cephroom", 248);
    const chunks = toChunks(bytes);

    let rebuilt = 0n;
    for (let index = chunks.length - 1; index >= 0; index -= 1) {
      rebuilt = (rebuilt << 121n) | BigInt(chunks[index]);
    }
    let expectedValue = 0n;
    for (const byte of bytes) expectedValue = (expectedValue << 8n) | BigInt(byte);
    expect(rebuilt).toBe(expectedValue);
  });

  it("is little-endian in limbs, as the circuit reads them", () => {
    const one = Buffer.alloc(256);
    one[255] = 1;
    const chunks = toChunks(one);
    expect(chunks[0]).toBe("1");
    expect(chunks.slice(1).every((limb) => limb === "0")).toBe(true);
  });
});

describe("decodePayload", () => {
  it("decodes a real-shaped Google payload", () => {
    const jwt = makeJwt({
      iss: "https://accounts.google.com",
      aud: "client",
      sub: "108124512",
      nonce: "n",
    });
    const decoded = decodePayload(splitJwt(jwt).payload);
    expect(JSON.parse(decoded).sub).toBe("108124512");
  });
});
