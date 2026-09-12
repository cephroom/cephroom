import { importSPKI, jwtVerify } from "jose";


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
