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

export async function GET(request: Request) {
  if (!isDevOAuthEnabled()) {
    return new NextResponse("Dev OAuth is disabled.", { status: 404 });
  }

  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state") ?? "";
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
