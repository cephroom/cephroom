import { createHash, randomBytes } from "node:crypto";

import {
  ACCEPTED_PROVIDERS,
  EXPECTED_SIGNAL_COUNT,
  NONCE_HASH_INDEX,
  OIDC_DIGEST_INDEX,
  RSA_MODULUS_CHUNKS,
  SYSTEM,
  type ProofSystem,
} from "./params";
import { isAcceptedModulus } from "./jwks";


export interface ZkProofSubmission {
  proof: unknown;
  publicSignals: string[];
  challenge: string;
}

export type VerifyFailure =
  | "malformed"
  | "unknown-challenge"
  | "challenge-spent"
  | "unaccepted-provider-key"
  | "challenge-mismatch"
  | "bad-proof";

export type VerifyResult =
  | { ok: true; subject: string }
  | { ok: false; reason: VerifyFailure };


export const CHALLENGE_TTL_MS = 10 * 60 * 1000;

interface IssuedChallenge {
  epoch: number;
}

/**
 * Named in PERMITTED_GLOBAL_STATE. Random bytes and an epoch, about nobody.
 *
 * A challenge exists so a proof cannot be replayed, which means it has to be
 * remembered between being issued and being spent. What is stored is the random
 * value itself and the epoch it was issued in - no subject, no address, nothing
 * that outlives two epochs, and a hard cap that evicts the oldest rather than
 * growing. That cap matters because this endpoint is reachable without signing
 * in.
 */
const globalForChallenges = globalThis as unknown as {
  __cephroomChallenges?: Map<string, IssuedChallenge>;
};

function challenges(): Map<string, IssuedChallenge> {
  globalForChallenges.__cephroomChallenges ??= new Map();
  return globalForChallenges.__cephroomChallenges;
}

export function challengeEpoch(now: number = Date.now()): number {
  return Math.floor(now / CHALLENGE_TTL_MS);
}

const MAX_OUTSTANDING = 50_000;

export function issueChallenge(now: number = Date.now()): string {
  const value = randomBytes(32).toString("hex");
  const epoch = challengeEpoch(now);

  for (const [key, issued] of challenges()) {
    if (issued.epoch < epoch - 1) challenges().delete(key);
  }

  while (challenges().size >= MAX_OUTSTANDING) {
    const oldest = challenges().keys().next();
    if (oldest.done) break;
    challenges().delete(oldest.value);
  }

  challenges().set(value, { epoch });
  return value;
}

export function outstandingChallenges(): number {
  return challenges().size;
}

export const MAX_OUTSTANDING_CHALLENGES = MAX_OUTSTANDING;

export function knownChallenge(value: string, now: number = Date.now()): boolean {
  const issued = challenges().get(value);
  if (!issued) return false;
  return issued.epoch >= challengeEpoch(now) - 1;
}

export function forgetChallenge(value: string): void {
  challenges().delete(value);
}

export function clearChallenges(): void {
  challenges().clear();
}

export function expectedNonceHash(challenge: string): [bigint, bigint] {
  const digest = createHash("sha256").update(challenge, "utf8").digest();
  const high = BigInt(`0x${digest.subarray(0, 16).toString("hex")}`);
  const low = BigInt(`0x${digest.subarray(16, 32).toString("hex")}`);
  return [high, low];
}


function parseSignals(signals: string[]): bigint[] | null {
  if (!Array.isArray(signals) || signals.length !== EXPECTED_SIGNAL_COUNT) {
    return null;
  }
  try {
    return signals.map((signal) => {
      if (typeof signal !== "string" || !/^\d+$/.test(signal)) {
        throw new Error("not a field element");
      }
      return BigInt(signal);
    });
  } catch {
    return null;
  }
}

/**
 * Contract 8. This exists, is tested, and nothing calls it - deliberately.
 *
 * The platform checks proofs and never produces them. The reason is structural
 * rather than about cost: a proof generated from a reader's token, on the
 * platform's hardware, demonstrates nothing to the platform it had not already
 * seen, because proving requires seeing the token. Zero-knowledge is a claim
 * about what the verifier learns, and it is void when the verifier is also the
 * prover. Any prover run here would be the platform.
 *
 * So proving belongs to the reader or to a party the reader chooses, and the
 * circuit pin, signal layout and accepted provider keys are published at
 * /api/zk/params so anyone can write one. A proof from a prover nobody here has
 * heard of verifies exactly like a proof from one they have -
 * prover-neutrality.test.ts asserts the submission type carries no prover
 * identity and that this path contains no allowlist.
 *
 * Building the verifier before any sign-in flow was the point: adding a list of
 * trusted provers looks like an operational improvement once a flow exists and
 * somebody is complaining about proof quality, and is much harder to argue
 * against then than now. The unbuilt half is stated on /privacy as published
 * rather than available, and stated-limits.test.ts fails if that claim and the
 * code ever disagree in either direction.
 *
 * The challenge is spent BEFORE the pairing check, so a caller cannot replay one
 * submission to make the platform do unbounded verification work.
 */
export async function verifySubmission(
  submission: ZkProofSubmission,
  options: {
    verifyingKey: unknown;
    system?: ProofSystem;
    issuer?: string;
    now?: number;
    spend: (epoch: number, nullifier: string) => { fresh: boolean };
    verifier?: (
      system: ProofSystem,
      vk: unknown,
      publicSignals: string[],
      proof: unknown,
    ) => Promise<boolean>;
  },
): Promise<VerifyResult> {
  const now = options.now ?? Date.now();
  const system = options.system ?? SYSTEM;
  const issuer = options.issuer ?? ACCEPTED_PROVIDERS[0];

  const signals = parseSignals(submission.publicSignals);
  if (!signals || typeof submission.challenge !== "string") {
    return { ok: false, reason: "malformed" };
  }

  if (!knownChallenge(submission.challenge, now)) {
    return { ok: false, reason: "unknown-challenge" };
  }

  const nullifier = createHash("sha256")
    .update(submission.challenge, "utf8")
    .digest("hex");
  const { fresh } = options.spend(challengeEpoch(now), nullifier);
  if (!fresh) return { ok: false, reason: "challenge-spent" };

  const modulus = signals.slice(0, RSA_MODULUS_CHUNKS);
  if (!isAcceptedModulus(issuer, modulus, now)) {
    return { ok: false, reason: "unaccepted-provider-key" };
  }

  const [high, low] = expectedNonceHash(submission.challenge);
  if (
    signals[NONCE_HASH_INDEX] !== high ||
    signals[NONCE_HASH_INDEX + 1] !== low
  ) {
    return { ok: false, reason: "challenge-mismatch" };
  }

  const verifier = options.verifier ?? defaultVerifier;
  let valid = false;
  try {
    valid = await verifier(
      system,
      options.verifyingKey,
      submission.publicSignals,
      submission.proof,
    );
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "bad-proof" };

  return { ok: true, subject: `z_${signals[OIDC_DIGEST_INDEX].toString(36)}` };
}

async function defaultVerifier(
  system: ProofSystem,
  vk: unknown,
  publicSignals: string[],
  proof: unknown,
): Promise<boolean> {
  const snarkjs = await import("snarkjs");
  return system === "plonk"
    ? snarkjs.plonk.verify(vk as never, publicSignals, proof as never)
    : snarkjs.groth16.verify(vk as never, publicSignals, proof as never);
}
