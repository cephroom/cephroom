import {
  canonicalBytes,
  verifyChain,
  type Receipt,
} from "../src/lib/earnings/receipt";
import { unitsForBytes } from "../src/lib/earnings/units";

/**
 * The contributor's half of the metered handshake.
 *
 * Running on the node, because that is where the bytes are and where the
 * incentive lives. Nobody supervises this: a contributor who refuses to
 * countersign receives no receipt and is paid nothing, and a contributor who
 * tampers produces a chain that fails at settlement. The node's interest and
 * honest behaviour are the same thing, which is the design.
 *
 * ## The exchange, per chunk
 *
 *   consumer → receipt body, signed, for cumulative units U
 *   node     → verifies it continues the chain and pays for the next chunk
 *   node     → countersigns, returns the receipt
 *   node     → sends the chunk
 *
 * **Receipt before data, always.** Whoever is exposed by a disconnect is a
 * choice: this one exposes the consumer by at most one chunk rather than
 * exposing the contributor, because the party that did the work should be the
 * one holding the proof. A consumer who yanks the cable has already signed for
 * what they received.
 *
 * ## Exhaustion
 *
 * When the allowance runs out the node stops. Not as an error — as a state,
 * named, with the numbers, so both sides can see what happened. Continuing
 * would earn nothing, so no enforcement is needed; what is needed is that it
 * does not look like a crash.
 */

export const CHUNK_BYTES = 32 * 1024;

export interface MeterState {
  aid: string;
  sid: string;
  /** Units the grant is worth, from the platform-signed grant. */
  grantUnits: number;
  consumerKey: string;
  contributorKey: string;
  contributorSub: string;
  itemId: string;
  chain: Receipt[];
}

export type MeterOutcome =
  | { kind: "accepted"; receipt: Receipt; unitsNow: number; unitsLeft: number }
  | {
      kind: "exhausted";
      unitsSpent: number;
      grantUnits: number;
      message: string;
    }
  | { kind: "rejected"; reason: string; message: string };

/**
 * Takes a consumer-signed receipt, checks it, and countersigns.
 *
 * Everything that could make this receipt not worth money is checked *before*
 * signing it, because a countersignature is the node's commitment to serve.
 */
export async function meter(
  state: MeterState,
  offered: Omit<Receipt, "contributorSig">,
  sign: (message: string) => Promise<string>,
  verify: (key: string, signature: string, message: string) => Promise<boolean>,
): Promise<MeterOutcome> {
  const previous = state.chain[state.chain.length - 1] ?? null;
  const spent = previous?.cumulativeUnits ?? 0;

  if (spent >= state.grantUnits) {
    return {
      kind: "exhausted",
      unitsSpent: spent,
      grantUnits: state.grantUnits,
      message: `This allowance is used up — ${spent} of ${state.grantUnits} units. Top up and reconnect; nothing is wrong with the column or the connection.`,
    };
  }

  if (offered.cumulativeUnits > state.grantUnits) {
    // Offering more than the grant is worth is not fraud, it is a client that
    // has not noticed. Serve up to the ceiling rather than refusing outright.
    return {
      kind: "exhausted",
      unitsSpent: spent,
      grantUnits: state.grantUnits,
      message: `That would spend ${offered.cumulativeUnits} units of a ${state.grantUnits}-unit allowance. ${state.grantUnits - spent} left.`,
    };
  }

  const message = canonicalBytes(offered);
  if (!(await verify(state.consumerKey, offered.consumerSig, message))) {
    return {
      kind: "rejected",
      reason: "bad-consumer-signature",
      message: "That receipt is not signed by the key this grant names.",
    };
  }

  const receipt: Receipt = { ...offered, contributorSig: await sign(message) };

  // Re-verify the whole chain with the new link on the end. Cheap at these
  // lengths, and it means a node can never be walked into countersigning a
  // link that breaks a chain it already holds.
  const checked = await verifyChain(
    [...state.chain, receipt],
    { aid: state.aid, sid: state.sid, consumerKey: state.consumerKey },
    verify,
  );
  if (!checked.ok) {
    return {
      kind: "rejected",
      reason: checked.problems[0]?.reason ?? "bad-chain",
      message: `That receipt does not continue this session's chain (${checked.problems.map((p) => p.reason).join(", ")}).`,
    };
  }

  state.chain.push(receipt);
  return {
    kind: "accepted",
    receipt,
    unitsNow: receipt.cumulativeUnits,
    unitsLeft: state.grantUnits - receipt.cumulativeUnits,
  };
}

/** Units the next chunk of this size will cost. Published so nobody guesses. */
export function quote(bytes: number): number {
  return unitsForBytes(Math.min(bytes, CHUNK_BYTES));
}

/**
 * How a node reports a metered response that could not be completed.
 *
 * Exhaustion is a 402 with the numbers in it, not a 500 and not a silent
 * truncation. A reader who has run out should be able to read the response and
 * know exactly what happened and what to do, without anybody explaining it.
 */
export function exhaustionBody(outcome: Extract<MeterOutcome, { kind: "exhausted" }>) {
  return {
    error: "allowance-exhausted",
    unitsSpent: outcome.unitsSpent,
    grantUnits: outcome.grantUnits,
    unitsLeft: Math.max(0, outcome.grantUnits - outcome.unitsSpent),
    message: outcome.message,
    // What was served up to this point is paid for and valid. The connection
    // ending is not a loss of the bytes already delivered.
    servedSoFarIsValid: true,
  };
}
