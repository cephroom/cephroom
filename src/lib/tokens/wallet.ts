"use client";

import {
  buildRequests,
  BATCH_SIZE,
  finalizeBatch,
  keyFingerprint,
  type PublishedKey,
  type TokenTier,
} from "./issuer";


const STORAGE_KEY = "cephroom.tokens.v1";

interface Wallet {
  tier: TokenTier;
  tokens: string[];
  epoch: number;
  issuer?: string;
}

export interface WalletHealth {
  holding: number;
  usable: number;
  stale: boolean;
}

export type SpendOutcome =
  | { kind: "spent"; key: string; tier: TokenTier }
  | { kind: "empty" }
  | { kind: "stale" }
  | { kind: "refused" }
  | { kind: "unreachable" };

function read(): Wallet | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Wallet;
    if (!Array.isArray(parsed.tokens)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function write(wallet: Wallet | null): void {
  try {
    if (wallet === null || wallet.tokens.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(wallet));
  } catch {
  }
}

export function walletCount(): number {
  return read()?.tokens.length ?? 0;
}

export function clearWallet(): void {
  write(null);
}

async function publishedKeys(): Promise<PublishedKey[]> {
  const response = await fetch("/api/tokens/keys");
  const body = (await response.json()) as { keys: PublishedKey[] };
  return body.keys;
}

async function liveFingerprints(): Promise<Set<string>> {
  const keys = await publishedKeys();
  const out = new Set<string>();
  for (const key of keys) out.add(await keyFingerprint(key.publicKey));
  return out;
}

async function isStale(wallet: Wallet): Promise<boolean> {
  if (!wallet.issuer) return true;
  const live = await liveFingerprints();
  return !live.has(wallet.issuer);
}

/**
 * Reports usable separately from holding, because they came apart in practice.
 *
 * The key page used to render a count of tokens held and call it stock. When
 * the issuer key behind them was retired that number stayed cheerfully
 * accurate about the wrong thing, and a reader had no way to know their
 * searches had gone back to arriving with their subscription attached.
 *
 * When the published key set is unreachable this reports the holding as usable
 * rather than blocking - an outage should not make the product unusable - so
 * "usable" means "not known to be dead". That weaker claim is stated on
 * /privacy rather than smoothed over.
 */
export async function walletHealth(): Promise<WalletHealth> {
  const wallet = read();
  const holding = wallet?.tokens.length ?? 0;
  if (!wallet || holding === 0) {
    return { holding: 0, usable: 0, stale: false };
  }

  let stale: boolean;
  try {
    stale = await isStale(wallet);
  } catch {
    return { holding, usable: holding, stale: false };
  }

  return { holding, usable: stale ? 0 : holding, stale };
}

export async function stockUp(): Promise<
  { ok: true; count: number } | { ok: false; error: string }
> {
  let keys: PublishedKey[];
  try {
    keys = await publishedKeys();
  } catch {
    return { ok: false, error: "Could not reach the issuer directory." };
  }

  const newest = [...keys].sort((a, b) => b.epoch - a.epoch);
  if (newest.length === 0) {
    return { ok: false, error: "No issuer keys are published." };
  }

  for (const key of newest) {
    const publicKeyBytes = Uint8Array.from(
      atob(key.publicKey)
        .split("")
        .map((character) => character.charCodeAt(0)),
    );

    const { clients, requests } = await buildRequests(
      publicKeyBytes,
      BATCH_SIZE,
    );

    const response = await fetch("/api/tokens/issue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requests }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (response.status === 403) {
        return { ok: false, error: body?.error ?? "Not a subscriber." };
      }
      continue;
    }

    const issued = (await response.json()) as {
      epoch: number;
      tier: TokenTier;
      responses: string[];
    };

    if (issued.tier !== key.tier) continue;

    const tokens = await finalizeBatch(clients, issued.responses);
    write({
      tier: issued.tier,
      tokens,
      epoch: issued.epoch,
      issuer: await keyFingerprint(key.publicKey),
    });
    return { ok: true, count: tokens.length };
  }

  return { ok: false, error: "No key would sign for this account." };
}

/**
 * The token is removed only after redemption has actually succeeded.
 *
 * This popped first and returned null on failure, which is how a dead batch
 * became invisible: every search consumed a token, failed quietly, and fell
 * through to the identified path, so the wallet drained while reporting health
 * and the mechanism that severs paying from searching degraded into the thing
 * it prevents.
 *
 * The outcomes are distinguished because they need different answers. An
 * unreachable platform keeps the token, since nothing is known to be wrong with
 * it. A refusal drops that one token, since it is worthless and retrying it
 * would loop. A stale batch is discarded whole without a redemption attempt at
 * all - there is nothing to learn from spending one, and trying would leak a
 * redemption attempt for a token that cannot work.
 *
 * Callers must surface anything that is not "spent". The reader is told after
 * the query has gone rather than before, which is a real residual and is on
 * /privacy in those words.
 */
export async function spendToken(): Promise<SpendOutcome> {
  const wallet = read();
  if (!wallet || wallet.tokens.length === 0) return { kind: "empty" };

  try {
    if (await isStale(wallet)) {
      write(null);
      return { kind: "stale" };
    }
  } catch {
    return { kind: "unreachable" };
  }

  const [token, ...rest] = wallet.tokens;

  let response: Response;
  try {
    response = await fetch("/api/tokens/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({ token }),
    });
  } catch {
    return { kind: "unreachable" };
  }

  if (!response.ok) {
    write({ ...wallet, tokens: rest });
    return { kind: "refused" };
  }

  let body: { key: string; tier: TokenTier };
  try {
    body = (await response.json()) as { key: string; tier: TokenTier };
  } catch {
    return { kind: "unreachable" };
  }

  write({ ...wallet, tokens: rest });
  return { kind: "spent", key: body.key, tier: body.tier };
}
