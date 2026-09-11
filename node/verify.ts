import { importSPKI, jwtVerify } from "jose";

import type { Tier } from "../src/lib/access";

/**
 * Verifying a reader's capability key, on the node, with a public key.
 *
 * This is why the keys are Ed25519 rather than HMAC. The node needs to decide
 * whether to serve a member-only column, and it must be able to decide that
 * on its own — the platform is not in the request path between a reader and a
 * node, and under Contract 2 it must not be.
 *
 * The public key is fetched from the platform once and cached for the life of
 * the process. That cache holds a public key, not anything about a person.
 */

let cached: { key: CryptoKey; issuer: string; audience: string } | null = null;

export interface VerifiedKey {
  sub: string;
  tier: Tier;
  scopes: string[];
}

async function platformKey(platform: string) {
  if (cached) return cached;

  const response = await fetch(`${platform}/.well-known/bindery-key`);
  if (!response.ok) throw new Error("could not fetch the platform public key");

  const json = (await response.json()) as {
    publicKey: string;
    issuer: string;
    audience: string;
  };

  cached = {
    key: (await importSPKI(json.publicKey, "EdDSA")) as CryptoKey,
    issuer: json.issuer,
    audience: json.audience,
  };
  return cached;
}

export async function verifyKeyWithPlatform(
  platform: string,
  token: string,
): Promise<VerifiedKey | null> {
  try {
    const { key, issuer, audience } = await platformKey(platform);
    const { payload } = await jwtVerify(token, key, { issuer, audience });

    const tier = payload.tier as Tier | undefined;
    if (!payload.sub || !tier) return null;

    return {
      sub: payload.sub,
      tier,
      scopes: (payload.scp as string[]) ?? [],
    };
  } catch {
    // An unverifiable key is simply not a key. The reader is served as an
    // anonymous one, and nothing is recorded about the attempt.
    return null;
  }
}
