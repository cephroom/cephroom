import { NextResponse } from "next/server";

import { isDevOAuthEnabled, issuedTokens } from "@/lib/auth/dev-oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDevOAuthEnabled()) {
    return NextResponse.json({ error: "invalid_request" }, { status: 404 });
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";

  const persona = issuedTokens.get(token);
  if (!persona) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  // No email, deliberately.
  //
  // This provider stands in for Google, and Google returns an address only
  // when the `email` scope was asked for — which, since the platform stopped
  // asking, it is not. A stand-in that answered more richly than the real
  // thing would let code grow a dependency on a field that will not be there
  // in production, which is the one failure a local counterparty is supposed
  // to prevent.
  return NextResponse.json(
    {
      sub: persona.sub,
      name: persona.name,
      picture: persona.picture,
      preferred_username: persona.login ?? persona.sub,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
