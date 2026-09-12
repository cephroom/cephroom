/**
 * The published verification parameters.
 *
 * Everything a verifier needs, and nothing about who produced a proof. This
 * file is the whole of the platform's trust in the zero-knowledge path: a
 * circuit, a proof system, a verification key, and the set of identity-provider
 * keys currently accepted. No prover appears anywhere in it, because prover
 * identity is not an input to verification and must never become one.
 *
 * These values are served at `/api/zk/params` so that anybody — a prover
 * operator, a suspicious reader, a researcher — can fetch them, regenerate the
 * verification key from the pinned circuit and the public ceremony, and check
 * the hash matches. That check is the point. See docs/PROVER-PROTOCOL.md.
 */

/** Proof systems a deployment may pin. The choice is published, not implied. */
export type ProofSystem = "plonk" | "groth16";

export interface CircuitPin {
  /** Stable id, so a proof can name which circuit it was made for. */
  id: string;
  /** Where the circuit source lives, and the exact commit it is pinned to. */
  repository: string;
  commit: string;
  /** The file within that repository. */
  path: string;
  /** Who audited it, when, and what they found. Empty means: nobody has. */
  audit: {
    auditor: string;
    published: string;
    reportUrl: string;
    findings: string;
  } | null;
}

export interface VerificationParams {
  circuit: CircuitPin;
  system: ProofSystem;
  /**
   * SHA-256 of the verification key, hex.
   *
   * Published so it can be checked rather than trusted. Under a deterministic
   * setup (PLONK) anyone can regenerate the key from the circuit and the
   * public powers-of-tau and confirm this hash; under Groth16 they cannot,
   * which is precisely the difference the protocol document argues about.
   */
  verificationKeyHash: string;
  /**
   * The order of the circuit's public signals.
   *
   * Named rather than positional-by-convention. A verifier that reads the
   * wrong index is a verifier that accepts the wrong statement, and that
   * failure is silent.
   */
  publicSignalLayout: readonly string[];
  /** Identity providers whose signing keys are currently accepted. */
  providers: readonly string[];
}

/**
 * The circuit this deployment accepts proofs for.
 *
 * **Not written here.** It is `jwt-tx-validation.circom` from
 * Moonsong-Labs/zksync-social-login-circuit, audited by OpenZeppelin between
 * 24 March and 11 April 2025 — nine findings, none critical, none high, all
 * resolved. An under-constrained circuit still produces proofs that verify; it
 * just proves something weaker than intended, and every test passes. That is
 * the highest-risk part of this work and the reason for using somebody else's
 * reviewed circuit rather than writing one.
 *
 * What it proves, which is exactly what is needed here:
 *
 * - the JWT was signed RSA-SHA256 by a key whose modulus is a **public** input,
 *   so the verifier can check that modulus against the provider's live JWKS;
 * - `oidcDigest = Poseidon(iss, aud, sub, salt)` — a **public** output that
 *   becomes the pseudonymous subject, and which reveals nothing about the
 *   Google account without the salt, which never leaves the user;
 * - the JWT's `nonce` claim hashes to a **public** `nonceContentHash`
 *   recomputed inside the circuit from a private blinding factor, which is how
 *   a proof binds to a challenge instead of being replayable anywhere.
 *
 * The JWT itself, the signature, and the salt are private inputs. They are seen
 * by the prover and never by the platform.
 */
export const CIRCUIT: CircuitPin = {
  id: "jwt-tx-validation@27cda6e",
  repository: "https://github.com/Moonsong-Labs/zksync-social-login-circuit",
  commit: "27cda6e74492fbad4aa3ca37ff5084ed391b534b",
  path: "jwt-tx-validation.circom",
  audit: {
    auditor: "OpenZeppelin",
    published: "2025-04-11",
    reportUrl:
      "https://www.openzeppelin.com/news/sso-account-recovery-circuits-audit",
    findings: "9 total — 0 critical, 0 high, 2 medium, 3 low, 4 notes; all resolved",
  },
};

/**
 * The public signals, in circuit order.
 *
 * `rsaModulusChunks` is 17 chunks of 121 bits for RSA-2048 in this circuit's
 * parameterisation, and `nonceContentHash` is two field elements.
 */
export const PUBLIC_SIGNAL_LAYOUT = [
  ...Array.from({ length: 17 }, (_, i) => `rsaModulusChunk[${i}]`),
  "oidcDigest",
  "nonceContentHash[0]",
  "nonceContentHash[1]",
] as const;

export const RSA_MODULUS_CHUNKS = 17;
export const OIDC_DIGEST_INDEX = RSA_MODULUS_CHUNKS;
export const NONCE_HASH_INDEX = RSA_MODULUS_CHUNKS + 1;
export const EXPECTED_SIGNAL_COUNT = RSA_MODULUS_CHUNKS + 3;

/**
 * Which proof system this deployment pins, and why it is a deployment choice.
 *
 * Measured here, in a browser and in Node, at four circuit sizes:
 *
 * | | Groth16 | PLONK |
 * | --- | --- | --- |
 * | verification | ~8 ms | ~10 ms |
 * | proof size | 724 B | 2,097 B |
 * | proving key | 513 B/constraint (~0.55 GB at 1.1M) | 2,738 B/constraint (~3.0 GB) |
 * | proving (snarkjs) | ~31 s floor at 1.1M | ~10 min floor at 1.1M |
 * | setup | **per circuit, with toxic waste** | **universal and deterministic** |
 *
 * Verification cost and proof size are irrelevant either way — both are
 * milliseconds and kilobytes, and both are constant in circuit size, which is
 * the asymmetry that makes this whole architecture work.
 *
 * The setup row is the one that decides it. Two independent PLONK setups of the
 * same circuit produce **byte-identical** keys — verified by hashing them — so
 * there is no secret to leak and anyone can regenerate and check. Two Groth16
 * contributions produce different keys, because each injects randomness whose
 * destruction is an assumption. A Groth16 ceremony with one contributor means
 * that contributor can forge proofs for every user forever.
 *
 * So: PLONK by default. A deployment that can run a credible multi-party
 * Groth16 ceremony may pin `groth16` instead and take the ~20x proving speedup
 * — and must then publish whose ceremony it is. The verifier does not care
 * which; it reads this field.
 */
export const SYSTEM: ProofSystem =
  (process.env.ZK_PROOF_SYSTEM as ProofSystem | undefined) ?? "plonk";

/** Identity providers whose JWKS the verifier will accept a modulus from. */
export const ACCEPTED_PROVIDERS = ["https://accounts.google.com"] as const;
