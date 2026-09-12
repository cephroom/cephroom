import { NextResponse } from "next/server";

import { ACCESS_AUDIENCE, ISSUER, publicKeyPem } from "@/lib/keys/tokens";

export const dynamic = "force-dynamic";

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
