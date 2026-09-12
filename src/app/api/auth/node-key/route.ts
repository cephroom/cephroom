import { NextResponse } from "next/server";

import { getViewer } from "@/lib/auth/session";
import { mintServeKey, SERVE_KEY_TTL_DAYS } from "@/lib/keys/tokens";

export const dynamic = "force-dynamic";

export async function POST() {
  const viewer = await getViewer();
  if (!viewer.sub) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const key = await mintServeKey({ sub: viewer.sub, tier: viewer.tier });

  return NextResponse.json(
    { key, sub: viewer.sub, expiresInDays: SERVE_KEY_TTL_DAYS },
    { headers: { "cache-control": "no-store" } },
  );
}
