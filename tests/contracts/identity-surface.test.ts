import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsAndStrings, walk } from "./scan";

/**
 * Contract 1, enforced from the other direction.
 *
 * The other tests assert that no persistence layer exists. This one asserts
 * that identity does not spread: the set of modules allowed to touch an
 * email, a Stripe customer id, or a subject is fixed and small, and adding a
 * new one is a deliberate edit to this list rather than a quiet import.
 *
 * If a future feature genuinely needs identity somewhere new, widening this
 * array is the honest way to do it — and the diff makes it reviewable.
 */

/** Identifiers that mean "this is about a particular person". */
const IDENTITY_TOKENS = [
  "email",
  "customerId",
  "stripeCustomer",
  "binderySub",
  "passwordHash",
  "accountId",
];

/**
 * Modules permitted to handle identity, each for a stated reason.
 *
 * Nothing here persists anything. They mint keys, read keys, ask Stripe, or
 * render what the key already says.
 */
const ALLOWED = [
  // Mints and verifies capability keys. Derives the pseudonymous subject.
  "src/lib/keys/tokens.ts",
  // The OAuth flow: exchanges a code for a profile and throws it away.
  "src/lib/auth/providers.ts",
  "src/app/api/auth/callback/[provider]/route.ts",
  // Reads the key out of a cookie.
  "src/lib/auth/session.ts",
  // Re-mint a key: both ask Stripe for the current tier and stamp it in.
  "src/app/api/auth/refresh/route.ts",
  "src/app/api/auth/restamp/route.ts",
  // Asks Stripe. Stripe is the stateful party.
  "src/lib/stripe/live.ts",
  "src/lib/stripe/types.ts",
  "src/lib/stripe/entitlement.ts",
  "src/lib/stripe/actions.ts",
  "src/lib/stripe/simulated-actions.ts",
  // The local identity provider, development only.
  "src/lib/auth/dev-oauth.ts",
  "src/app/api/dev-oauth/authorize/route.ts",
  "src/app/api/dev-oauth/userinfo/route.ts",
  // Renders what the key and Stripe already said.
  "src/app/account/page.tsx",
];

describe("Contract 1: identity stays in a small, named set of modules", () => {
  it("does not leak identity handling into new modules", () => {
    const offenders: string[] = [];

    for (const file of walk(`${ROOT}${sep}src`)) {
      const rel = relative(ROOT, file).split(sep).join("/");
      if (rel.includes(".test.")) continue;
      if (ALLOWED.includes(rel)) continue;

      const source = stripCommentsAndStrings(readFileSync(file, "utf8"));
      // Match the token used as code — reached through a property access, or
      // followed by punctuation — so that prose in JSX saying "no email
      // address is stored" does not read as handling one.
      const found = IDENTITY_TOKENS.filter((token) =>
        new RegExp(
          `(?<=[.\\[])${token}\\b|\\b${token}\\b(?=\\s*[:.,)\\]}=;?])`,
        ).test(source),
      );
      if (found.length > 0) offenders.push(`${rel} → ${found.join(", ")}`);
    }

    expect(
      offenders,
      `These modules handle identity but are not on the allowlist in this test.\nIf that is deliberate, add them here with a reason.\n\n${offenders.join("\n")}\n`,
    ).toEqual([]);
  });

  it("keeps the allowlist small enough to read", () => {
    // Not a real limit, a tripwire. If this needs raising, identity has
    // spread further than the design intends and that is worth noticing.
    expect(ALLOWED.length).toBeLessThanOrEqual(16);
  });

  it("never derives a subject anywhere but the key module", () => {
    const offenders: string[] = [];

    for (const file of walk(`${ROOT}${sep}src`)) {
      const rel = relative(ROOT, file).split(sep).join("/");
      if (rel === "src/lib/keys/tokens.ts" || rel.includes(".test.")) continue;

      const source = stripCommentsAndStrings(readFileSync(file, "utf8"));
      // createHmac outside the key module would be a second, unreviewed way
      // of turning an identity into an identifier.
      if (/\bcreateHmac\b/.test(source)) offenders.push(rel);
    }

    expect(offenders).toEqual([]);
  });
});
