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

  return NextResponse.json(
    {
      sub: persona.sub,
      name: persona.name,
      email: persona.email,
      email_verified: true,
      picture: persona.picture,
      preferred_username: persona.login ?? persona.email.split("@")[0],
    },
    { headers: { "cache-control": "no-store" } },
  );
}
