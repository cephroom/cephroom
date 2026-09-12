
export const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

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
  n: string;
  lastSeen: number;
}

const globalForJwks = globalThis as unknown as {
  __cephroomJwks?: Map<string, { keys: SeenKey[]; fetchedAt: number }>;
};

function cache() {
  globalForJwks.__cephroomJwks ??= new Map();
  return globalForJwks.__cephroomJwks;
}

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

export function windowSize(issuer: string): number {
  return cache().get(issuer)?.keys.length ?? 0;
}
