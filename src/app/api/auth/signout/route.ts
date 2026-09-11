import { NextResponse } from "next/server";

import { clearedCookies } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Signing out clears the cookies, and that is the whole of it.
 *
 * There is no session to destroy. A copy of the key taken before this point
 * remains valid until it expires - at most fifteen minutes for an access key,
 * seven days for a refresh key. Clearing a cookie is not revocation, and this
 * design has none. Stated plainly rather than implied.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const response = NextResponse.redirect(new URL("/", url.origin), 303);
  for (const cookie of clearedCookies()) response.cookies.set(cookie);
  return response;
}
