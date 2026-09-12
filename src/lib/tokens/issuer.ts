import { publicVerif, TokenChallenge, TOKEN_TYPES, Token } from "@cloudflare/privacypass-ts";

import type { Tier } from "@/lib/access";

const { Client, Issuer, Origin, BlindRSAMode, getPublicKeyBytes } = publicVerif;

/**
 * Anonymous access tokens — Layer 1.
 *
 * ## The weakness this closes
 *
 * Signing in with Google gives the platform a Google identity, from which a
 * stable pseudonymous subject is derived. That subject then rides on every
 * request. Nothing is written down, and the contract tests check that nothing
 * is written down — but the platform is *capable* of linking one person's
 * reading across sessions, and declines to. A promise enforced by tests is
 * weaker than a property enforced by arithmetic.
 *
 * So: paying and reading are severed. A subscriber's browser asks for a batch
 * of tokens, the platform blind-signs them **without being able to see what it
 * is signing**, and later the browser redeems one for a short-lived access key
 * that carries a tier and no subject at all. The platform cannot associate a
 * redemption with the issuance that produced it, because RFC 9474 says it
 * cannot: the blinding factor is the client's and never leaves the browser.
 *
 * ## Why this scheme and not another
 *
 * Privacy Pass, IETF: RFC 9576 (architecture), RFC 9577 (token structure),
 * RFC 9578 (issuance). Implemented by `@cloudflare/privacypass-ts`, from the
 * people who wrote the RFCs. Nothing here is a home-made blinding scheme.
 *
 * Of the two token types, this uses **type 0x0002, blind RSA — the publicly
 * verifiable one** — for the same reason the capability keys are Ed25519 and
 * not an HMAC: a contributor's node has to be able to verify what a reader
 * presents using a public key alone. A privately verifiable token (type
 * 0x0001, VOPRF) would put the platform back in the request path.
 *
 * ## How a token carries a tier without carrying a payload
 *
 * A Privacy Pass token has no payload — that is most of the point. So the tier
 * is **which key signed it**. One keypair per (tier, epoch), and verification
 * tries the live keys in turn; the one that verifies names the tier.
 *
 * The cost is honest and small: an observer who sees a redemption learns which
 * tier it was for, because it had to try the Lab key and succeed. It learns
 * nothing about who, and that is the property being bought.
 *
 * ## Epochs, and why keys live in RAM
 *
 * Keys rotate hourly, and the previous epoch's key stays live so a token in
 * flight is not invalidated mid-read. Two live epochs, so the nullifier set
 * has a two-hour lifetime rather than an unbounded one — that bound is the
 * whole reason for epochs.
 *
 * The keypairs are generated at first use and held in memory. A restart
 * invalidates outstanding tokens, and a client that gets a rejection asks for
 * a fresh batch. That is a real cost, accepted, and it follows from bend #4 in
 * docs/CONTRACTS.md: the platform already has to run as one long-lived
 * process, because the presence registry is per-process. Persisting issuer
 * keys would be the smallest possible database, and this design does not get
 * to have one of those.
 */

/** Hourly. Short enough to bound the nullifier set, long enough to be usable. */
export const EPOCH_SECONDS = 60 * 60;

/** Current plus previous. A token is valid for between one and two hours. */
export const LIVE_EPOCHS = 2;

/** Tiers a token can be issued for. Reader needs no token; nothing is gated. */
export const TOKEN_TIERS = ["member", "lab"] as const;
export type TokenTier = (typeof TOKEN_TIERS)[number];

export const ISSUER_NAME = "cephroom";
const ORIGIN_INFO = ["cephroom"];

/** How many tokens one issuance hands out. See the note on batch size below. */
export const BATCH_SIZE = 12;

export function currentEpoch(now: number = Date.now()): number {
  return Math.floor(now / 1000 / EPOCH_SECONDS);
}

/** The epochs whose keys still verify, newest first. */
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
 * Per-process key material.
 *
 * On globalThis for the same reason the nullifier store is: Next re-evaluates
 * modules in development, and keys that regenerated on every hot reload would
 * make every outstanding token invalid in the one environment where somebody
 * is watching.
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

  // Cache the promise rather than the result, so two concurrent issuances in
  // the same epoch cannot generate two different keypairs and leave half the
  // outstanding tokens unverifiable.
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

  // Retire keys whose epoch has fallen out of the window. Dropping the key is
  // what makes the matching nullifier bucket safe to drop: a token signed by a
  // key that no longer exists cannot be replayed, so nothing needs to remember
  // that it was spent.
  const oldest = epoch - LIVE_EPOCHS + 1;
  for (const cached of [...cache.keys()]) {
    const cachedEpoch = Number.parseInt(cached.split(":")[1] ?? "", 10);
    if (Number.isFinite(cachedEpoch) && cachedEpoch < oldest) cache.delete(cached);
  }

  return generating;
}

/* ------------------------------------------------------------------ *
 * The public directory
 * ------------------------------------------------------------------ */

export interface PublishedKey {
  tier: TokenTier;
  epoch: number;
  /** Base64 SubjectPublicKeyInfo, as a client needs it to blind a request. */
  publicKey: string;
  tokenType: number;
}

/**
 * The keys a client may request tokens against, and a node may verify with.
 *
 * Published for every live epoch and every tier — including tiers the caller
 * is not entitled to, because the directory is fetched anonymously and a
 * directory that varied by caller would leak the caller's tier before they
 * had spent anything.
 */
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

/* ------------------------------------------------------------------ *
 * Issuance
 * ------------------------------------------------------------------ */

/**
 * Blind-signs a batch of token requests for a tier.
 *
 * Everything the platform sees here is a blinded message. It cannot compute
 * the token that will come out, so it cannot recognise it later — which is the
 * entire mechanism, and the reason this function does not, and must not, take
 * a subject. The caller has already proved entitlement; who they are is not
 * this function's business and is deliberately not in its signature.
 */
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

/* ------------------------------------------------------------------ *
 * Redemption
 * ------------------------------------------------------------------ */

export interface Redemption {
  tier: TokenTier;
  epoch: number;
  /** Hex SHA-256 of the token's nonce. The only thing ever remembered. */
  nullifier: string;
}

/**
 * Verifies a presented token and says what it is worth.
 *
 * Tries every live (tier, epoch) key. Whichever verifies names the tier — a
 * token has no payload, so the signing key *is* the payload.
 *
 * Returns null for anything that verifies against nothing, without
 * distinguishing "expired epoch" from "forged" from "malformed", because
 * telling the two apart is a service to somebody probing the endpoint and of
 * no use to an honest client, which simply asks for a fresh batch.
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

/**
 * The nullifier: SHA-256 of the token's nonce.
 *
 * The nonce is 32 random bytes the client generated and never sent in the
 * clear before this moment — it was inside the blinded message. Hashing it is
 * belt and braces rather than necessity, and costs nothing.
 *
 * Note what is *not* hashed in: no time beyond the epoch the entry lands in,
 * no address, no tier. A nullifier has to be the same value on a second
 * presentation of the same token and different for every other token. That is
 * its whole specification, and anything else mixed in would be information the
 * store was not asked to hold.
 */
export async function nullifierFor(token: Token): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    token.authInput.nonce as unknown as BufferSource,
  );
  return Buffer.from(digest).toString("hex");
}

/* ------------------------------------------------------------------ *
 * The client half, exported so tests and the browser share one path
 * ------------------------------------------------------------------ */

/**
 * Builds a batch of blinded token requests.
 *
 * Runs in the reader's browser. The blinding factors stay in `clients` and are
 * never transmitted; without them the returned signatures cannot be unblinded,
 * which is why the platform cannot precompute what it is about to sign.
 */
export async function buildRequests(
  publicKeyBytes: Uint8Array,
  count: number = BATCH_SIZE,
): Promise<{ clients: InstanceType<typeof Client>[]; requests: string[] }> {
  const challenge = new TokenChallenge(
    TOKEN_TYPES.BLIND_RSA.value,
    ISSUER_NAME,
    // A zero redemption context. A per-issuance random context would let the
    // platform mark a batch and recognise it at redemption, which is the
    // linkage this whole design exists to remove.
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

/** Unblinds the platform's signatures into usable tokens. */
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

/** Narrows a tier to one tokens are issued for. Reader gets none: nothing to buy. */
export function tokenTierFor(tier: Tier): TokenTier | null {
  return tier === "member" || tier === "lab" ? tier : null;
}
