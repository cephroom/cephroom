/**
 * The usage record: a hash chain both parties sign as data flows.
 *
 * ## The problem
 *
 * Usage has to be mutable — it grows as bytes move — and tamper-evident, and
 * it cannot live on the platform, because a per-reader running total is
 * exactly the state Contract 1 forbids. A signed token is immutable. So the
 * record is not a value that changes; it is a **chain of signed statements**,
 * each committing to the one before, held by the two parties who made it.
 *
 * ## Why both signatures
 *
 * A receipt counts only when it carries both. That single rule closes the two
 * obvious frauds without anybody supervising anything:
 *
 * - **A contributor cannot forge a higher figure**, because a higher figure
 *   needs the consumer's signature over it and they do not have the
 *   consumer's key.
 * - **A consumer cannot forge a lower one**, because forging is pointless: the
 *   contributor holds the highest dual-signed receipt and presents *that* at
 *   settlement. A consumer who stops signing simply stops receiving.
 *
 * Neither side is trusted and neither side is watched. Each is left in a
 * position where the only way to get what they want is to sign honestly.
 *
 * ## Why a chain and not a counter
 *
 * `cumulativeUnits` is monotonic, so the highest receipt subsumes every
 * earlier one and settlement needs only the last. The `prev` hash is what
 * makes a *gap* detectable: a party cannot quietly drop a link and present a
 * later one, because the chain would not reconstruct. It also pins order,
 * which matters when deciding who stopped writing first.
 *
 * ## Replay
 *
 * Every receipt names its grant (`aid`) and its session (`sid`). A receipt
 * from one session is meaningless in another, and presenting the same one
 * twice gains nothing because settlement takes the **maximum** cumulative
 * figure per session rather than a sum.
 *
 * Pure: no I/O, no Node built-ins, so the reader's browser, the contributor's
 * node and the settlement path all run this same code.
 */

export interface ReceiptBody {
  /** The allowance grant being drawn down. */
  aid: string;
  /** This session. Random per connection. */
  sid: string;
  /** Position in the chain, from 0. */
  seq: number;
  /** Hex SHA-256 of the previous receipt's canonical bytes; null at seq 0. */
  prev: string | null;
  /** Units consumed in this session so far. Monotonic, never decreasing. */
  cumulativeUnits: number;
  /** Public key of the consumer, as the grant binds it. */
  consumerKey: string;
  /** Public key of the contributor's node. */
  contributorKey: string;
  /** Pseudonymous subject of the contributor, for payment. */
  contributorSub: string;
  /** What is being served. Present so a receipt cannot be moved between items. */
  itemId: string;
}

export interface Receipt extends ReceiptBody {
  /** Ed25519 over the canonical bytes, by the consumer. Signed first. */
  consumerSig: string;
  /** Ed25519 over the same bytes, by the contributor. Countersigned. */
  contributorSig: string;
}

/**
 * The exact bytes both parties sign.
 *
 * Field order is fixed and the encoding is explicit. `JSON.stringify` over an
 * object literal would work today and break the moment a key is reordered or a
 * field added, and it would break *silently* — signatures would stop verifying
 * for reasons nobody could see in a diff. So the shape is written out.
 */
export function canonicalBytes(body: ReceiptBody): string {
  return [
    "cephroom-receipt/1",
    body.aid,
    body.sid,
    String(body.seq),
    body.prev ?? "-",
    String(body.cumulativeUnits),
    body.consumerKey,
    body.contributorKey,
    body.contributorSub,
    body.itemId,
  ].join("\n");
}

export type Verify = (
  publicKey: string,
  signature: string,
  message: string,
) => Promise<boolean>;

export type Sign = (message: string) => Promise<string>;

export interface ChainProblem {
  seq: number;
  reason:
    | "bad-consumer-signature"
    | "bad-contributor-signature"
    | "broken-link"
    | "non-monotonic"
    | "sequence-gap"
    | "grant-mismatch"
    | "session-mismatch"
    | "party-mismatch"
    | "self-dealing";
}

export interface ChainResult {
  ok: boolean;
  /** The highest cumulative figure the chain proves. Zero on any problem. */
  units: number;
  problems: ChainProblem[];
}

/**
 * Walks a chain and says what it proves.
 *
 * **Fails closed.** Any problem at all yields zero units, not "the units up to
 * the break". A chain with a bad link is a chain somebody edited, and the
 * honest response to evidence of editing is to believe none of it rather than
 * to salvage the part that still parses.
 */
export async function verifyChain(
  receipts: Receipt[],
  expected: { aid: string; sid: string; consumerKey: string },
  verify: Verify,
): Promise<ChainResult> {
  const problems: ChainProblem[] = [];
  if (receipts.length === 0) return { ok: true, units: 0, problems };

  let previousHash: string | null = null;
  let previousUnits = -1;

  for (let index = 0; index < receipts.length; index += 1) {
    const receipt = receipts[index];
    const note = (reason: ChainProblem["reason"]) =>
      problems.push({ seq: receipt.seq, reason });

    if (receipt.aid !== expected.aid) note("grant-mismatch");
    if (receipt.sid !== expected.sid) note("session-mismatch");
    if (receipt.consumerKey !== expected.consumerKey) note("party-mismatch");
    if (receipt.seq !== index) note("sequence-gap");
    if (receipt.prev !== previousHash) note("broken-link");
    if (receipt.cumulativeUnits <= previousUnits) note("non-monotonic");

    // A contributor serving themselves is the one collusion shape that is
    // free to detect, so it is detected. Two colluding subjects are not, and
    // that boundary is stated in docs/EARNINGS.md rather than pretended away.
    if (receipt.contributorKey === receipt.consumerKey) note("self-dealing");

    const message = canonicalBytes(receipt);
    if (!(await verify(receipt.consumerKey, receipt.consumerSig, message))) {
      note("bad-consumer-signature");
    }
    if (
      !(await verify(receipt.contributorKey, receipt.contributorSig, message))
    ) {
      note("bad-contributor-signature");
    }

    previousHash = await hashReceipt(receipt);
    previousUnits = receipt.cumulativeUnits;
  }

  if (problems.length > 0) return { ok: false, units: 0, problems };
  return { ok: true, units: previousUnits, problems };
}

/** Hex SHA-256 of a receipt's canonical bytes. WebCrypto, so it runs anywhere. */
export async function hashReceipt(body: ReceiptBody): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalBytes(body));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Builds the next unsigned body in a chain.
 *
 * The consumer calls this, signs it, and sends it **before** the bytes it pays
 * for. Receipt-then-data rather than data-then-receipt: see the note on
 * disconnect timing in docs/EARNINGS.md. Whoever is exposed by a mid-flight
 * disconnect is a design choice, and this one exposes the consumer by at most
 * one chunk rather than exposing the contributor, which matches the rule that
 * a contributor who does the work gets paid for it.
 */
export async function nextBody(
  previous: Receipt | null,
  delta: number,
  shape: Omit<ReceiptBody, "seq" | "prev" | "cumulativeUnits">,
): Promise<ReceiptBody> {
  if (!Number.isFinite(delta) || delta <= 0) {
    throw new Error("A receipt must record at least one unit.");
  }
  return {
    ...shape,
    seq: previous ? previous.seq + 1 : 0,
    prev: previous ? await hashReceipt(previous) : null,
    cumulativeUnits: (previous?.cumulativeUnits ?? 0) + delta,
  };
}
