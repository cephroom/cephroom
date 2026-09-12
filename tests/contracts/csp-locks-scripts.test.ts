import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly } from "./scan";

/**
 * The scoped Content-Security-Policy keeps its shape - contracts 1, 2 and 4.
 *
 * The decision and its reasoning live in docs/RESEARCH-NOTES.md and in
 * src/proxy.ts. This guards the two ways the policy could rot into
 * something that looks present but protects nothing:
 *
 *  1. script-src quietly reacquires 'unsafe-inline' (or drops the nonce), which
 *     is the single change that turns a real CSP back into decoration. Verified
 *     end to end: the running app renders and re-checks claims with a nonce'd
 *     script-src and no 'unsafe-inline'.
 *
 *  2. The deliberately-open fetch directives (connect/img/media) silently close.
 *     They are open BY DESIGN: a reader's browser fetches columns, datasets and
 *     figures straight from arbitrary contributor nodes, and narrowing these
 *     would force that content through the platform - which is precisely what
 *     contract 2 forbids. A future "hardening" that closes them would look like
 *     an improvement and would break the privacy model, so the openness is
 *     pinned here with the reason attached.
 *
 * proxy.ts reads cookies/headers per request, so it is not unit-testable in
 * a node environment; this guards the policy's shape instead.
 */
const proxy = stripCommentsOnly(
  readFileSync(join(ROOT, "src", "proxy.ts"), "utf8"),
);

function directive(name: string): string {
  // Each directive is a single-quoted line in the policy() array, e.g.
  // "script-src 'self' 'nonce-...' 'strict-dynamic'". Pull its text.
  const at = proxy.indexOf(`${name} `);
  expect(at, `no ${name} directive`).toBeGreaterThan(-1);
  const end = proxy.indexOf('"', at);
  return proxy.slice(at, end);
}

describe("script execution is locked to a per-request nonce", () => {
  it("script-src carries a nonce and strict-dynamic", () => {
    const s = directive("script-src");
    expect(s).toMatch(/'nonce-\$\{nonce\}'/);
    expect(s).toMatch(/'strict-dynamic'/);
  });

  it("script-src never admits 'unsafe-inline' - the one change that guts it", () => {
    // 'unsafe-inline' is ignored by browsers when a nonce is present, but adding
    // it is how someone "fixes" a blocked inline script and silently disarms the
    // policy for older browsers and for any future non-nonce path.
    expect(
      directive("script-src"),
      "script-src must not contain 'unsafe-inline'.",
    ).not.toMatch(/'unsafe-inline'/);
  });

  it("mints a fresh nonce per request rather than a constant", () => {
    expect(proxy).toMatch(/randomUUID\(\)/);
    // the nonce must be interpolated into the policy, not a hard-coded string
    expect(proxy).toMatch(/nonce-\$\{nonce\}/);
  });

  it("forwards the CSP on the request so Next stamps its own scripts", () => {
    expect(proxy).toMatch(/requestHeaders\.set\(\s*"content-security-policy"/);
  });
});

describe("the fetch directives stay open by design", () => {
  it("connect-src admits arbitrary node origins (http: https:)", () => {
    const c = directive("connect-src");
    expect(c).toMatch(/http:/);
    expect(c).toMatch(/https:/);
  });

  it("img-src and media-src admit arbitrary node origins", () => {
    expect(directive("img-src")).toMatch(/http:\s+https:/);
    expect(directive("media-src")).toMatch(/http:\s+https:/);
  });

  it("does not upgrade-insecure-requests, which would break plain-http nodes", () => {
    expect(
      proxy,
      "upgrade-insecure-requests would rewrite http node fetches to https and break reading from an honest localhost/tunnel node.",
    ).not.toMatch(/upgrade-insecure-requests/);
  });
});

describe("the cheap, unconditional directives are present", () => {
  it("forbids plugins, base hijack, off-platform form posts, and framing", () => {
    expect(proxy).toMatch(/object-src 'none'/);
    expect(proxy).toMatch(/base-uri 'self'/);
    expect(proxy).toMatch(/form-action 'self'/);
    expect(proxy).toMatch(/frame-ancestors 'none'/);
  });

  it("sets the companion headers", () => {
    expect(proxy).toMatch(/"x-content-type-options",\s*"nosniff"/);
    expect(proxy).toMatch(/"referrer-policy",\s*"no-referrer"/);
  });

  it("applies to every route except Next's own static output", () => {
    expect(proxy).toMatch(/matcher:\s*\[[^\]]*_next\/static/);
  });
});
