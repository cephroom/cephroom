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

  // Capacity comes from the contributor's own serving plan, asked for at
  // the moment the key is issued. It is not in the session key, because a
  // session key is a consumer's and this is the other subscription entirely.
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
