import { createHash, randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import {
  isConfigured,
  providerById,
  redirectUri,
  safeNext,
} from "@/lib/auth/providers";

export const dynamic = "force-dynamic";

export const FLOW_COOKIE = "cephroom_flow";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const provider = providerById(url.searchParams.get("provider") ?? "");

  if (!provider) {
    return NextResponse.redirect(new URL("/signin?error=unknown", url.origin));
  }
  if (!isConfigured(provider)) {
    return NextResponse.redirect(
      new URL("/signin?error=unconfigured", url.origin),
    );
  }

  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const next = safeNext(url.searchParams.get("next"));

  const authorize = new URL(provider.authorizeUrl);
  authorize.searchParams.set("client_id", provider.clientId!);
  authorize.searchParams.set("redirect_uri", redirectUri(provider.id));
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", provider.scope);
  authorize.searchParams.set("state", state);

  // GitHub does not implement PKCE; sending the parameters is harmless there
  // and required for Google.
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(authorize, 302);
  response.cookies.set({
    name: FLOW_COOKIE,
    value: JSON.stringify({ p: provider.id, s: state, v: verifier, n: next }),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
  });

  return response;
}
