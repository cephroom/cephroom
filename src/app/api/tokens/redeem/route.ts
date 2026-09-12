import { NextResponse } from "next/server";

import { mintAnonymousKey, NODE_KEY_TTL_SECONDS } from "@/lib/keys/tokens";
import { redeem } from "@/lib/tokens/issuer";
import { nullifierStore } from "@/lib/tokens/nullifiers";

export const dynamic = "force-dynamic";

/**
 * Spends one access token for a short-lived, subject-less read key.
 *
 * **This endpoint is deliberately unauthenticated.** No cookie is read, and
 * one sent along anyway is ignored — the handler never calls `getViewer`. That
 * is the point of Layer 1: if the redemption carried a session, the platform
 * could put the reading back beside the paying, and the blind signature would
 * have bought nothing.
 *
 * What happens here:
 *
 *  1. The token is verified against the live issuer keys. Whichever key
 *     verifies names the tier — a Privacy Pass token has no payload, so the
 *     signing key is the payload.
 *  2. Its nullifier is spent. That is the state this design admits to holding,
 *     and `src/lib/tokens/nullifiers.ts` says exactly how much.
 *  3. A key is minted carrying a tier and no subject, because none exists.
 *
 * Failures are deliberately undifferentiated. "Expired epoch", "forged",
 * "malformed" and "already spent" are all one 400 with one message, because
 * telling them apart is a service to somebody probing the endpoint and of no
 * use to an honest client, which simply asks for a fresh batch. In particular,
 * distinguishing "already spent" would turn this endpoint into an oracle for
 * testing whether a given token has been used — which is a small linkage, and
 * small linkages are what this is for.
 */
export async function POST(request: Request) {
  const refuse = () =>
    NextResponse.json(
      { error: "This token cannot be redeemed. Ask for a fresh batch." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );

  const body = (await request.json().catch(() => null)) as {
    token?: unknown;
  } | null;

  if (typeof body?.token !== "string" || body.token.length > 1024) {
    return refuse();
  }

  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(body.token, "base64"));
  } catch {
    return refuse();
  }

  const result = await redeem(bytes);
  if (!result) return refuse();

  const { fresh } = nullifierStore().spend(result.epoch, result.nullifier);
  if (!fresh) return refuse();

  return NextResponse.json(
    {
      key: await mintAnonymousKey({ tier: result.tier }),
      tier: result.tier,
      expiresIn: NODE_KEY_TTL_SECONDS,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
