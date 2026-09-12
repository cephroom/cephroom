import { NextResponse } from "next/server";

import {
  DEV_OAUTH_CLIENT_ID,
  DEV_PERSONAS,
  isDevOAuthEnabled,
  issueCode,
} from "@/lib/auth/dev-oauth";

export const dynamic = "force-dynamic";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );
}

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
    return NextResponse.redirect(target, 302);
  }

  const rows = DEV_PERSONAS.map((persona) => {
    const href = `${url.pathname}?${new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      persona: persona.sub,
    })}`;
    return `<a class="row" href="${escapeHtml(href)}">
      <span class="avatar">${escapeHtml(persona.name.charAt(0))}</span>
      <span>
        <strong>${escapeHtml(persona.name)}</strong>
        <em>${escapeHtml(persona.email)}</em>
      </span>
      <span class="badge">${escapeHtml(persona.mimics)}</span>
    </a>`;
  }).join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Local dev SSO</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; min-height: 100vh;
         display: grid; place-items: center; background: #eceae4; color: #16181a; }
  .card { width: min(26rem, calc(100vw - 2rem)); background: #fff; border-radius: 12px;
          padding: 1.75rem; box-shadow: 0 12px 40px rgba(0,0,0,.12); }
  h1 { font-size: 1.05rem; margin: 0 0 .25rem; }
  p.sub { margin: 0 0 1.25rem; color: #5b6067; font-size: .85rem; }
  .row { display: flex; align-items: center; gap: .8rem; padding: .7rem .8rem;
         border: 1px solid #e2ded2; border-radius: 8px; text-decoration: none;
         color: inherit; margin-bottom: .6rem; }
  .row:hover { border-color: #0f5c4a; background: #f4faf7; }
  .avatar { width: 34px; height: 34px; border-radius: 50%; background: #0f5c4a;
            color: #fff; display: grid; place-items: center; font-weight: 600; }
  strong { display: block; font-size: .9rem; }
  em { font-style: normal; color: #5b6067; font-size: .78rem; }
  .row > span:nth-child(2) { flex: 1; }
  .badge { font-size: .68rem; text-transform: uppercase; letter-spacing: .06em;
           color: #5b6067; border: 1px solid #e2ded2; border-radius: 999px; padding: .15rem .5rem; }
  .note { margin-top: 1.1rem; font-size: .75rem; color: #8b9099; }
</style></head>
<body><div class="card">
  <h1>Choose a test account</h1>
  <p class="sub">Local OAuth provider — development only. Cephroom is requesting ${escapeHtml(scope)} — and note what is not in that list.</p>
  ${rows}
  <p class="note">This endpoint exists so the OAuth code path can be exercised without Google or GitHub credentials. It is disabled unless AUTH_DEV_OAUTH=1.</p>
</div></body></html>`;

  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
