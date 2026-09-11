import { NextResponse } from "next/server";

import { getViewer } from "@/lib/auth/session";
import { mintServeKey, SERVE_KEY_TTL_DAYS } from "@/lib/keys/tokens";

export const dynamic = "force-dynamic";

/**
 * Issues a serve key for the signed-in contributor to paste into their node.
 *
 * POST, so it is minted on demand rather than baked into every account-page
 * render — a secret should not sit in an SSR payload the user did not ask
 * for. Nothing is stored: this signs a token for the subject the caller has
 * already proven, and forgets it. Consistent with Contract 1.
 */
export async function POST() {
  const viewer = await getViewer();
  if (!viewer.sub) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const key = await mintServeKey({
    sub: viewer.sub,
    tier: viewer.tier,
    name: viewer.name ?? undefined,
  });

  return NextResponse.json(
    { key, sub: viewer.sub, expiresInDays: SERVE_KEY_TTL_DAYS },
    { headers: { "cache-control": "no-store" } },
  );
}
