import { NextResponse } from "next/server";

import { CHALLENGE_TTL_MS, issueChallenge } from "@/lib/zk/verify";

export const dynamic = "force-dynamic";

/**
 * A one-time nonce for an agent to sign - the browser/API half of agent login.
 *
 * It reuses the same bounded, self-expiring challenge store the proof path uses
 * (random bytes and an epoch, about nobody, capped and evicted - see verify.ts),
 * so no new process state is introduced. The agent signs this value with its key
 * and posts the signature to /api/auth/agent; a signature over a value the
 * platform just minted is what stops a captured signature being replayed.
 */
export async function POST() {
  return NextResponse.json(
    { challenge: issueChallenge(), expiresInMs: CHALLENGE_TTL_MS },
    { headers: { "cache-control": "no-store" } },
  );
}
