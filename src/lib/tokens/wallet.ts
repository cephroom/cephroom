"use client";

import {
  buildRequests,
  BATCH_SIZE,
  finalizeBatch,
  type PublishedKey,
  type TokenTier,
} from "./issuer";


const STORAGE_KEY = "cephroom.tokens.v1";

interface Wallet {
  tier: TokenTier;
  tokens: string[];
  epoch: number;
}

function read(): Wallet | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Wallet;
    if (!Array.isArray(parsed.tokens)) return null;
    return parsed;
  } catch {
    // Private windows, blocked site data, a corrupted value. A wallet that
    // cannot be read is a wallet that is empty, and the reader falls back to
    // their ordinary key.
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
    // Out of quota, or storage denied. Tokens held only for this page view;
    // the reader loses nothing but the next round trip.
  }
}

export function walletCount(): number {
  return read()?.tokens.length ?? 0;
}

export function clearWallet(): void {
  write(null);
}

export async function stockUp(): Promise<
  { ok: true; count: number } | { ok: false; error: string }
> {
  const directory = await fetch("/api/tokens/keys").then(
    (response) => response.json() as Promise<{ keys: PublishedKey[] }>,
  );

  // The newest key for whichever plan the issuer will sign for. The client
  // does not state its own plan here — it asks, and the issuer decides.
  const newest = [...directory.keys].sort((a, b) => b.epoch - a.epoch);
  const candidate = newest[0];
  if (!candidate) return { ok: false, error: "No issuer keys are published." };

  // Try each plan's newest key, best first: the issuer signs with the
  // discovery plan the caller actually holds, so a request blinded against
  // the Sweep key is refused for somebody on Query, and the other way round.
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
      // 403 means "not a subscriber" and is final; anything else, try the
      // next key before giving up.
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
    write({ tier: issued.tier, tokens, epoch: issued.epoch });
    return { ok: true, count: tokens.length };
  }

  return { ok: false, error: "No key would sign for this account." };
}

export async function spendToken(): Promise<
  { key: string; tier: TokenTier } | null
> {
  const wallet = read();
  if (!wallet || wallet.tokens.length === 0) return null;

  const [token, ...rest] = wallet.tokens;
  write({ ...wallet, tokens: rest });

  try {
    const response = await fetch("/api/tokens/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Deliberately no credentials. `omit` rather than the default, so the
      // session cookie is not attached even though it would be same-site —
      // the endpoint ignores it, and not sending it means it is not there to
      // be logged by anything in front of the app either.
      credentials: "omit",
      body: JSON.stringify({ token }),
    });

    if (!response.ok) return null;
    const body = (await response.json()) as { key: string; tier: TokenTier };
    return { key: body.key, tier: body.tier };
  } catch {
    return null;
  }
}
