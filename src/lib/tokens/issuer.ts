import { publicVerif, TokenChallenge, TOKEN_TYPES, Token } from "@cloudflare/privacypass-ts";

import type { DiscoveryTier } from "@/lib/access";

const { Client, Issuer, Origin, BlindRSAMode, getPublicKeyBytes } = publicVerif;


/**
 * Rotation is what makes forgetting a spend safe, and it is the reason a
 * nullifier set is a bounded exception rather than a growing record.
 *
 * A spent-token marker only has to outlive the token it marks. Once the key
 * that signed a token is retired, that token can no longer be redeemed at all,
 * so remembering it was spent buys nothing and the marker is dropped. With two
 * live epochs the set depends on the last two hours of traffic rather than on
 * all traffic ever - which is the difference between a bound and a database.
 *
 * The length itself is an open business decision, not a tuned parameter. See
 * docs/RESEARCH-NOTES.md: shortening it raises a farmer's continuous cost
 * without storing anything, which is a rare shape here, and costs honest
 * readers a shorter-lived batch.
 */
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

/**
 * Named in PERMITTED_GLOBAL_STATE. Keypairs, not people.
 *
 * Two epochs live at a time and anything older is dropped on the next mint.
 * These keys are deliberately NOT persisted: a stored signing key is storage,
 * and reaching for it is the move contract 9 says to stop at. The cost of not
 * persisting them is real and is handled on the client rather than here - see
 * keyFingerprint below and src/lib/tokens/wallet.ts.
 */
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

/**
 * Every failure returns the same null, and the caller turns it into the same
 * message.
 *
 * A redemption endpoint that distinguished "not a valid token" from "already
 * spent" from "wrong epoch" would answer questions about other people's tokens.
 * The route above it collapses all of them into one refusal for that reason;
 * anonymous-access.test.ts asserts a replay is refused rather than explained.
 */
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

/**
 * How a browser notices its batch has died without the platform storing
 * anything to tell it.
 *
 * Keypairs live in memory and are cached by epoch NUMBER, so a restart replaces
 * the keypair behind an epoch that is still listed as live. Every outstanding
 * token stops verifying while still looking current: the epoch matches, the
 * token is well formed, and nothing about it is stale. That shipped, and the
 * result was a key page reporting ten healthy tokens of which none could be
 * spent, with each search silently falling back to the identified path.
 *
 * Privacy Pass is publicly verifiable and the issuer public key is already
 * published at /api/tokens/keys, so the client can detect the rotation itself.
 * The wallet stores this fingerprint beside the batch and compares it against
 * the published set before spending. Zero platform-side storage, which is why
 * this is the fix and persisting the keys is not.
 */
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
