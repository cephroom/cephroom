
export type ProofSystem = "plonk" | "groth16";

export interface CircuitPin {
  id: string;
  repository: string;
  commit: string;
  path: string;
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
  verificationKeyHash: string;
  publicSignalLayout: readonly string[];
  providers: readonly string[];
}

/**
 * Published so that anyone can write a prover this platform has no say over.
 *
 * Contract 8 means proving belongs to the reader or to a party the reader
 * chooses, and that is only true if the thing to prove is public. A circuit
 * pinned to a commit, a fixed signal layout and a named set of accepted
 * provider keys are the whole interface: a proof from a prover nobody here has
 * heard of verifies exactly like one from a prover they have.
 *
 * Pinning to a commit rather than a version is the point. "The latest audited
 * circuit" is a moving target, and a verifier that follows one is a verifier
 * whose behaviour changes without a diff here.
 *
 * The audit is recorded rather than summarised as "audited", because who
 * audited it, when, and what they found are the facts a reader would need to
 * disagree with the choice.
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
 * The layout is pinned because the verifier reads signals by index.
 *
 * A circuit that reordered its outputs would still produce valid proofs, and
 * this verifier would read a modulus limb where it expected a digest and accept
 * or reject on the wrong field. Nothing about that would look like a failure.
 * prover-neutrality.test.ts asserts the derived indices stay consistent with
 * the chunk count, so a change to one without the other fails here rather than
 * in production.
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

export const SYSTEM: ProofSystem =
  (process.env.ZK_PROOF_SYSTEM as ProofSystem | undefined) ?? "plonk";

export const ACCEPTED_PROVIDERS = ["https://accounts.google.com"] as const;
