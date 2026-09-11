import { NextResponse } from "next/server";

import { safeNext } from "@/lib/auth/providers";
import { accessCookie, ACCESS_COOKIE } from "@/lib/auth/session";
import { mintAccessKey, verifyAccessKey } from "@/lib/keys/tokens";
import { entitlementFor } from "@/lib/stripe/entitlement";

export const dynamic = "force-dynamic";

/**
 * Re-issues the access key, then continues to `next`.
 *
 * Checkout is the case this exists for. Coming back from a payment, the
 * reader still holds a key stating the tier they had before it - and because
 * the key is the session, the only way to change what they are entitled to is
 * to hand them a new one. Cookies cannot be written while rendering a page,
 * so the redirect goes through here.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  const response = NextResponse.redirect(new URL(next, url.origin), 303);

  const token = request.headers
    .get("cookie")
    ?.split("; ")
    .find((part) => part.startsWith(`${ACCESS_COOKIE}=`))
    ?.slice(ACCESS_COOKIE.length + 1);

  if (!token) return response;

  const key = await verifyAccessKey(token);
  if (!key) return response;

  try {
    const entitlement = await entitlementFor(key.sub);
    response.cookies.set(
      accessCookie(
        await mintAccessKey({
          sub: key.sub,
          tier: entitlement.tier,
          cus: entitlement.customerId ?? undefined,
          name: key.name,
        }),
      ),
    );
  } catch {
    // Stripe unreachable. Leave the existing key alone; it renews on its own
    // schedule and will pick the change up then.
  }

  return response;
}
