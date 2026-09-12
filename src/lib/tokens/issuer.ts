import { publicVerif, TokenChallenge, TOKEN_TYPES, Token } from "@cloudflare/privacypass-ts";

import type { DiscoveryTier } from "@/lib/access";

const { Client, Issuer, Origin, BlindRSAMode, getPublicKeyBytes } = publicVerif;


export const EPOCH_SECONDS = 60 * 60;

export const LIVE_EPOCHS = 2;

export const TOKEN_TIERS = ["query", "sweep"] as const;
export type TokenTier = (typeof TOKEN_TIERS)[number];

export const ISSUER_NAME = "cephroom";
const ORIGIN_INFO = ["cephroom"];

export const BATCH_SIZE = 12;

export function currentEpoch(now: number = Date.now()): number {
  return Math.floor(now / 1000 / EPOCH_SECONDS);
}

export function liveEpochs(now: number = Date.now()): number[] {
  const current = currentEpoch(now);
  return Array.from({ length: LIVE_EPOCHS }, (_, index) => current - index);
}

interface EpochKey {
  tier: TokenTier;
  epoch: number;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyBytes: Uint8Array;
}

const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: "RSA-PSS",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-384",
};

const globalForKeys = globalThis as unknown as {
  __cephroomIssuerKeys?: Map<string, Promise<EpochKey>>;
};

function keyCache(): Map<string, Promise<EpochKey>> {
  globalForKeys.__cephroomIssuerKeys ??= new Map();
  return globalForKeys.__cephroomIssuerKeys;
}

async function epochKey(tier: TokenTier, epoch: number): Promise<EpochKey> {
  const id = `${tier}:${epoch}`;
  const cache = keyCache();

  const existing = cache.get(id);
  if (existing) return existing;

  const generating = (async () => {
    const { privateKey, publicKey } = await Issuer.generateKey(
      BlindRSAMode.PSS,
      RSA_PARAMS,
    );
    return {
      tier,
      epoch,
      privateKey,
      publicKey,
      publicKeyBytes: await getPublicKeyBytes(publicKey),
    };
  })();

  cache.set(id, generating);

  const oldest = epoch - LIVE_EPOCHS + 1;
  for (const cached of [...cache.keys()]) {
    const cachedEpoch = Number.parseInt(cached.split(":")[1] ?? "", 10);
    if (Number.isFinite(cachedEpoch) && cachedEpoch < oldest) cache.delete(cached);
  }

  return generating;
}


export interface PublishedKey {
  tier: TokenTier;
  epoch: number;
  publicKey: string;
  tokenType: number;
}

export async function publishedKeys(
  now: number = Date.now(),
): Promise<PublishedKey[]> {
  const out: PublishedKey[] = [];
  for (const epoch of liveEpochs(now)) {
    for (const tier of TOKEN_TIERS) {
      const key = await epochKey(tier, epoch);
      out.push({
        tier,
        epoch,
        publicKey: Buffer.from(key.publicKeyBytes).toString("base64"),
        tokenType: TOKEN_TYPES.BLIND_RSA.value,
      });
    }
  }
  return out;
}


export async function issueBatch(
  tier: TokenTier,
  blindedRequests: Uint8Array[],
  now: number = Date.now(),
): Promise<{ epoch: number; responses: string[] }> {
  const epoch = currentEpoch(now);
  const key = await epochKey(tier, epoch);
  const issuer = new Issuer(
    BlindRSAMode.PSS,
    ISSUER_NAME,
    key.privateKey,
    key.publicKey,
  );

  const responses: string[] = [];
  for (const serialized of blindedRequests) {
    const request = publicVerif.TokenRequest.deserialize(
      TOKEN_TYPES.BLIND_RSA,
      serialized,
    );
    const response = await issuer.issue(request);
    responses.push(Buffer.from(response.serialize()).toString("base64"));
  }

  return { epoch, responses };
}


export interface Redemption {
  tier: TokenTier;
  epoch: number;
  nullifier: string;
}

export async function redeem(
  serializedToken: Uint8Array,
  now: number = Date.now(),
): Promise<Redemption | null> {
  let token: Token;
  try {
    token = Token.deserialize(TOKEN_TYPES.BLIND_RSA, serializedToken);
  } catch {
    return null;
  }

  const origin = new Origin(BlindRSAMode.PSS, ORIGIN_INFO);

  for (const epoch of liveEpochs(now)) {
    for (const tier of TOKEN_TIERS) {
      const key = await epochKey(tier, epoch);
      let ok = false;
      try {
        ok = await origin.verify(token, key.publicKey);
      } catch {
        ok = false;
      }
      if (!ok) continue;

      return { tier, epoch, nullifier: await nullifierFor(token) };
    }
  }

  return null;
}

export const ISSUER_FINGERPRINT_CHARS = 32;

export async function keyFingerprint(publicKeyBase64: string): Promise<string> {
  const bytes = Uint8Array.from(Buffer.from(publicKeyBase64, "base64"));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as BufferSource,
  );
  return Buffer.from(digest).toString("hex").slice(0, ISSUER_FINGERPRINT_CHARS);
}

export async function nullifierFor(token: Token): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    token.authInput.nonce as unknown as BufferSource,
  );
  return Buffer.from(digest).toString("hex");
}


export async function buildRequests(
  publicKeyBytes: Uint8Array,
  count: number = BATCH_SIZE,
): Promise<{ clients: InstanceType<typeof Client>[]; requests: string[] }> {
  const challenge = new TokenChallenge(
    TOKEN_TYPES.BLIND_RSA.value,
    ISSUER_NAME,
    new Uint8Array(32),
    ORIGIN_INFO,
  );

  const clients: InstanceType<typeof Client>[] = [];
  const requests: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const client = new Client(BlindRSAMode.PSS);
    const request = await client.createTokenRequest(challenge, publicKeyBytes);
    clients.push(client);
    requests.push(Buffer.from(request.serialize()).toString("base64"));
  }

  return { clients, requests };
}

export async function finalizeBatch(
  clients: InstanceType<typeof Client>[],
  responses: string[],
): Promise<string[]> {
  const tokens: string[] = [];
  for (let index = 0; index < clients.length && index < responses.length; index += 1) {
    const bytes = Uint8Array.from(Buffer.from(responses[index], "base64"));
    const response = publicVerif.TokenResponse.deserialize(bytes);
    const token = await clients[index].finalize(response);
    tokens.push(Buffer.from(token.serialize()).toString("base64"));
  }
  return tokens;
}

export function tokenTierFor(tier: DiscoveryTier): TokenTier | null {
  return tier === "query" || tier === "sweep" ? tier : null;
}
