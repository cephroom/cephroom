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
