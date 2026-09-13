import { createPublicKey, verify as verifySignature } from "node:crypto";

/**
 * Verifying that an agent controls the key it presents - contract 3, the agent
 * case.
 *
 * A person proves who they are by an OAuth round-trip. An agent has no email and
 * cannot solve a human challenge, so it proves control of a keypair instead: it
 * signs a one-time challenge the platform issued, and the platform checks the
 * signature against the public key. This is the proof-of-possession that agent
 * identity has converged on (DIDs, delegation keys). It is verification, not a
 * lookup - the platform checks a signature and stores nothing, and the "identity"
 * established is only "you hold this key", which is all an agent's identity is.
 *
 * The key is ECDSA P-256 because that is what WebCrypto generates and signs in
 * every browser, so the same agent flow runs in a browser and in a script. The
 * signature is the raw r||s pair WebCrypto produces (ieee-p1363), over the
 * challenge bytes, hashed with SHA-256.
 *
 * A caller can only ever prove control of a key it holds, so the worst it can do
 * is authenticate as its OWN a_ subject (see agentSubject in keys/tokens.ts). It
 * cannot forge another agent's, and the a_ prefix keeps it off a person's s_.
 */
export function verifyAgentSignature(input: {
  publicKeySpkiBase64: string;
  challenge: string;
  signatureBase64: string;
}): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(input.publicKeySpkiBase64, "base64"),
      format: "der",
      type: "spki",
    });
    if (key.asymmetricKeyType !== "ec") return false;

    return verifySignature(
      "sha256",
      Buffer.from(input.challenge, "utf8"),
      { key, dsaEncoding: "ieee-p1363" },
      Buffer.from(input.signatureBase64, "base64"),
    );
  } catch {
    return false;
  }
}
