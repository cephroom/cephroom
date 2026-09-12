import { createHash } from "node:crypto";


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

export function decodePayload(payloadB64: string): string {
  return Buffer.from(payloadB64, "base64url").toString("utf8");
}

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

export function nonceForChallenge(challenge: string): string {
  const digest = createHash("sha256").update(challenge, "utf8").digest();
  return digest.toString("base64url").padEnd(44, "=");
}

export function nonceContentHash(challenge: string): [string, string] {
  const digest = createHash("sha256").update(challenge, "utf8").digest();
  return [
    BigInt(`0x${digest.subarray(0, 16).toString("hex")}`).toString(),
    BigInt(`0x${digest.subarray(16, 32).toString("hex")}`).toString(),
  ];
}

export function toChunks(bytes: Buffer, bits = 121, count = 17): string[] {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  const mask = (1n << BigInt(bits)) - 1n;
  return Array.from({ length: count }, (_, index) =>
    ((value >> (BigInt(bits) * BigInt(index))) & mask).toString(),
  );
}

export function sha256Pad(message: Buffer, maxLength: number): Buffer {
  const bitLength = BigInt(message.length) * 8n;
  const padded = Buffer.alloc(maxLength);
  message.copy(padded);
  padded[message.length] = 0x80;

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
  const MAX_MESSAGE = 1216;

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
