import { createHash } from "node:crypto";

/**
 * Turning a JWT into the circuit's inputs, then into a proof.
 *
 * Split out of `prover.ts` so the witness construction — the fiddly part, and
 * the part where a mistake produces a proof of the wrong statement — can be
 * tested without a server or a 3 GB proving key.
 *
 * The circuit is `jwt-tx-validation.circom` from
 * Moonsong-Labs/zksync-social-login-circuit at commit 27cda6e, audited by
 * OpenZeppelin in April 2025. Its inputs are mostly *indices*: it does not
 * parse JSON, it is told where in the payload each claim sits and checks that
 * what is there matches. Computing those indices is this file's job, and
 * getting one wrong makes the proof fail to verify rather than prove something
 * weaker — which is the safe direction, and is why the indices are derived
 * here rather than supplied by the caller.
 */

export interface JwtParts {
  header: string;
  payload: string;
  signature: string;
}

export function splitJwt(jwt: string): JwtParts {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("A JWT has three parts.");
  const [header, payload, signature] = parts;
  if (!header || !payload || !signature) throw new Error("A JWT part is empty.");
  return { header, payload, signature };
}

/** The decoded payload, for locating claims. Never returned to a caller. */
export function decodePayload(payloadB64: string): string {
  return Buffer.from(payloadB64, "base64url").toString("utf8");
}

/**
 * Finds where a claim's value starts, and how long it is.
 *
 * The circuit is told the index of `"name":` and the length of the value that
 * follows. Returning a length of zero where the claim is missing lets the
 * caller fail loudly rather than proving over a claim that is not there.
 */
export function locateClaim(
  payload: string,
  claim: string,
): { keyStartIndex: number; asciiLength: number } {
  const needle = `"${claim}":`;
  const keyStartIndex = payload.indexOf(needle);
  if (keyStartIndex === -1) {
    throw new Error(`The token has no "${claim}" claim.`);
  }

  let cursor = keyStartIndex + needle.length;
  while (cursor < payload.length && /\s/.test(payload[cursor])) cursor += 1;
  if (payload[cursor] !== '"') {
    throw new Error(`The "${claim}" claim is not a string.`);
  }

  const valueStart = cursor + 1;
  const valueEnd = payload.indexOf('"', valueStart);
  if (valueEnd === -1) throw new Error(`The "${claim}" claim is unterminated.`);

  return { keyStartIndex, asciiLength: valueEnd - valueStart };
}

/**
 * The nonce the user must have put in their OIDC request.
 *
 * The platform issues a challenge; the client asks Google to embed this value
 * as the `nonce` claim; the circuit recomputes a hash of that claim and
 * exposes it publicly, so the platform can check the proof answers the
 * challenge it issued rather than one from somebody else's session.
 *
 * Base64url of the SHA-256, which is 43 characters — the circuit's nonce
 * handling expects a 44-character base64url value, so it is padded to that.
 */
export function nonceForChallenge(challenge: string): string {
  const digest = createHash("sha256").update(challenge, "utf8").digest();
  return digest.toString("base64url").padEnd(44, "=");
}

/** The two field elements the circuit exposes for that nonce. */
export function nonceContentHash(challenge: string): [string, string] {
  const digest = createHash("sha256").update(challenge, "utf8").digest();
  return [
    BigInt(`0x${digest.subarray(0, 16).toString("hex")}`).toString(),
    BigInt(`0x${digest.subarray(16, 32).toString("hex")}`).toString(),
  ];
}

/** Splits a big-endian byte buffer into little-endian limbs of `bits`. */
export function toChunks(bytes: Buffer, bits = 121, count = 17): string[] {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  const mask = (1n << BigInt(bits)) - 1n;
  return Array.from({ length: count }, (_, index) =>
    ((value >> (BigInt(bits) * BigInt(index))) & mask).toString(),
  );
}

/**
 * SHA-256 padding, applied to `header.payload` before it enters the circuit.
 *
 * The circuit takes an already-padded message because padding inside a circuit
 * costs constraints for no security. Getting this wrong yields a proof that
 * does not verify.
 */
export function sha256Pad(message: Buffer, maxLength: number): Buffer {
  const bitLength = BigInt(message.length) * 8n;
  const padded = Buffer.alloc(maxLength);
  message.copy(padded);
  padded[message.length] = 0x80;

  // Length goes in the last eight bytes of the final 64-byte block used.
  const blocks = Math.ceil((message.length + 1 + 8) / 64);
  if (blocks * 64 > maxLength) {
    throw new Error("The token is longer than this circuit accepts.");
  }
  padded.writeBigUInt64BE(bitLength, blocks * 64 - 8);
  return padded;
}

export interface ProveInput {
  jwt: string;
  challenge: string;
  salt: string;
  system: "plonk" | "groth16";
  wasm: string;
  zkey: string;
}

/**
 * Builds the witness and proves.
 *
 * `salt` is the user's and arrives with the request. It never leaves this
 * process and is not written anywhere — it is what makes the resulting
 * `oidcDigest` unlinkable to the Google account, so a prover that kept it
 * would be keeping the one thing that undoes the whole scheme.
 */
export async function proveJwt(input: ProveInput): Promise<{
  proof: unknown;
  publicSignals: string[];
}> {
  const { header, payload, signature } = splitJwt(input.jwt);
  const decoded = decodePayload(payload);

  const nonce = locateClaim(decoded, "nonce");
  if (!decoded.includes(nonceForChallenge(input.challenge).replace(/=+$/, ""))) {
    throw new Error(
      "This token's nonce does not answer that challenge. Sign in again with the challenge the platform issued.",
    );
  }

  const message = Buffer.from(`${header}.${payload}`, "utf8");
  const MAX_MESSAGE = 1216; // multiple of 64, comfortably over a Google id_token

  const witness = {
    messageBytes: Array.from(sha256Pad(message, MAX_MESSAGE)),
    messageByteLength: message.length,
    signatureChunks: toChunks(Buffer.from(signature, "base64url")),
    periodIndex: header.length,
    ...claimIndices(decoded),
    nonceKeyStartIndex: nonce.keyStartIndex,
    nonceAsciiLength: nonce.asciiLength,
    nonceContentHash: nonceContentHash(input.challenge),
    salt: input.salt,
  };

  // Imported here rather than at module scope so that `prover.ts` starts, and
  // reports itself honestly as not ready, on a machine with no snarkjs.
  const snarkjs = (await import("snarkjs")) as unknown as {
    plonk: { fullProve: Prove };
    groth16: { fullProve: Prove };
  };
  const prove =
    input.system === "plonk" ? snarkjs.plonk.fullProve : snarkjs.groth16.fullProve;

  const { proof, publicSignals } = await prove(witness, input.wasm, input.zkey);
  return { proof, publicSignals };
}

type Prove = (
  witness: Record<string, unknown>,
  wasm: string,
  zkey: string,
) => Promise<{ proof: unknown; publicSignals: string[] }>;

function claimIndices(payload: string) {
  const iss = locateClaim(payload, "iss");
  const aud = locateClaim(payload, "aud");
  const sub = locateClaim(payload, "sub");
  return {
    issKeyStartIndex: iss.keyStartIndex,
    issAsciiLength: iss.asciiLength,
    audKeyStartIndex: aud.keyStartIndex,
    audAsciiLength: aud.asciiLength,
    subKeyStartIndex: sub.keyStartIndex,
    subAsciiLength: sub.asciiLength,
  };
}
