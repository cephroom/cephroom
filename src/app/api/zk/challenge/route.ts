import { NextResponse } from "next/server";

import { CHALLENGE_TTL_MS, issueChallenge } from "@/lib/zk/verify";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    { challenge: issueChallenge(), expiresInMs: CHALLENGE_TTL_MS },
    { headers: { "cache-control": "no-store" } },
  );
}
