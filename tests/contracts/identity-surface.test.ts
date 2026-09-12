import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

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
 * The list was fifteen modules of a permitted sixteen, and it is now nine.
 * Nothing was reorganised to achieve that — the key stopped carrying a
 * display name and a customer id, and two thirds of the modules on the list
 * turned out to be there only because they minted or re-minted a key and
 * therefore had to handle both. An allowlist that keeps growing is usually
 * reporting something true about the design.
 *
 * If a future feature genuinely needs identity somewhere new, widening this
 * array is the honest way to do it — and the diff makes it reviewable.
 */

/** Identifiers that mean "this is about a particular person". */
const IDENTITY_TOKENS = [
  "email",
  "customerId",
  "stripeCustomer",
  "cephroomSub",
  "passwordHash",
  "accountId",
  // Contract 2's fuller list. These should not appear anywhere in the
  // platform as code — we never handle an avatar or a preference, so either
  // is a tripwire for a profile feature being smuggled in.
  //
  // `displayName` is deliberately not here, and the distinction is worth
  // stating precisely. A *contributor's* display name is chosen by them with
  // a flag on their own node, travels on an announcement, and is the byline
  // on their own work — attribution, not identity, and never persisted. A
  // *reader's* name is a different thing entirely: it came from Google, and
  // it is now nowhere, because it had found its way into every key and from
  // there onto contributors' disks. See
  // tests/contracts/attribution-is-pseudonymous.test.ts.
  "avatar",
  "preferences",
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
  // The one door identity comes through: an account id is exchanged for a
  // subject and is not referred to again.
  "src/lib/auth/providers.ts",
  "src/app/api/auth/callback/[provider]/route.ts",
  // Asks Stripe. Stripe is the stateful party.
  "src/lib/stripe/live.ts",
  "src/lib/stripe/types.ts",
  "src/lib/stripe/entitlement.ts",
  "src/lib/stripe/actions.ts",
  "src/lib/stripe/simulated-actions.ts",
  // Renders what Stripe already said.
  "src/app/account/page.tsx",
];

/**
 * Removes JSX text content, so that a page *describing* what is not stored
 * does not read as storing it.
 *
 * The privacy page lists "no account, profile, display name, avatar,
 * preference or activity record" and tripped on `avatar,` — a comma is
 * punctuation, and the matcher below keys on punctuation. The test's own
 * comment already said prose must not count; this makes that true rather than
 * mostly true.
 *
 * Only text runs containing no `{` are removed, so a real expression like
 * `<span>{viewer.sub}</span>` is left in place to be caught.
 */
function stripJsxProse(source: string): string {
  return source.replace(/>([^<>{}]+)</g, "> <");
}

describe("Contract 1: identity stays in a small, named set of modules", () => {
  it("does not leak identity handling into new modules", () => {
    const offenders: string[] = [];

    for (const file of walk(`${ROOT}${sep}src`)) {
      const rel = relative(ROOT, file).split(sep).join("/");
      if (rel.includes(".test.")) continue;
      if (ALLOWED.includes(rel)) continue;

      const source = stripJsxProse(
        stripCommentsAndStrings(readFileSync(file, "utf8")),
      );
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
    //
    // It stood at 15 of a permitted 16, and eight of those were carrying
    // identity only because a key held a display name and a customer id and
    // every module that minted or re-minted one therefore handled both. Once
    // the key stopped carrying them, the modules stopped needing them.
    expect(ALLOWED.length).toBeLessThanOrEqual(9);
  });

  it("has no email anywhere in the platform, on any allowlist", () => {
    // The strictest reading of Contract 1, and the correct one: the platform
    // does not handle an email address at all, so there is no module for
    // which "may handle an email" is a sensible exemption.
    //
    // The one that existed was the development identity provider's persona
    // list, which is a stand-in for Google — and a stand-in for a
    // counterparty belongs with the other counterparty, behind the directory
    // boundary that AGENTS.md says *is* the boundary. It was inside `src/`
    // only because that is where it was first written.
    const offenders: string[] = [];

    for (const file of walk(`${ROOT}${sep}src`)) {
      const rel = relative(ROOT, file).split(sep).join("/");
      if (rel.includes(".test.")) continue;

      const source = stripJsxProse(
        stripCommentsAndStrings(readFileSync(file, "utf8")),
      );
      if (/(?<=[.[])email\b|\bemail\b(?=\s*[:.,)\]}=;?])/.test(source)) {
        offenders.push(rel);
      }
    }

    expect(
      offenders,
      `The platform handles no email address, with no exceptions.\n${offenders.join("\n")}\n`,
    ).toEqual([]);
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

/**
 * Everything in the platform that hashes, and what it produces.
 *
 * The assertion above claims subjects are derived in one place, and enforced
 * only `createHmac` — so it was true of the function it named and not of the
 * property it stated. `createHash("sha256").update(provider + accountId)` is
 * an equally good way to turn an identity into a stable identifier and was
 * unguarded; `src/lib/zk/verify.ts` does in fact mint a second kind of
 * subject (`z_…`) and passed this test while doing it.
 *
 * Enumerating the hashes is the honest version. Each entry says what goes in
 * and what comes out, so "does this create a new way of naming a person" is a
 * question asked at review time about a diff to this list, rather than a
 * property nobody re-derives.
 */
const PERMITTED_HASHING: Record<string, string> = {
  "src/lib/keys/tokens.ts":
    "HMAC(provider:accountId) under a server secret → the pseudonymous subject. The one identity-to-identifier step.",
  "src/lib/zk/verify.ts":
    "SHA-256 of a challenge → the nonce binding and the challenge nullifier. Also reads oidcDigest, a subject the *circuit* derived under a salt the platform has never seen — it is not computed here.",
  "src/app/api/auth/start/route.ts":
    "SHA-256 of a PKCE verifier → the code challenge. About a single in-flight authorization, not about a person.",
  "src/lib/tokens/issuer.ts":
    "SHA-256 of a token nonce → the nullifier. Derived from material the issuer has never seen, which is what keeps it unlinkable.",
};

describe("Contract 1: the ways a person can be named are counted", () => {
  it("hashes only in the modules named, and for the stated reason", () => {
    const found: string[] = [];

    for (const file of walk(`${ROOT}${sep}src`)) {
      const rel = relative(ROOT, file).split(sep).join("/");
      if (rel.includes(".test.")) continue;

      const source = stripCommentsAndStrings(readFileSync(file, "utf8"));
      if (/\bcreateHmac\b|\bcreateHash\b|crypto\.subtle\.digest/.test(source)) {
        found.push(rel);
      }
    }

    const permitted = Object.keys(PERMITTED_HASHING);
    const unexpected = found.filter((rel) => !permitted.includes(rel)).sort();
    expect(
      unexpected,
      `These modules hash and are not named in PERMITTED_HASHING.\nA hash of anything about a person is a new name for that person. If this one is not, say so here with what goes in and what comes out.\n\n${unexpected.join("\n")}\n`,
    ).toEqual([]);

    const stale = permitted.filter((rel) => !found.includes(rel)).sort();
    expect(
      stale,
      `These modules are permitted to hash but no longer do:\n${stale.join("\n")}\n`,
    ).toEqual([]);
  });

  it("mints subjects in exactly two shapes, each with its own prefix", async () => {
    // `s_` from the OAuth path, `z_` from a proof. Distinct prefixes so that
    // the two namespaces cannot collide and so that a subject says which
    // route produced it — a `z_` subject is one the platform could not have
    // linked to a Google account even momentarily.
    process.env.AUTH_SUBJECT_SECRET ??= "identity-surface-test-secret";
    const { deriveSubject } = await import("@/lib/keys/tokens");

    const oauth = deriveSubject("google", "1234567890");
    expect(oauth.startsWith("s_")).toBe(true);
    expect(deriveSubject("google", "1234567890")).toBe(oauth); // stable
    expect(deriveSubject("github", "1234567890")).not.toBe(oauth); // provider-scoped

    // The proof path's shape, asserted against the source rather than run,
    // because producing one needs a circuit.
    const zk = readFileSync(join(ROOT, "src", "lib", "zk", "verify.ts"), "utf8");
    expect(zk).toContain("`z_${");
  });
});
