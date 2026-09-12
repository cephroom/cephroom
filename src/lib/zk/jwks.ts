/**
 * The identity provider's signing keys, and the window in which they count.
 *
 * The circuit takes the RSA modulus as a **public** input, so the verifier's
 * job is to decide whether that modulus is one the provider is actually
 * signing with. That is the whole of key-rotation handling, and it is the one
 * part of Layer 2 that was always straightforward.
 *
 * Google rotates every few weeks and publishes at a JWKS endpoint. A verifier
 * that only accepted the keys fetched a moment ago would reject a proof made
 * over a JWT that was perfectly valid when it was issued; one that accepted
 * anything ever seen would accept a proof over a key retired years ago. So:
 * every key seen in the last `RETENTION_MS` counts, which is structurally the
 * same trick as the token issuer's two live epochs, and the same one the
 * zkLogin paper describes for its oracles.
 *
 * What is held here is public key material and nothing else. A JWKS is a
 * published document; caching it is not caching anything about a person.
 */

/** How long a modulus stays acceptable after it was last seen published. */
export const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

/** How often the published set is refetched. */
export const REFRESH_MS = 60 * 60 * 1000;

export interface ProviderKeys {
  issuer: string;
  jwksUri: string;
}

export const PROVIDERS: Record<string, ProviderKeys> = {
  "https://accounts.google.com": {
    issuer: "https://accounts.google.com",
    jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
  },
};

interface SeenKey {
  /** The RSA modulus, base64url, exactly as the JWKS publishes it. */
  n: string;
  /** When it was last observed in the published set. */
  lastSeen: number;
}

const globalForJwks = globalThis as unknown as {
  __cephroomJwks?: Map<string, { keys: SeenKey[]; fetchedAt: number }>;
};

function cache() {
  globalForJwks.__cephroomJwks ??= new Map();
  return globalForJwks.__cephroomJwks;
}

/**
 * Splits a base64url RSA modulus into the circuit's chunk representation.
 *
 * The circuit takes the modulus as 17 limbs of 121 bits, little-endian. A
 * verifier that compared the wrong representation would reject every honest
 * proof, so this is the one piece of bit-fiddling in the verification path and
 * it is tested against a known vector.
 */
export function modulusToChunks(
  modulusBase64Url: string,
  chunkBits = 121,
  chunks = 17,
): bigint[] {
  const bytes = Buffer.from(modulusBase64Url, "base64url");
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);

  const mask = (1n << BigInt(chunkBits)) - 1n;
  const out: bigint[] = [];
  for (let index = 0; index < chunks; index += 1) {
    out.push((value >> (BigInt(chunkBits) * BigInt(index))) & mask);
  }
  return out;
}

/** Fetches the provider's published keys and folds them into the window. */
export async function refreshProviderKeys(
  issuer: string,
  now: number = Date.now(),
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const provider = PROVIDERS[issuer];
  if (!provider) return;

  const entry = cache().get(issuer) ?? { keys: [], fetchedAt: 0 };
  if (now - entry.fetchedAt < REFRESH_MS && entry.keys.length > 0) return;

  let published: { keys?: { n?: string; kty?: string }[] };
  try {
    const response = await fetchImpl(provider.jwksUri);
    if (!response.ok) return;
    published = (await response.json()) as typeof published;
  } catch {
    // Unreachable JWKS. Keep the window as it is rather than emptying it —
    // a network blip must not lock every reader out, and the retention bound
    // already limits how stale this can get.
    return;
  }

  for (const key of published.keys ?? []) {
    if (key.kty !== "RSA" || !key.n) continue;
    const existing = entry.keys.find((candidate) => candidate.n === key.n);
    if (existing) existing.lastSeen = now;
    else entry.keys.push({ n: key.n, lastSeen: now });
  }

  entry.keys = entry.keys.filter((key) => now - key.lastSeen <= RETENTION_MS);
  entry.fetchedAt = now;
  cache().set(issuer, entry);
}

/** Seeds the window directly. Used by tests and by an offline deployment. */
export function seedProviderKeys(
  issuer: string,
  moduli: string[],
  now: number = Date.now(),
): void {
  cache().set(issuer, {
    keys: moduli.map((n) => ({ n, lastSeen: now })),
    fetchedAt: now,
  });
}

export function clearProviderKeys(): void {
  cache().clear();
}

/**
 * True when these chunks are a modulus the provider is currently signing with.
 *
 * Compared chunk-by-chunk against every key in the window rather than by
 * reconstructing a number, so a malformed or short-padded modulus cannot
 * compare equal to a real one by accident.
 */
export function isAcceptedModulus(
  issuer: string,
  chunks: bigint[],
  now: number = Date.now(),
): boolean {
  const entry = cache().get(issuer);
  if (!entry) return false;

  for (const key of entry.keys) {
    if (now - key.lastSeen > RETENTION_MS) continue;
    const expected = modulusToChunks(key.n);
    if (expected.length !== chunks.length) continue;
    if (expected.every((limb, index) => limb === chunks[index])) return true;
  }
  return false;
}

/** The window's current contents, for the published parameters endpoint. */
export function windowSize(issuer: string): number {
  return cache().get(issuer)?.keys.length ?? 0;
}
