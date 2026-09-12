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

  const key = await mintRefreshKey({
    sub: viewer.sub,
    cus: viewer.cus ?? undefined,
    name: viewer.name ?? undefined,
  });

  return NextResponse.json(
    {
      key,
      expiresInSeconds: REFRESH_TTL_SECONDS,
      // Said here as well as in the docs, because this value is about to be
      // pasted somewhere and the person pasting it should know what it is.
      notice:
        "This renews access for seven days and cannot be revoked — there is no blocklist, because a blocklist is state. Treat it like a password you cannot change. Rotating the platform's signing key is the only remedy, and it signs everybody out.",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
