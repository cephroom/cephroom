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


const ISSUER = "https://accounts.google.com";

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
    expect(a.ok && b.ok && a.subject).toBe(b.ok ? b.subject : null);
  });

  it("takes no submission field that could identify a prover", () => {
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

    const result = await verifySubmission(
      { proof: {}, publicSignals: signalsFor(other), challenge: mine },
      { verifyingKey: {}, spend: (e, n) => store.spend(e, n), verifier: alwaysValid() },
    );
    expect(result).toEqual({ ok: false, reason: "challenge-mismatch" });
  });

  it("spends the challenge before checking the proof", async () => {
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
      expect(code, `${rel} must not prove`).not.toMatch(
        /\b(fullProve|groth16\.prove|plonk\.prove)\b/,
      );
    }
  });

  it("declares only verification in the snarkjs type surface", () => {
    const types = readFileSync(
      join(ROOT, "src", "types", "snarkjs.d.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(types).not.toContain("prove");
  });
});
