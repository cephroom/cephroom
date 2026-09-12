import { NextResponse, type NextRequest } from "next/server";

/**
 * A scoped Content-Security-Policy for the platform's own documents - contracts
 * 1, 2 and 4.
 *
 * The reasoning behind every choice here is written up in
 * docs/RESEARCH-NOTES.md ("The Content-Security-Policy decision"). In short:
 *
 * - script-src is LOCKED. The platform controls every script it serves; there
 *   are no inline <script> tags and no dangerouslySetInnerHTML anywhere, and
 *   react-markdown escapes HTML in untrusted node content. A per-request nonce
 *   plus 'strict-dynamic' means that even if some future change let a stranger's
 *   column inject a <script>, the browser would refuse to run it. Every route is
 *   already force-dynamic, so the usual cost of a nonce (giving up static
 *   rendering) is already paid - this is the one directive that buys real safety
 *   here at no architectural cost.
 *
 * - connect-src / img-src / media-src are DELIBERATELY OPEN (http: https:).
 *   A reader's browser fetches columns, datasets and figures straight from the
 *   contributor's node, whose address is open-ended - any http(s) origin a
 *   contributor states. Locking these to an allowlist would either break
 *   reading or force node content through the platform, and routing it through
 *   the platform is exactly what contract 2 forbids: the platform must learn
 *   nothing about who reads what. So these stay open by design, not by neglect.
 *
 * - object-src 'none', base-uri 'self', form-action 'self', frame-ancestors
 *   'none' are cheap and unconditional: no plugins, no <base> hijack of relative
 *   URLs, forms only ever post back to the platform (billing and auth), and the
 *   platform is never framed.
 *
 * - upgrade-insecure-requests is intentionally ABSENT: nodes are routinely plain
 *   http (localhost, a dev tunnel), and upgrading those fetches to https would
 *   break reading from an honest node. See the notes.
 *
 * The header shape is guarded by tests/contracts/csp-locks-scripts.test.ts, so
 * script-src cannot quietly reacquire 'unsafe-inline' and the open directives
 * cannot silently close and start proxying node content.
 */
const isDev = process.env.NODE_ENV !== "production";

function policy(nonce: string): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic' makes the browser trust scripts loaded by the nonce'd
    // bootstrap and ignore host allowlists for scripts - the modern, strong
    // form. 'unsafe-eval' is dev-only, for React Fast Refresh.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Styles cannot practically be nonce'd (React and Tailwind emit inline
    // style attributes); style injection is far lower risk than script.
    "style-src 'self' 'unsafe-inline'",
    // A reader's browser fetches figures from arbitrary contributor nodes.
    "img-src 'self' data: blob: http: https:",
    "media-src 'self' blob: http: https:",
    "font-src 'self' data:",
    // Columns and datasets are fetched client-side from arbitrary node origins;
    // ws:/wss: covers the dev HMR socket.
    "connect-src 'self' http: https: ws: wss:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
  ].join("; ");
}

export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = policy(nonce);

  // Forward the nonce and the CSP on the request so Next stamps the nonce onto
  // its own <script> tags for this render.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  // Companion headers that carry weight regardless of the CSP.
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("x-frame-options", "DENY");
  return response;
}

export const config = {
  // Everything except Next's own static output and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
