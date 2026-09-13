import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly } from "./scan";
import { verifyAgentSignature } from "@/lib/auth/agent";

let tokens: typeof import("@/lib/keys/tokens");

beforeAll(async () => {
  process.env.AUTH_SUBJECT_SECRET = randomBytes(32).toString("hex");
  tokens = await import("@/lib/keys/tokens");
});

function freshAgentKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const spki = (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString(
    "base64",
  );
  const signChallenge = (challenge: string) =>
    sign("sha256", Buffer.from(challenge, "utf8"), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64");
  return { spki, signChallenge };
}

/**
 * Agent login is proof of control of a key - contract 3, the agent case.
 * A person round-trips OAuth; an agent signs a challenge. These fix that it is
 * a signature check (never a lookup), that the identity is self-sovereign and
 * cannot impersonate a person, and that the key it yields is always actor: ai.
 */
describe("an agent proves control of a key, not an email", () => {
  it("accepts a signature that verifies for the presented key", () => {
    const { spki, signChallenge } = freshAgentKey();
    const challenge = "c".repeat(32);
    expect(
      verifyAgentSignature({
        publicKeySpkiBase64: spki,
        challenge,
        signatureBase64: signChallenge(challenge),
      }),
    ).toBe(true);
  });

  it("rejects a signature over a different challenge (no replay)", () => {
    const { spki, signChallenge } = freshAgentKey();
    expect(
      verifyAgentSignature({
        publicKeySpkiBase64: spki,
        challenge: "the-challenge-i-was-given",
        signatureBase64: signChallenge("a-different-one"),
      }),
    ).toBe(false);
  });

  it("rejects a signature made by a different key (no impersonation)", () => {
    const victim = freshAgentKey();
    const attacker = freshAgentKey();
    const challenge = "x".repeat(32);
    expect(
      verifyAgentSignature({
        publicKeySpkiBase64: victim.spki,
        challenge,
        signatureBase64: attacker.signChallenge(challenge),
      }),
    ).toBe(false);
  });

  it("rejects a malformed key or signature rather than throwing", () => {
    expect(
      verifyAgentSignature({
        publicKeySpkiBase64: "not-a-key",
        challenge: "c",
        signatureBase64: "nope",
      }),
    ).toBe(false);
  });
});

describe("an agent's subject is self-sovereign and cannot pass for a person", () => {
  it("derives a stable a_ subject from the key, distinct from s_ and n_", () => {
    const { spki } = freshAgentKey();
    const sub = tokens.agentSubject(spki);
    expect(sub.startsWith("a_")).toBe(true);
    expect(sub).toBe(tokens.agentSubject(spki)); // stable for the same key
    // distinct namespaces
    expect(tokens.deriveSubject("google", "123").startsWith("s_")).toBe(true);
    expect(sub.startsWith("s_")).toBe(false);
    expect(sub.startsWith("n_")).toBe(false);
  });

  it("gives two different keys two different subjects", () => {
    expect(tokens.agentSubject(freshAgentKey().spki)).not.toBe(
      tokens.agentSubject(freshAgentKey().spki),
    );
  });
});

describe("the agent login endpoint is shaped correctly", () => {
  const route = stripCommentsOnly(
    readFileSync(
      join(ROOT, "src", "app", "api", "auth", "agent", "route.ts"),
      "utf8",
    ),
  );

  it("verifies the signature and the challenge before minting anything", () => {
    // Call sites, not the import line.
    const verifyAt = route.indexOf("verifyAgentSignature({");
    const knownAt = route.indexOf("knownChallenge(challenge)");
    const mintAt = route.indexOf("mintAccessKey({");
    expect(verifyAt, "no verify call").toBeGreaterThan(-1);
    expect(knownAt, "no challenge check").toBeGreaterThan(-1);
    expect(mintAt, "no mint call").toBeGreaterThan(-1);
    expect(knownAt < mintAt && verifyAt < mintAt).toBe(true);
  });

  it("spends the challenge so a captured signature cannot be replayed", () => {
    expect(route).toMatch(/forgetChallenge\(/);
  });

  it("always mints an actor: ai key, never a person", () => {
    expect(route).toMatch(/actor:\s*"ai"/);
    expect(route).not.toMatch(/actor:\s*"human"/);
  });

  it("derives the subject from the key, not from anything the caller names", () => {
    expect(route).toMatch(/agentSubject\(/);
  });
});
