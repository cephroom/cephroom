import { importSPKI, jwtVerify } from "jose";


let cached: { key: CryptoKey; issuer: string; audience: string } | null = null;

/**
 * What a node learns from a reader's key.
 *
 * A subject scoped to this contributor, and what it permits. There is no
 * tier: a consumer's subscription is about the platform's discovery and is
 * nobody else's business, and a column is served whole regardless.
 */
export interface VerifiedKey {
  sub: string | null;
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
  /** This node's own subject. A key naming a different one is not ours. */
  self?: string,
): Promise<VerifiedKey | null> {
  try {
    const { key, issuer, audience } = await platformKey(platform);
    const { payload } = await jwtVerify(token, key, { issuer, audience });

    // A key with no subject is anonymous, not invalid — but only if it says
    // so. One with neither a subject nor the marker is malformed.
    if (!payload.sub && payload.anon !== true) return null;

    // The subject in a reader's key is scoped to the contributor it was
    // minted for, so it is only meaningful here if it was minted for here.
    // Accepting another node's key would let two contributors compare
    // pseudonyms and undo the scoping — which is the entire reason it exists.
    if (payload.anon !== true && self && payload.nod !== self) return null;

    return {
      sub: payload.sub ?? null,
      scopes: (payload.scp as string[]) ?? [],
    };
  } catch {
    // An unverifiable key is simply not a key. The reader is served as an
    // anonymous one, and nothing is recorded about the attempt.
    return null;
  }
}
