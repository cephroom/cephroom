import { importSPKI, jwtVerify } from "jose";


/**
 * Why this cache has a window - contract 3.
 *
 * Rotating the platform signing key is the only revocation this design has, and
 * it is supposed to sign everybody out at once. This module used to fetch the
 * public key once and keep it for the life of the process, so a long-running
 * node kept honouring keys signed by a retired key until somebody restarted it.
 * The one remedy stopped at the platform boundary and nothing said so.
 *
 * Ten minutes bounds how long a rotation takes to reach a node that is already
 * serving. The fallback below is the other half: if the platform is unreachable
 * the cached key is kept rather than dropped, because an outage there must not
 * stop a contributor serving - contract 4 means their work is theirs to serve
 * whether or not discovery is up.
 */
export const PLATFORM_KEY_TTL_MS = 10 * 60 * 1000;

interface CachedKey {
  key: CryptoKey;
  issuer: string;
  audience: string;
  fetchedAt: number;
}

let cached: CachedKey | null = null;

export function resetPlatformKeyCache(): void {
  cached = null;
}

export interface VerifiedKey {
  sub: string | null;
  scopes: string[];
}

async function fetchPlatformKey(platform: string): Promise<CachedKey> {
  const response = await fetch(`${platform}/.well-known/cephroom-key`);
  if (!response.ok) throw new Error("could not fetch the platform public key");

  const json = (await response.json()) as {
    publicKey: string;
    issuer: string;
    audience: string;
  };

  return {
    key: (await importSPKI(json.publicKey, "EdDSA")) as CryptoKey,
    issuer: json.issuer,
    audience: json.audience,
    fetchedAt: Date.now(),
  };
}

async function platformKey(platform: string): Promise<CachedKey> {
  const fresh = cached && Date.now() - cached.fetchedAt < PLATFORM_KEY_TTL_MS;
  if (cached && fresh) return cached;

  try {
    cached = await fetchPlatformKey(platform);
    return cached;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}

/**
 * A node decides all of this from the public key alone - contract 3.
 *
 * Expiry is signed, not encrypted, so a contributor's machine can check it
 * offline with material the platform publishes openly. It does not call back to
 * ask whether a key is still good, and there is nothing it could ask: there is
 * no list of live keys anywhere, by design.
 *
 * The nod check is what stops a contributor replaying a reader's key at another
 * contributor. A key naming no node, or naming a different one, is refused here
 * as well as on the platform - the same rule held independently at both ends,
 * because a node cannot assume the platform checked anything on its behalf.
 */
export async function verifyKeyWithPlatform(
  platform: string,
  token: string,
  self?: string,
): Promise<VerifiedKey | null> {
  try {
    const { key, issuer, audience } = await platformKey(platform);
    const { payload } = await jwtVerify(token, key, { issuer, audience });

    if (!payload.sub && payload.anon !== true) return null;

    if (payload.anon !== true && self && payload.nod !== self) return null;

    return {
      sub: payload.sub ?? null,
      scopes: (payload.scp as string[]) ?? [],
    };
  } catch {
    return null;
  }
}
