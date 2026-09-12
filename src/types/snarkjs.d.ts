/**
 * snarkjs ships no types. Only the two verification entry points are declared,
 * deliberately: the platform is a verifier and must never gain the ability to
 * prove. If a `prove` signature ever appears in this file, something has gone
 * wrong — see docs/PROVER-PROTOCOL.md on why the platform does not operate a
 * prover, not even a default one, not even for convenience.
 */
declare module "snarkjs" {
  type VerificationKey = Record<string, unknown>;
  type Proof = Record<string, unknown>;

  export const plonk: {
    verify(
      vk: VerificationKey,
      publicSignals: string[],
      proof: Proof,
    ): Promise<boolean>;
  };

  export const groth16: {
    verify(
      vk: VerificationKey,
      publicSignals: string[],
      proof: Proof,
    ): Promise<boolean>;
  };
}
