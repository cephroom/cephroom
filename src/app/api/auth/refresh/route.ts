import { NextResponse } from "next/server";

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
    return NextResponse.json({ tier: "reader", signedIn: false });
  }

  const key = await verifyRefreshKey(token);
  if (!key) {
    const response = NextResponse.json({ tier: "reader", signedIn: false });
    for (const cookie of clearedCookies()) response.cookies.set(cookie);
    return response;
  }

  let tier: "reader" | "member" | "lab" = "reader";
  let customerId = key.cus ?? null;
  try {
    const entitlement = await entitlementFor(key.sub);
    tier = entitlement.tier;
    customerId = entitlement.customerId ?? customerId;
  } catch {
    // Stripe unreachable. Renew at the free tier rather than signing the
    // reader out, and let the next renewal fix it.
    tier = "reader";
  }

  const response = NextResponse.json({ tier, signedIn: true });
  response.cookies.set(
    accessCookie(
      await mintAccessKey({
        sub: key.sub,
        tier,
        cus: customerId ?? undefined,
        name: key.name,
      }),
    ),
  );
  response.cookies.set(
    refreshCookie(
      await mintRefreshKey({
        sub: key.sub,
        cus: customerId ?? undefined,
        name: key.name,
      }),
    ),
  );
  return response;
}
