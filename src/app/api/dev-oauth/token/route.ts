import { NextResponse } from "next/server";

import {
  DEV_OAUTH_CLIENT_ID,
  DEV_OAUTH_CLIENT_SECRET,
  isDevOAuthEnabled,
  issueToken,
  redeemCode,
} from "@/lib/auth/dev-oauth";

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
      expires_in: 3600,
      scope: "openid email profile",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
