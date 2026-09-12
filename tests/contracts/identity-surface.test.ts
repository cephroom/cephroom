import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsAndStrings, walk } from "./scan";


const IDENTITY_TOKENS = [
  "email",
  "customerId",
  "stripeCustomer",
  "cephroomSub",
  "passwordHash",
  "accountId",
  "avatar",
  "preferences",
];

const ALLOWED = [
  "src/lib/keys/tokens.ts",
  "src/lib/auth/providers.ts",
  "src/app/api/auth/callback/[provider]/route.ts",
  "src/lib/stripe/live.ts",
  "src/lib/stripe/types.ts",
  "src/lib/stripe/entitlement.ts",
  "src/lib/stripe/actions.ts",
  "src/lib/stripe/simulated-actions.ts",
  "src/app/account/page.tsx",
];

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
    expect(ALLOWED.length).toBeLessThanOrEqual(9);
  });

  it("has no email anywhere in the platform, on any allowlist", () => {
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
      if (/\bcreateHmac\b/.test(source)) offenders.push(rel);
    }

    expect(offenders).toEqual([]);
  });
});

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
    process.env.AUTH_SUBJECT_SECRET ??= "identity-surface-test-secret";
    const { deriveSubject } = await import("@/lib/keys/tokens");

    const oauth = deriveSubject("google", "1234567890");
    expect(oauth.startsWith("s_")).toBe(true);
    expect(deriveSubject("google", "1234567890")).toBe(oauth);
    expect(deriveSubject("github", "1234567890")).not.toBe(oauth);

    const zk = readFileSync(join(ROOT, "src", "lib", "zk", "verify.ts"), "utf8");
    expect(zk).toContain("`z_${");
  });
});
