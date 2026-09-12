import { generateKeyPairSync } from "node:crypto";

import { SignJWT, importPKCS8 } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PLATFORM_KEY_TTL_MS,
  resetPlatformKeyCache,
  verifyKeyWithPlatform,
} from "../../node/verify";

const PLATFORM = "http://platform.test";
const NODE = "s_node_marcus";
const ISSUER = "cephroom";
const AUDIENCE = "cephroom:access";

function pair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    pkcs8: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    spki: publicKey.export({ type: "spki", format: "pem" }) as string,
  };
}

async function nodeKey(
  pkcs8: string,
  options: { expires?: string; audience?: string } = {},
) {
  return new SignJWT({ scp: ["write:propose"], nod: options.audience ?? NODE })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject("n_TpyW52GXGUT3yY3mj")
    .setIssuedAt()
    .setExpirationTime(options.expires ?? "2m")
    .sign(await importPKCS8(pkcs8, "EdDSA"));
}

function serving(spki: string) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({ publicKey: spki, issuer: ISSUER, audience: AUDIENCE }),
  }));
}

beforeEach(() => {
  resetPlatformKeyCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetPlatformKeyCache();
});

describe("a node checks expiry from the public key alone", () => {
  it("accepts a key that has not expired", async () => {
    const platform = pair();
    vi.stubGlobal("fetch", serving(platform.spki));

    const verified = await verifyKeyWithPlatform(
      PLATFORM,
      await nodeKey(platform.pkcs8),
      NODE,
    );
    expect(verified?.sub).toBe("n_TpyW52GXGUT3yY3mj");
  });

  it("refuses a key whose expiry has passed", async () => {
    const platform = pair();
    vi.stubGlobal("fetch", serving(platform.spki));

    const expired = await nodeKey(platform.pkcs8, { expires: "-1s" });
    expect(await verifyKeyWithPlatform(PLATFORM, expired, NODE)).toBeNull();
  });

  it("refuses a key minted for a different node", async () => {
    const platform = pair();
    vi.stubGlobal("fetch", serving(platform.spki));

    const elsewhere = await nodeKey(platform.pkcs8, { audience: "s_node_ines" });
    expect(await verifyKeyWithPlatform(PLATFORM, elsewhere, NODE)).toBeNull();
  });

  it("refuses a key signed by anyone but the platform", async () => {
    const platform = pair();
    const attacker = pair();
    vi.stubGlobal("fetch", serving(platform.spki));

    const forged = await nodeKey(attacker.pkcs8);
    expect(await verifyKeyWithPlatform(PLATFORM, forged, NODE)).toBeNull();
  });
});

describe("rotating the signing key reaches a node that is already running", () => {
  it("stops honouring keys from the retired signing key once the cache lapses", async () => {
    vi.useFakeTimers();

    const before = pair();
    const after = pair();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          publicKey: before.spki,
          issuer: ISSUER,
          audience: AUDIENCE,
        }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          publicKey: after.spki,
          issuer: ISSUER,
          audience: AUDIENCE,
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const oldKey = await nodeKey(before.pkcs8, { expires: "90d" });

    expect(await verifyKeyWithPlatform(PLATFORM, oldKey, NODE)).not.toBeNull();

    vi.advanceTimersByTime(PLATFORM_KEY_TTL_MS + 1_000);

    expect(
      await verifyKeyWithPlatform(PLATFORM, oldKey, NODE),
      [
        "Rotating the platform signing key is the only revocation this design",
        "has, and it is supposed to sign everybody out. A node that caches the",
        "old public key forever keeps honouring retired keys until somebody",
        "restarts it, which makes the one remedy not actually reach the place",
        "the key is being presented.",
      ].join("\n"),
    ).toBeNull();

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("does not refetch on every request inside the window", async () => {
    const platform = pair();
    const fetchMock = serving(platform.spki);
    vi.stubGlobal("fetch", fetchMock);

    const key = await nodeKey(platform.pkcs8);
    for (let i = 0; i < 5; i += 1) {
      await verifyKeyWithPlatform(PLATFORM, key, NODE);
    }

    expect(fetchMock.mock.calls.length).toBe(1);
  });

  it("keeps serving on the cached key when the platform is unreachable", async () => {
    vi.useFakeTimers();

    const platform = pair();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          publicKey: platform.spki,
          issuer: ISSUER,
          audience: AUDIENCE,
        }),
      })
      .mockRejectedValue(new Error("platform down"));
    vi.stubGlobal("fetch", fetchMock);

    const key = await nodeKey(platform.pkcs8, { expires: "90d" });
    expect(await verifyKeyWithPlatform(PLATFORM, key, NODE)).not.toBeNull();

    vi.advanceTimersByTime(PLATFORM_KEY_TTL_MS + 1_000);

    expect(
      await verifyKeyWithPlatform(PLATFORM, key, NODE),
      "An outage at the platform must not stop a contributor serving.",
    ).not.toBeNull();
  });

  it("states a window rather than caching forever", () => {
    expect(PLATFORM_KEY_TTL_MS).toBeGreaterThan(0);
    expect(PLATFORM_KEY_TTL_MS).toBeLessThanOrEqual(60 * 60 * 1000);
  });
});
