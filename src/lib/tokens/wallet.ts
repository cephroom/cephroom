"use client";

import {
  buildRequests,
  BATCH_SIZE,
  finalizeBatch,
  type PublishedKey,
} from "./issuer";

/**
 * The reader's token wallet, in their own browser.
 *
 * Layer 1's tokens are bearer credentials and have to live somewhere between
 * being issued and being spent. The only place that can be is the reader's own
 * device: the platform storing them would defeat the entire mechanism, because
 * a stored token is a token the platform can recognise.
 *
 * So `localStorage`, with the properties that implies stated plainly rather
 * than glossed:
 *
 * - **Anyone with the device can read them.** They are bearer tokens worth one
 *   reading session each, at the tier they were issued for. That is the same
 *   exposure as the session cookie sitting beside them, and a smaller one than
 *   the refresh key, which is good for seven days.
 * - **They do not sync.** A second browser has no tokens and stocks up on its
 *   own. Which is correct: two browsers holding tokens from one subscription
 *   is exactly the thing that must not be linkable.
 * - **Clearing site data throws them away.** They are replaceable by asking
 *   for more, so nothing is lost but a round trip.
 *
 * Never sent anywhere except the redemption endpoint, one at a time.
 */

const STORAGE_KEY = "cephroom.tokens.v1";

interface Wallet {
  /** Which tier these were issued for. A downgrade makes them useless. */
  tier: "member" | "lab";
  /** Base64 serialized tokens, spent from the front. */
  tokens: string[];
  /** The issuing epoch, so a stale wallet can be discarded without a request. */
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

/**
 * Asks the platform for a batch, blinding every request in this browser first.
 *
 * The blinding factors live in `clients` and stay on this machine. Without
 * them the signatures the platform returns cannot be turned into tokens, which
 * is the reason the platform cannot precompute what it is signing.
 */
export async function stockUp(): Promise<
  { ok: true; count: number } | { ok: false; error: string }
> {
  const directory = await fetch("/api/tokens/keys").then(
    (response) => response.json() as Promise<{ keys: PublishedKey[] }>,
  );

  // The newest key for whichever tier the issuer will sign for. The client
  // does not know its own tier here — it asks, and the issuer decides.
  const newest = [...directory.keys].sort((a, b) => b.epoch - a.epoch);
  const candidate = newest[0];
  if (!candidate) return { ok: false, error: "No issuer keys are published." };

  // Try each tier's newest key, best first: the issuer signs with the tier the
  // caller is actually entitled to, so a request blinded against the lab key
  // is refused for a member and vice versa.
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
      tier: "member" | "lab";
      responses: string[];
    };

    if (issued.tier !== key.tier) continue;

    const tokens = await finalizeBatch(clients, issued.responses);
    write({ tier: issued.tier, tokens, epoch: issued.epoch });
    return { ok: true, count: tokens.length };
  }

  return { ok: false, error: "No key would sign for this account." };
}

/**
 * Spends one token for a short-lived, subject-less read key.
 *
 * Returns null when the wallet is empty or the token would not redeem, and the
 * caller falls back to the reader's ordinary key. Falling back is a downgrade
 * in privacy and never in access, which is the right way round: a reader must
 * not lose a column they paid for because a token expired.
 *
 * The spent token is removed **before** the request rather than after. A token
 * that fails to redeem is worthless anyway — it was expired, or already spent
 * — and keeping it would make the next read retry the same dead token.
 */
export async function spendToken(): Promise<
  { key: string; tier: "member" | "lab" } | null
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
    const body = (await response.json()) as {
      key: string;
      tier: "member" | "lab";
    };
    return { key: body.key, tier: body.tier };
  } catch {
    return null;
  }
}
