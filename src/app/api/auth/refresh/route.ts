import { NextResponse } from "next/server";

import { noStore } from "@/lib/api/shape";

import type { Tier } from "@/lib/access";
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

  // What the reader currently holds, so an outage can carry it forward
  // instead of inventing a downgrade. Reading the access cookie here is the
  // only way to know it: the refresh key deliberately carries no tier.
  const existing = request.headers
    .get("cookie")
    ?.split("; ")
    .find((part) => part.startsWith(`${ACCESS_COOKIE}=`))
    ?.slice(ACCESS_COOKIE.length + 1);
  const current = existing ? (await verifyAccessKey(existing))?.tier ?? null : null;

  let fromStripe: Tier | null = null;
  try {
    fromStripe = (await entitlementFor(key.sub)).tier;
  } catch {
    // Not "Stripe said no" — "Stripe said nothing". Treated as the same fact,
    // this demoted paying subscribers during any outage; see
    // tests/contracts/an-outage-does-not-downgrade.test.ts.
    fromStripe = null;
  }

  const tier = tierOnRenewal({ fromStripe, current });

  const response = noStore(NextResponse.json({ tier, signedIn: true }));
  response.cookies.set(accessCookie(await mintAccessKey({ sub: key.sub, tier })));
  response.cookies.set(refreshCookie(await mintRefreshKey({ sub: key.sub })));
  return response;
}
