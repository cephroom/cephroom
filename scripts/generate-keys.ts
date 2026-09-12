/**
 * Generates the Ed25519 signing pair and the subject HMAC secret.
 *
 * Rotating the signing key is the only revocation this design has: it
 * invalidates every key at once and signs everyone out. That is a blunt
 * instrument and it is the intended one - see docs/CONTRACTS.md.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

const pem = (key: { export: (o: never) => string | Buffer }, type: string) =>
  Buffer.from(
    key.export({ type, format: "pem" } as never) as string,
  ).toString("base64");

console.log("# Capability key signing pair (Ed25519), base64-encoded PEM.");
console.log(`CEPHROOM_SIGNING_KEY=${pem(privateKey, "pkcs8")}`);
console.log(`CEPHROOM_PUBLIC_KEY=${pem(publicKey, "spki")}`);
console.log();
console.log("# Derives pseudonymous subjects from provider account ids.");
console.log(`AUTH_SUBJECT_SECRET=${randomBytes(32).toString("base64url")}`);
