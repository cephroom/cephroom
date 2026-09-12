import { NextResponse } from "next/server";

import { getViewer } from "@/lib/auth/session";
import { mintServeKey, SERVE_KEY_TTL_DAYS } from "@/lib/keys/tokens";
import { entitlementFor } from "@/lib/stripe/entitlement";
import { SERVING_CAPACITY } from "@/lib/stripe/plans";

export const dynamic = "force-dynamic";

export async function POST() {
  const viewer = await getViewer();
  if (!viewer.sub) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const { serving } = await entitlementFor(viewer.sub);
  const key = await mintServeKey({
    sub: viewer.sub,
    capacity: SERVING_CAPACITY[serving],
  });

  return NextResponse.json(
    {
      key,
      sub: viewer.sub,
      capacity: SERVING_CAPACITY[serving],
      plan: serving,
      expiresInDays: SERVE_KEY_TTL_DAYS,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
