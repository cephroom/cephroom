import { NextResponse } from "next/server";

import { ACCESS_AUDIENCE, ISSUER, publicKeyPem } from "@/lib/keys/tokens";

export const dynamic = "force-dynamic";

/**
 * The public half of the signing key.
 *
 * A contributor's node fetches this so it can verify a reader's capability
 * key before serving member-only content. Asymmetric signing exists for this
 * endpoint: a node can check a key without being able to mint one.
 */
export async function GET() {
  return NextResponse.json(
    {
      issuer: ISSUER,
      audience: ACCESS_AUDIENCE,
      alg: "EdDSA",
      publicKey: publicKeyPem(),
    },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
