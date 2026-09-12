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
  /**
   * Who the reader is, or null when the platform does not know.
   *
   * Null is the anonymous case: a key minted by redeeming a blind-signed
   * access token, which carries a tier and nothing else because no subject for
   * it exists anywhere. A node serving a member column has everything it needs
   * — the tier, signed by the platform — and learns nothing about the person
   * on the other end, which is the point.
   *
   * Anything on this node that needs attribution (a proposal) must check for a
   * subject rather than assume one. An anonymous key carries no
   * `write:propose` scope, so that path is closed twice over.
   */
  sub: string | null;
  tier: Tier;
  scopes: string[];
}

async function platformKey(platform: string) {
  if (cached) return cached;

  const response = await fetch(`${platform}/.well-known/cephroom-key`);
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
    if (!tier) return null;
    // A key with no subject is anonymous, not invalid — but only if it says
    // so. One with neither a subject nor the marker is malformed.
    if (!payload.sub && payload.anon !== true) return null;

    return {
      sub: payload.sub ?? null,
      tier,
      scopes: (payload.scp as string[]) ?? [],
    };
  } catch {
    // An unverifiable key is simply not a key. The reader is served as an
    // anonymous one, and nothing is recorded about the attempt.
    return null;
  }
}
