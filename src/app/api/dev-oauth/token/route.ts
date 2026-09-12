import { NextResponse } from "next/server";

import {
  DEV_OAUTH_CLIENT_ID,
  DEV_OAUTH_CLIENT_SECRET,
  DEV_TOKEN_TTL_MS,
  isDevOAuthEnabled,
  issueToken,
  redeemCode,
} from "@simulated/google/provider";

export const dynamic = "force-dynamic";

function credentialsFrom(request: Request, form: URLSearchParams) {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    return {
      id: decodeURIComponent(decoded.slice(0, sep)),
      secret: decodeURIComponent(decoded.slice(sep + 1)),
    };
  }
  return {
    id: form.get("client_id") ?? "",
    secret: form.get("client_secret") ?? "",
  };
}

export async function POST(request: Request) {
  if (!isDevOAuthEnabled()) {
    return NextResponse.json({ error: "invalid_request" }, { status: 404 });
  }

  const form = new URLSearchParams(await request.text());
  const { id, secret } = credentialsFrom(request, form);

  if (id !== DEV_OAUTH_CLIENT_ID || secret !== DEV_OAUTH_CLIENT_SECRET) {
    return NextResponse.json({ error: "invalid_client" }, { status: 401 });
  }
  if (form.get("grant_type") !== "authorization_code") {
    return NextResponse.json(
      { error: "unsupported_grant_type" },
      { status: 400 },
    );
  }

  const persona = redeemCode(form.get("code") ?? "");
  if (!persona) {
    return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  }

  return NextResponse.json(
    {
      access_token: issueToken(persona),
      token_type: "bearer",
      expires_in: Math.floor(DEV_TOKEN_TTL_MS / 1000),
      // Not "openid email profile". The platform asks for "openid profile"
      // and this endpoint must echo what was granted rather than something
      // richer — a stand-in that advertises a scope the real provider was
      // never asked for is a stand-in that quietly disagrees with production,
      // which is worse than no stand-in at all. The consent screen was
      // corrected when the email scope was dropped; this was missed.
      scope: "openid profile",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
