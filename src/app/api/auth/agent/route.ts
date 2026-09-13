import { NextResponse } from "next/server";

import { noStore } from "@/lib/api/shape";
import type { DiscoveryTier } from "@/lib/access";
import { verifyAgentSignature } from "@/lib/auth/agent";
import { accessCookie, refreshCookie } from "@/lib/auth/session";
import { agentSubject, mintAccessKey, mintRefreshKey } from "@/lib/keys/tokens";
import { entitlementFor } from "@/lib/stripe/entitlement";
import { forgetChallenge, knownChallenge } from "@/lib/zk/verify";

export const dynamic = "force-dynamic";

/**
 * Agent login: prove control of a key, get a key - no email, contract 3.
 *
 * This is the agent counterpart to the OAuth callback. Instead of an account
 * round-trip it takes {publicKey, challenge, signature}: the challenge must be
 * one this platform issued and has not been spent, and the signature must verify
 * against the public key. Then the subject is derived from that key (agentSubject
 * -> a_...), entitlement is read fresh from Stripe for it, and access + refresh
 * keys are minted with a self-declared actor of "ai".
 *
 * It works the same from a browser (WebCrypto) and a script (any crypto lib):
 * the browser gets cookies set, and the JSON body returns the refresh key so a
 * headless agent can store it and skip the round-trip next time. Nothing about
 * the agent is stored here; the a_ subject is re-derived from the key each login.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    publicKey?: unknown;
    challenge?: unknown;
    signature?: unknown;
  } | null;

  const publicKey = typeof body?.publicKey === "string" ? body.publicKey : "";
  const challenge = typeof body?.challenge === "string" ? body.challenge : "";
  const signature = typeof body?.signature === "string" ? body.signature : "";

  if (!publicKey || !challenge || !signature || publicKey.length > 1024) {
    return noStore(
      NextResponse.json({ error: "Malformed agent login." }, { status: 400 }),
    );
  }

  if (!knownChallenge(challenge)) {
    return noStore(
      NextResponse.json(
        { error: "Unknown or expired challenge. Ask for a fresh one." },
        { status: 400 },
      ),
    );
  }

  if (
    !verifyAgentSignature({
      publicKeySpkiBase64: publicKey,
      challenge,
      signatureBase64: signature,
    })
  ) {
    return noStore(
      NextResponse.json(
        { error: "The signature did not verify for that key." },
        { status: 401 },
      ),
    );
  }

  // Single-use: a captured signature cannot be replayed.
  forgetChallenge(challenge);

  const sub = agentSubject(publicKey);

  let discovery: DiscoveryTier = "browse";
  try {
    discovery = (await entitlementFor(sub)).discovery;
  } catch {
    discovery = "browse";
  }

  const response = noStore(
    NextResponse.json({ sub, actor: "ai", discovery, signedIn: true }),
  );
  response.cookies.set(
    accessCookie(await mintAccessKey({ sub, discovery, actor: "ai" })),
  );
  response.cookies.set(
    refreshCookie(await mintRefreshKey({ sub, actor: "ai" })),
  );
  return response;
}
