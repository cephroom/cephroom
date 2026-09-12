import { NextResponse } from "next/server";

import { isDevOAuthEnabled, personaForToken } from "@simulated/google/provider";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDevOAuthEnabled()) {
    return NextResponse.json({ error: "invalid_request" }, { status: 404 });
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";

  const persona = personaForToken(token);
  if (!persona) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

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
