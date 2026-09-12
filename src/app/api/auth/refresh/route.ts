import { NextResponse } from "next/server";

import { noStore } from "@/lib/api/shape";

import type { DiscoveryTier } from "@/lib/access";
import {
  accessCookie,
  ACCESS_COOKIE,
  clearedCookies,
  REFRESH_COOKIE,
  refreshCookie,
} from "@/lib/auth/session";
import {
  mintAccessKey,
  mintRefreshKey,
  verifyAccessKey,
  verifyRefreshKey,
} from "@/lib/keys/tokens";
import { entitlementFor } from "@/lib/stripe/entitlement";
import { tierOnRenewal } from "@/lib/stripe/renewal";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = request.headers
    .get("cookie")
    ?.split("; ")
    .find((part) => part.startsWith(`${REFRESH_COOKIE}=`))
    ?.slice(REFRESH_COOKIE.length + 1);

  if (!token) {
    return noStore(NextResponse.json({ discovery: "browse", signedIn: false }));
  }

  const key = await verifyRefreshKey(token);
  if (!key) {
    const response = noStore(
      NextResponse.json({ discovery: "browse", signedIn: false }),
    );
    for (const cookie of clearedCookies()) response.cookies.set(cookie);
    return response;
  }

  const existing = request.headers
    .get("cookie")
    ?.split("; ")
    .find((part) => part.startsWith(`${ACCESS_COOKIE}=`))
    ?.slice(ACCESS_COOKIE.length + 1);
  const current = existing
    ? ((await verifyAccessKey(existing))?.discovery ?? null)
    : null;

  let fromStripe: DiscoveryTier | null = null;
  try {
    fromStripe = (await entitlementFor(key.sub)).discovery;
  } catch {
    fromStripe = null;
  }

  const discovery = tierOnRenewal({ fromStripe, current });

  const response = noStore(NextResponse.json({ discovery, signedIn: true }));
  response.cookies.set(accessCookie(await mintAccessKey({ sub: key.sub, discovery })));
  response.cookies.set(refreshCookie(await mintRefreshKey({ sub: key.sub })));
  return response;
}
