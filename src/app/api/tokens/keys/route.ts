import { NextResponse } from "next/server";

import { publishedKeys } from "@/lib/tokens/issuer";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { keys: await publishedKeys() },
    { headers: { "cache-control": "no-store" } },
  );
}
