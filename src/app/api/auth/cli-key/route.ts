import { NextResponse } from "next/server";

import { getViewer } from "@/lib/auth/session";
import { mintRefreshKey, REFRESH_TTL_SECONDS } from "@/lib/keys/tokens";

export const dynamic = "force-dynamic";

export async function POST() {
  const viewer = await getViewer();
  if (!viewer.sub) {
    return NextResponse.json(
      { error: "Sign in first." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const key = await mintRefreshKey({ sub: viewer.sub });

  return NextResponse.json(
    {
      key,
      expiresInSeconds: REFRESH_TTL_SECONDS,
      notice:
        "This renews access for seven days and cannot be revoked — there is no blocklist, because a blocklist is state. Treat it like a password you cannot change. Rotating the platform's signing key is the only remedy, and it signs everybody out.",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
