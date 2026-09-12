import { NextResponse } from "next/server";

import {
  DEV_OAUTH_CLIENT_ID,
  DEV_PERSONAS,
  isDevOAuthEnabled,
  issueCode,
  renderConsentScreen,
} from "@simulated/google/provider";
import { NO_STORE, noStore } from "@/lib/api/shape";

export const dynamic = "force-dynamic";

/**
 * Transport only.
 *
 * The provider itself — the personas, their names and addresses, the consent
 * screen that displays them — lives under `simulated-counterparties/`,
 * because it is a stand-in for Google and Google is a counterparty. What is
 * left here is the routing: check the client, refuse an off-origin redirect,
 * and hand back whatever the provider rendered. The platform's own source
 * holds no email address, and this is the route that used to be the exception.
 */
export async function GET(request: Request) {
  if (!isDevOAuthEnabled()) {
    return new NextResponse("Dev OAuth is disabled.", { status: 404 });
  }

  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state") ?? "";
  // Shown on the consent screen, so the local flow displays the real scope
  // rather than a sentence somebody wrote once. It said "your name and email
  // address" for a while after the platform stopped asking for the address.
  const scope = url.searchParams.get("scope") ?? "openid";
  const chosen = url.searchParams.get("persona");

  if (clientId !== DEV_OAUTH_CLIENT_ID) {
    return new NextResponse("unauthorized_client", { status: 400 });
  }
  if (!redirectUri) {
    return new NextResponse("invalid_request: redirect_uri required", {
      status: 400,
    });
  }

  // Only ever redirect back to this origin. A dev tool is still a redirector.
  const target = new URL(redirectUri);
  if (target.origin !== url.origin) {
    return new NextResponse("invalid_request: redirect_uri origin mismatch", {
      status: 400,
    });
  }

  if (chosen) {
    const persona = DEV_PERSONAS.find((p) => p.sub === chosen);
    if (!persona) {
      return new NextResponse("access_denied", { status: 400 });
    }
    const code = issueCode(persona, redirectUri);
    target.searchParams.set("code", code);
    if (state) target.searchParams.set("state", state);
    // The authorization code is in the location. A cached redirect is a
    // reusable code, which is the one thing a code must not be.
    return noStore(NextResponse.redirect(target, 302));
  }

  return new NextResponse(
    renderConsentScreen({
      pathname: url.pathname,
      clientId,
      redirectUri,
      state,
      scope,
    }),
    { headers: { "content-type": "text/html; charset=utf-8", ...NO_STORE } },
  );
}
