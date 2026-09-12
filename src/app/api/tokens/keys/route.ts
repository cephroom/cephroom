import { NextResponse } from "next/server";

import { publishedKeys } from "@/lib/tokens/issuer";

export const dynamic = "force-dynamic";

/**
 * The issuer's public keys, for every live epoch and every tier.
 *
 * Anonymous, uncached, and identical for everybody. It is deliberately *not*
 * filtered to the caller's tier: a directory that varied by caller would leak
 * what the caller is entitled to before they had spent a single token, which
 * is the linkage this whole mechanism exists to remove.
 *
 * A client needs these to blind a token request. A contributor's node could
 * use them to verify a presented token directly, though today it verifies the
 * short-lived key the redemption mints instead.
 */
export async function GET() {
  return NextResponse.json(
    { keys: await publishedKeys() },
    { headers: { "cache-control": "no-store" } },
  );
}
