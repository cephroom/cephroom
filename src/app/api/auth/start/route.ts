import { createHash, randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { noStore } from "@/lib/api/shape";

import { asActor } from "@/lib/actor";
import {
  isConfigured,
  providerById,
  redirectUri,
  safeNext,
} from "@/lib/auth/providers";

export const dynamic = "force-dynamic";

export const FLOW_COOKIE = "cephroom_flow";

/**
 * The whole in-flight authorization lives in one short-lived cookie, because
 * the alternative is a table of pending sign-ins - contract 2.
 *
 * A hand-rolled OAuth code flow needs somewhere to keep three things between
 * the redirect out and the callback back: which provider, the state value to
 * compare, and the PKCE verifier. The conventional home for those is
 * server-side session storage keyed by a session id, which is a store of who is
 * currently signing in, which is an activity record about people who have not
 * even finished arriving.
 *
 * So it goes in an httpOnly cookie with a ten-minute life: the browser carries
 * its own flow state, the platform holds none, and an abandoned sign-in expires
 * by itself rather than needing to be swept.
 *
 * The hash here is PKCE - SHA-256 of a random verifier, sent as the challenge -
 * and it is about a single authorization rather than about a person. It is
 * named in PERMITTED_HASHING for that reason: every hash in the platform is
 * enumerated, because a hash of anything about somebody is a new name for them,
 * and the way to keep that list honest is to justify even the ones that are
 * obviously fine.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const provider = providerById(url.searchParams.get("provider") ?? "");

  if (!provider) {
    return noStore(
      NextResponse.redirect(new URL("/signin?error=unknown", url.origin)),
    );
  }
  if (!isConfigured(provider)) {
    return noStore(
      NextResponse.redirect(new URL("/signin?error=unconfigured", url.origin)),
    );
  }

  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const next = safeNext(url.searchParams.get("next"));
  // The human/AI self-declaration rides through the round-trip in the same
  // short-lived flow cookie as the state and verifier, so it reaches the
  // callback without a pending-sign-ins table. asActor bounds it to the two
  // allowed words; a stranger cannot smuggle an arbitrary claim into the key.
  const actor = asActor(url.searchParams.get("actor"));

  const authorize = new URL(provider.authorizeUrl);
  authorize.searchParams.set("client_id", provider.clientId!);
  authorize.searchParams.set("redirect_uri", redirectUri(provider.id));
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", provider.scope);
  authorize.searchParams.set("state", state);

  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");

  const response = noStore(NextResponse.redirect(authorize, 302));
  response.cookies.set({
    name: FLOW_COOKIE,
    value: JSON.stringify({ p: provider.id, s: state, v: verifier, n: next, a: actor }),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
  });

  return response;
}
