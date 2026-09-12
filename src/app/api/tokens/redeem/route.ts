import { NextResponse } from "next/server";

import { mintAnonymousKey, NODE_KEY_TTL_SECONDS } from "@/lib/keys/tokens";
import { redeem } from "@/lib/tokens/issuer";
import { nullifierStore } from "@/lib/tokens/nullifiers";

export const dynamic = "force-dynamic";

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
      key: await mintAnonymousKey({ discovery: result.tier }),
      tier: result.tier,
      expiresIn: NODE_KEY_TTL_SECONDS,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
