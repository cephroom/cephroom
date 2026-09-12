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
