import { cookies } from "next/headers";

import type { DiscoveryTier } from "@/lib/access";
import {
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
  verifyAccessKey,
  type AccessKey,
} from "@/lib/keys/tokens";


export const ACCESS_COOKIE = "cephroom_key";
export const REFRESH_COOKIE = "cephroom_renew";

const LEGACY_COOKIES = ["receptorome_key", "receptorome_renew"];

/**
 * Everything the platform knows about whoever is asking.
 *
 * A subject, their discovery plan, and when the key expires. Nothing else,
 * because there is nothing else in the key and nowhere to look it up. The
 * display name and the Stripe customer id used to be here; both were read
 * straight back out of the credential, which made them feel like facts the
 * platform held rather than data it was carrying around on someone's behalf.
 */
export interface Viewer {
  sub: string | null;
  discovery: DiscoveryTier;
  key: AccessKey | null;
  expiresIn: number;
}

export const ANONYMOUS: Viewer = {
  sub: null,
  discovery: "browse",
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
    discovery: key.discovery ?? "browse",
    key,
    expiresIn: Math.max(0, key.exp - Math.floor(Date.now() / 1000)),
  };
}

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

export function clearedCookies() {
  return [
    { name: ACCESS_COOKIE, value: "", ...SHARED, maxAge: 0 },
    { name: REFRESH_COOKIE, value: "", ...SHARED, maxAge: 0 },
    ...LEGACY_COOKIES.map((name) => ({
      name,
      value: "",
      ...SHARED,
      maxAge: 0,
    })),
  ];
}
