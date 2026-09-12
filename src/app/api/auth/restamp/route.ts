import { NextResponse } from "next/server";

import { noStore } from "@/lib/api/shape";

import { safeNext } from "@/lib/auth/providers";
import { accessCookie, ACCESS_COOKIE } from "@/lib/auth/session";
import { mintAccessKey, verifyAccessKey } from "@/lib/keys/tokens";
import { entitlementFor } from "@/lib/stripe/entitlement";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  const response = noStore(NextResponse.redirect(new URL(next, url.origin), 303));

  const token = request.headers
    .get("cookie")
    ?.split("; ")
    .find((part) => part.startsWith(`${ACCESS_COOKIE}=`))
    ?.slice(ACCESS_COOKIE.length + 1);

  if (!token) return response;

  const key = await verifyAccessKey(token);
  // An anonymous key has no subject to ask Stripe about, and nothing to
  // re-stamp: it was minted against a token, not against a subscription.
  if (!key?.sub) return response;

  const sub = key.sub;

  try {
    const entitlement = await entitlementFor(sub);
    response.cookies.set(
      accessCookie(await mintAccessKey({ sub, discovery: entitlement.discovery })),
    );
  } catch {
    // Stripe unreachable. Leave the existing key alone; it renews on its own
    // schedule and will pick the change up then.
  }

  return response;
}
