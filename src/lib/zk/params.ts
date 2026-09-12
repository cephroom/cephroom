
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
