import { cookies } from "next/headers";

import type { Tier } from "@/lib/access";
import {
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
  verifyAccessKey,
  type AccessKey,
} from "@/lib/keys/tokens";

/**
 * Reading the current reader's key.
 *
 * There is no session lookup here because there is no session store. The
 * whole of "who is this" is: read a cookie, verify a signature. If the
 * signature does not check out, or the key has expired, the reader is
 * anonymous — there is nothing else to consult.
 */

export const ACCESS_COOKIE = "receptorome_key";
export const REFRESH_COOKIE = "receptorome_renew";

export interface Viewer {
  sub: string | null;
  name: string | null;
  tier: Tier;
  cus: string | null;
  key: AccessKey | null;
  /** Seconds until the key expires. The UI renews shortly before this. */
  expiresIn: number;
}

export const ANONYMOUS: Viewer = {
  sub: null,
  name: null,
  tier: "reader",
  cus: null,
  key: null,
  expiresIn: 0,
};

export async function getViewer(): Promise<Viewer> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return ANONYMOUS;

  const key = await verifyAccessKey(token);
  if (!key) return ANONYMOUS;

  return {
    sub: key.sub,
    name: key.name ?? null,
    tier: key.tier,
    cus: key.cus ?? null,
    key,
    expiresIn: Math.max(0, key.exp - Math.floor(Date.now() / 1000)),
  };
}

/**
 * True when there is no usable access key but a refresh cookie is present.
 *
 * The access key lives fifteen minutes; the refresh key seven days. A member
 * who comes back the next day has an expired access key and a valid refresh
 * one, and nothing on a cold page load would otherwise consult the refresh
 * key — so they would appear signed out despite holding a live session. The
 * header uses this to trigger a one-shot silent refresh. Presence only: the
 * refresh key is not verified here, just noticed, so this stays cheap and
 * does no Stripe call. The refresh endpoint does the real work.
 */
export async function canResumeSession(): Promise<boolean> {
  const store = await cookies();
  if (store.get(ACCESS_COOKIE)?.value) {
    const key = await verifyAccessKey(store.get(ACCESS_COOKIE)!.value);
    if (key) return false; // already signed in
  }
  return Boolean(store.get(REFRESH_COOKIE)?.value);
}

const SHARED = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};

export function accessCookie(token: string) {
  return { name: ACCESS_COOKIE, value: token, ...SHARED, maxAge: ACCESS_TTL_SECONDS };
}

export function refreshCookie(token: string) {
  return {
    name: REFRESH_COOKIE,
    value: token,
    ...SHARED,
    maxAge: REFRESH_TTL_SECONDS,
  };
}

/**
 * Signing out clears the cookies and nothing else, because there is nothing
 * else. Note the honest consequence recorded in docs/CONTRACTS.md: a copy of
 * the key taken before signing out stays valid until it expires. Clearing a
 * cookie is not revocation, and this design has no revocation.
 */
export function clearedCookies() {
  return [
    { name: ACCESS_COOKIE, value: "", ...SHARED, maxAge: 0 },
    { name: REFRESH_COOKIE, value: "", ...SHARED, maxAge: 0 },
  ];
}
