import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ROOT, walk } from "./scan";
import { NullifierStore } from "@/lib/tokens/nullifiers";
import {
  clearProviderKeys,
  modulusToChunks,
  seedProviderKeys,
} from "@/lib/zk/jwks";
import { EXPECTED_SIGNAL_COUNT, NONCE_HASH_INDEX, OIDC_DIGEST_INDEX, RSA_MODULUS_CHUNKS } from "@/lib/zk/params";
import {
  clearChallenges,
  expectedNonceHash,
  issueChallenge,
  verifySubmission,
} from "@/lib/zk/verify";

/**
 * The property that makes "choose your own prover" real rather than a slogan.
 *
 * A third-party prover sees the user's JWT. That does not remove trust, it
 * moves it — and moving it is only an improvement if the user's choice is
 * genuine. The choice is genuine exactly when the platform cannot tell one
 * prover from another, so these tests assert that prover identity is not, and
 * cannot become, an input to verification.
 *
 * The failure this guards against is not malice. It is somebody adding a
 * `provers` allowlist "to block a broken one", or a `preferredProvers` list
 * for the UI, or a callback to the prover to check it is still up. Each is
 * individually reasonable and each one re-centralises the trust that was just
 * distributed.
 */

const ISSUER = "https://accounts.google.com";

// A stand-in RSA modulus. The verifier compares limbs, so any fixed value that
// round-trips through the chunking is a valid fixture.
const MODULUS = Buffer.alloc(256, 0x7b).toString("base64url");

function signalsFor(challenge: string, digest = 12345n): string[] {
  const chunks = modulusToChunks(MODULUS);
  const [high, low] = expectedNonceHash(challenge);
  const signals = [
    ...chunks.map(String),
    digest.toString(),
    high.toString(),
    low.toString(),
  ];
  return signals;
}

function alwaysValid() {
  return async () => true;
}

afterEach(() => {
  clearChallenges();
  clearProviderKeys();
});

describe("prover identity is not an input to verification", () => {
  it("never names a prover anywhere in the verification path", () => {
    for (const file of walk(join(ROOT, "src", "lib", "zk"))) {
      if (file.includes(".test.")) continue;
      const source = readFileSync(file, "utf8");
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      const rel = relative(ROOT, file).split(sep).join("/");

      for (const forbidden of [
        "proverId",
        "proverUrl",
        "allowlist",
        "allowedProvers",
        "trustedProvers",
        "preferredProver",
      ]) {
        expect(code, `${rel} must not know about ${forbidden}`).not.toContain(
          forbidden,
        );
      }
    }
  });

  it("accepts an identical proof regardless of where it came from", async () => {
    seedProviderKeys(ISSUER, [MODULUS]);
    const store = new NullifierStore();

    // The same bytes submitted twice, notionally from two different provers.
    // There is nowhere in the submission to say which, and that is the test.
    const first = issueChallenge();
    const second = issueChallenge();

    const a = await verifySubmission(
      { proof: {}, publicSignals: signalsFor(first), challenge: first },
      { verifyingKey: {}, spend: (e, n) => store.spend(e, n), verifier: alwaysValid() },
    );
    const b = await verifySubmission(
      { proof: {}, publicSignals: signalsFor(second), challenge: second },
      { verifyingKey: {}, spend: (e, n) => store.spend(e, n), verifier: alwaysValid() },
    );

    expect(a).toEqual({ ok: true, subject: a.ok ? a.subject : "" });
    expect(b.ok).toBe(true);
    // Same circuit output, same subject — the prover made no difference.
    expect(a.ok && b.ok && a.subject).toBe(b.ok ? b.subject : null);
  });

  it("takes no submission field that could identify a prover", () => {
    // The submission type is the contract with the outside world. If a prover
    // could name itself, a verifier could come to depend on the name.
    const source = readFileSync(
      join(ROOT, "src", "lib", "zk", "verify.ts"),
      "utf8",
    );
    const iface = source.slice(
      source.indexOf("export interface ZkProofSubmission"),
      source.indexOf("export type VerifyFailure"),
    );
    const fields = [...iface.matchAll(/^\s{2}(\w+)[?]?:/gm)].map((m) => m[1]);
    expect(fields.sort()).toEqual(["challenge", "proof", "publicSignals"]);
  });

  it("makes no network request while verifying", () => {
    // A callback to the prover, or to anywhere, would be prover-specific trust
    // arriving through the back door — and a verifier that needs the network
    // is a verifier that fails when a prover goes down.
    const source = readFileSync(
      join(ROOT, "src", "lib", "zk", "verify.ts"),
      "utf8",
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/\baxios\b/);
  });
});

describe("a proof binds to a challenge and spends it", () => {
  it("refuses a proof for a challenge that was never issued", async () => {
    seedProviderKeys(ISSUER, [MODULUS]);
    const store = new NullifierStore();
    const invented = "a".repeat(64);

    const result = await verifySubmission(
      { proof: {}, publicSignals: signalsFor(invented), challenge: invented },
      { verifyingKey: {}, spend: (e, n) => store.spend(e, n), verifier: alwaysValid() },
    );
    expect(result).toEqual({ ok: false, reason: "unknown-challenge" });
  });

  it("refuses the same valid proof a second time", async () => {
    seedProviderKeys(ISSUER, [MODULUS]);
    const store = new NullifierStore();
    const challenge = issueChallenge();
    const submission = {
      proof: {},
      publicSignals: signalsFor(challenge),
      challenge,
    };
    const options = {
      verifyingKey: {},
      spend: (e: number, n: string) => store.spend(e, n),
      verifier: alwaysValid(),
    };

    expect((await verifySubmission(submission, options)).ok).toBe(true);
    // A valid proof copied is still a valid proof. Only the spend stops it.
    expect(await verifySubmission(submission, options)).toEqual({
      ok: false,
      reason: "challenge-spent",
    });
  });

  it("refuses a proof whose nonce names a different challenge", async () => {
    seedProviderKeys(ISSUER, [MODULUS]);
    const store = new NullifierStore();
    const mine = issueChallenge();
    const other = issueChallenge();

    // A proof made for `other`, presented against `mine`. Without this check a
    // proof could be lifted from one session into another.
    const result = await verifySubmission(
      { proof: {}, publicSignals: signalsFor(other), challenge: mine },
      { verifyingKey: {}, spend: (e, n) => store.spend(e, n), verifier: alwaysValid() },
    );
    expect(result).toEqual({ ok: false, reason: "challenge-mismatch" });
  });

  it("spends the challenge before checking the proof", async () => {
    // So a flood of junk proofs against one challenge costs one pairing check,
    // not one per attempt. Rate limiting without identity is hard; not doing
    // unbounded work per challenge is the part that is free.
    seedProviderKeys(ISSUER, [MODULUS]);
    const store = new NullifierStore();
    const challenge = issueChallenge();
    let pairings = 0;

    const options = {
      verifyingKey: {},
      spend: (e: number, n: string) => store.spend(e, n),
      verifier: async () => {
        pairings += 1;
        return false;
      },
    };
    const submission = {
      proof: {},
      publicSignals: signalsFor(challenge),
      challenge,
    };

    await verifySubmission(submission, options);
    await verifySubmission(submission, options);
    await verifySubmission(submission, options);

    expect(pairings).toBe(1);
  });
});

describe("the provider's key is checked, not assumed", () => {
  it("refuses a modulus the provider is not publishing", async () => {
    seedProviderKeys(ISSUER, [Buffer.alloc(256, 0x11).toString("base64url")]);
    const store = new NullifierStore();
    const challenge = issueChallenge();

    const result = await verifySubmission(
      { proof: {}, publicSignals: signalsFor(challenge), challenge },
      { verifyingKey: {}, spend: (e, n) => store.spend(e, n), verifier: alwaysValid() },
    );
    expect(result).toEqual({ ok: false, reason: "unaccepted-provider-key" });
  });

  it("accepts any key inside the rotation window, not only the newest", async () => {
    const older = Buffer.alloc(256, 0x11).toString("base64url");
    seedProviderKeys(ISSUER, [older, MODULUS]);
    const store = new NullifierStore();
    const challenge = issueChallenge();

    const result = await verifySubmission(
      { proof: {}, publicSignals: signalsFor(challenge), challenge },
      { verifyingKey: {}, spend: (e, n) => store.spend(e, n), verifier: alwaysValid() },
    );
    expect(result.ok).toBe(true);
  });

  it("round-trips a modulus through the circuit's limb representation", () => {
    const chunks = modulusToChunks(MODULUS);
    expect(chunks).toHaveLength(RSA_MODULUS_CHUNKS);
    // 17 limbs of 121 bits covers 2057 bits, enough for RSA-2048 and no more.
    for (const limb of chunks) expect(limb < 1n << 121n).toBe(true);

    let rebuilt = 0n;
    for (let index = chunks.length - 1; index >= 0; index -= 1) {
      rebuilt = (rebuilt << 121n) | chunks[index];
    }
    let expectedValue = 0n;
    for (const byte of Buffer.from(MODULUS, "base64url")) {
      expectedValue = (expectedValue << 8n) | BigInt(byte);
    }
    expect(rebuilt).toBe(expectedValue);
  });
});

describe("the signal layout is pinned", () => {
  it("rejects a submission with the wrong number of signals", async () => {
    seedProviderKeys(ISSUER, [MODULUS]);
    const store = new NullifierStore();
    const challenge = issueChallenge();
    const short = signalsFor(challenge).slice(0, -1);

    expect(
      await verifySubmission(
        { proof: {}, publicSignals: short, challenge },
        { verifyingKey: {}, spend: (e, n) => store.spend(e, n), verifier: alwaysValid() },
      ),
    ).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a signal that is not a field element", async () => {
    seedProviderKeys(ISSUER, [MODULUS]);
    const store = new NullifierStore();
    const challenge = issueChallenge();
    const signals = signalsFor(challenge);
    signals[0] = "0xdeadbeef";

    expect(
      await verifySubmission(
        { proof: {}, publicSignals: signals, challenge },
        { verifyingKey: {}, spend: (e, n) => store.spend(e, n), verifier: alwaysValid() },
      ),
    ).toEqual({ ok: false, reason: "malformed" });
  });

  it("keeps the digest and nonce at the indices the verifier reads", () => {
    // A verifier reading the wrong index accepts the wrong statement, and does
    // so silently. The layout is asserted rather than assumed.
    expect(OIDC_DIGEST_INDEX).toBe(RSA_MODULUS_CHUNKS);
    expect(NONCE_HASH_INDEX).toBe(RSA_MODULUS_CHUNKS + 1);
    expect(EXPECTED_SIGNAL_COUNT).toBe(RSA_MODULUS_CHUNKS + 3);
  });
});

describe("the platform is a verifier and never a prover", () => {
  it("declares no proving function anywhere in src/", () => {
    for (const file of walk(join(ROOT, "src"))) {
      if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
      if (file.includes(".test.")) continue;
      const source = readFileSync(file, "utf8");
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      const rel = relative(ROOT, file).split(sep).join("/");
      // `groth16.prove`, `plonk.prove`, `fullProve` — the platform running any
      // of these is the moment the separation collapses, because a prover we
      // operate is us.
      expect(code, `${rel} must not prove`).not.toMatch(
        /\b(fullProve|groth16\.prove|plonk\.prove)\b/,
      );
    }
  });

  it("declares only verification in the snarkjs type surface", () => {
    // Comments scrubbed: that file explains at length why it declares no
    // prover, and the explanation is not a declaration.
    const types = readFileSync(
      join(ROOT, "src", "types", "snarkjs.d.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(types).not.toContain("prove");
  });
});
