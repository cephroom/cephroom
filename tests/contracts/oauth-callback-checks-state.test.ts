import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly } from "./scan";

/**
 * The OAuth callback proves the round-trip was the one this browser started -
 * contract 3.
 *
 * Sign-in is where an identity enters the system, and the callback is a GET the
 * attacker can cause a victim's browser to make (a crafted link back to
 * /api/auth/callback). Without a state check bound to a cookie this browser
 * set, that is login fixation / CSRF: the victim ends up signed in as the
 * attacker, or the attacker forces a code of their choosing. The defences are
 * the state value compared against the flow cookie, timing-safe, plus the PKCE
 * verifier and a single-use flow cookie.
 *
 * The callback reads cookies, so it is not unit-testable in a node
 * environment; this guards the shape, and the behaviour is confirmed against
 * the local dev server. All of these existed - this stops them being removed
 * or weakened silently, which is how CSRF regressions ship.
 */
const callback = stripCommentsOnly(
  readFileSync(
    join(ROOT, "src", "app", "api", "auth", "callback", "[provider]", "route.ts"),
    "utf8",
  ),
);

describe("the callback validates the state round-trip", () => {
  it("compares the returned state against the flow cookie", () => {
    expect(callback).toMatch(/flow\.s/);
    expect(callback).toMatch(/searchParams\.get\("state"\)/);
  });

  it("compares it in constant time, not with ==", () => {
    expect(
      callback,
      "State comparison must be timing-safe (safeEqual), not === - a plain compare leaks the value a byte at a time.",
    ).toMatch(/safeEqual\(\s*flow\.s\s*,\s*state\s*\)|safeEqual\(\s*state\s*,\s*flow\.s\s*\)/);
    // and must not fall back to a plain equality on the state
    expect(callback).not.toMatch(/flow\.s\s*===\s*state|state\s*===\s*flow\.s/);
  });

  it("rejects a provider mismatch as well", () => {
    expect(callback).toMatch(/flow\.p\s*!==\s*providerId|flow\.p\s*===\s*providerId/);
  });

  it("fails closed to the sign-in page when state does not match", () => {
    const useAt = callback.indexOf("safeEqual(flow.s");
    expect(useAt, "no state comparison found").toBeGreaterThan(-1);
    const guard = callback.slice(useAt, useAt + 120);
    expect(guard).toMatch(/fail\(/);
    expect(guard).toMatch(/"state"/);
  });

  it("uses the PKCE verifier in the token exchange", () => {
    expect(callback).toMatch(/code_verifier/);
    expect(callback).toMatch(/flow\.v/);
  });

  it("clears the flow cookie so a state cannot be replayed", () => {
    expect(callback).toMatch(/FLOW_COOKIE[^]*maxAge:\s*0/);
  });

  it("requires the flow cookie to be present at all", () => {
    expect(callback).toMatch(/if \(!raw\)/);
    expect(callback).toMatch(/"expired"/);
  });
});
