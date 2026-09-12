import { NextResponse } from "next/server";

import { noStore } from "@/lib/api/shape";

import {
  accessCookie,
  clearedCookies,
  REFRESH_COOKIE,
  refreshCookie,
} from "@/lib/auth/session";
import {
  mintAccessKey,
  mintRefreshKey,
  verifyRefreshKey,
} from "@/lib/keys/tokens";
import { entitlementFor } from "@/lib/stripe/entitlement";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = request.headers
    .get("cookie")
    ?.split("; ")
    .find((part) => part.startsWith(`${REFRESH_COOKIE}=`))
    ?.slice(REFRESH_COOKIE.length + 1);

  if (!token) {
    return noStore(NextResponse.json({ tier: "reader", signedIn: false }));
  }

  const key = await verifyRefreshKey(token);
  if (!key) {
    const response = noStore(
      NextResponse.json({ tier: "reader", signedIn: false }),
    );
    for (const cookie of clearedCookies()) response.cookies.set(cookie);
    return response;
  }

  let tier: "reader" | "member" | "lab" = "reader";
  try {
    tier = (await entitlementFor(key.sub)).tier;
  } catch {
    // Stripe unreachable. Renew at the free tier rather than signing the
    // reader out, and let the next renewal fix it.
    tier = "reader";
  }

  const response = noStore(NextResponse.json({ tier, signedIn: true }));
  response.cookies.set(accessCookie(await mintAccessKey({ sub: key.sub, tier })));
  response.cookies.set(refreshCookie(await mintRefreshKey({ sub: key.sub })));
  return response;
}
