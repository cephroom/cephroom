import { NextResponse } from "next/server";

import { CHALLENGE_TTL_MS, issueChallenge } from "@/lib/zk/verify";

export const dynamic = "force-dynamic";

/**
 * Issues a challenge for a sign-in that will be proved rather than told.
 *
 * Unauthenticated, because the caller has no identity yet — that is the whole
 * point — and because a challenge that depended on who asked would let the
 * platform recognise the proof that came back.
 *
 * The value is 32 random bytes with no structure. It names no resource, so a
 * prover handed one learns nothing about what the user intends to do with the
 * proof, and the platform learns nothing from its return beyond "somebody
 * answered this one".
 */
export async function POST() {
  return NextResponse.json(
    { challenge: issueChallenge(), expiresInMs: CHALLENGE_TTL_MS },
    { headers: { "cache-control": "no-store" } },
  );
}
