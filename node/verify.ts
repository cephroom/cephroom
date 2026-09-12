import { importSPKI, jwtVerify } from "jose";

import type { Tier } from "../src/lib/access";


let cached: { key: CryptoKey; issuer: string; audience: string } | null = null;

export interface VerifiedKey {
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
