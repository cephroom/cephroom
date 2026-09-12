import { NextResponse } from "next/server";

import { getViewer } from "@/lib/auth/session";
import { mintRefreshKey, REFRESH_TTL_SECONDS } from "@/lib/keys/tokens";

export const dynamic = "force-dynamic";

/**
 * A renewal key to paste into a shell, so the API needs no browser.
 *
 * The alternative everybody expects here is an API key, and Contract 1 forbids
 * it: an API key is a stable identifier issued to a person and stored by the
 * issuer so it can be checked. This is the opposite — a signed statement the
 * holder carries, verified by signature, recorded nowhere, and expiring on its
 * own in seven days.
 *
 * It is **freshly minted**, not the one in the browser's cookie. Revealing the
 * session's own key would mean a script and a browser sharing one credential,
 * so that losing either loses both. Two keys for the same subject is fine —
 * neither is written down, so there is no list of issued keys to keep straight.
 *
 * POST, so it is never baked into a page render the user did not ask for.
 */
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
