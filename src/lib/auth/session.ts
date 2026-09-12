import { cookies } from "next/headers";

import type { Tier } from "@/lib/access";
import {
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
  verifyAccessKey,
  type AccessKey,
} from "@/lib/keys/tokens";


export const ACCESS_COOKIE = "cephroom_key";
export const REFRESH_COOKIE = "cephroom_renew";

const LEGACY_COOKIES = ["receptorome_key", "receptorome_renew"];

export interface Viewer {
  sub: string | null;
  name: string | null;
  tier: Tier;
  cus: string | null;
  key: AccessKey | null;
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
