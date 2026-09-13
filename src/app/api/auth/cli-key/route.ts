import { NextResponse } from "next/server";

import { asActor } from "@/lib/actor";
import { getViewer } from "@/lib/auth/session";
import { mintRefreshKey, REFRESH_TTL_SECONDS } from "@/lib/keys/tokens";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer.sub) {
    return NextResponse.json(
      { error: "Sign in first." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  // An API/CLI caller may declare human or AI for the key they are minting; a
  // body of {"actor":"ai"} opts in, anything else stays the current session's
  // self-declaration (its own default is human). Self-reported, never checked.
  const body = (await request.json().catch(() => null)) as {
    actor?: unknown;
  } | null;
  const actor = body?.actor === undefined ? viewer.actor : asActor(body.actor);

  const key = await mintRefreshKey({ sub: viewer.sub, actor });

  return NextResponse.json(
    {
      key,
      actor,
      expiresInSeconds: REFRESH_TTL_SECONDS,
      notice:
        "This renews access for seven days and cannot be revoked — there is no blocklist, because a blocklist is state. Treat it like a password you cannot change. Rotating the platform's signing key is the only remedy, and it signs everybody out.",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
