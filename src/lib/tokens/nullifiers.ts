/**
 * The spent-token set.
 *
 * This is state, and it is the first thing in this platform that is. It is
 * recorded as an explicit, bounded exception in docs/CONTRACTS.md rather than
 * argued away, because a blind signature scheme cannot prevent double-spending
 * without remembering what has been spent, and a platform that hands out
 * unlimited access is not a platform anybody can run.
 *
 * What makes it tolerable is what it is *not*:
 *
 * - An entry is an opaque 32-byte hash of a token nonce the platform has never
 *   seen before the moment of redemption, and — by the unlinkability property
 *   of RFC 9474 blind RSA — cannot associate with the issuance that produced
 *   it. There is no person on the other end of it.
 * - An entry holds **nothing else**. No timestamp finer than the epoch, no
 *   address, no user agent, no tier beyond the epoch bucket it sits in, no
 *   count. `tests/contracts/nullifier-shape.test.ts` fails if that changes,
 *   because the temptation to add "just a timestamp, for debugging" is exactly
 *   how an opaque set becomes a log.
 * - It is bounded in time rather than growing forever. Entries live in epoch
 *   buckets and an epoch is dropped whole once its signing key is retired, so
 *   the set's size is a function of traffic in the last two hours and not of
 *   traffic ever.
 * - It is RAM, and dies with the process, like the presence registry.
 *
 * The honest residual: an operator watching this process could see redemptions
 * arrive and count them. They could not tell whose they were, nor that two of
 * them came from the same subscriber, which is the property Layer 1 exists to
 * provide.
 */

/** A nullifier is the hex of a 32-byte hash. Nothing else is a valid entry. */
export type Nullifier = string;

const NULLIFIER_PATTERN = /^[0-9a-f]{64}$/;

export interface SpendResult {
  /** False when this token has already been redeemed in this epoch. */
  fresh: boolean;
}

/**
 * A set of spent nullifiers, bucketed by epoch.
 *
 * Deliberately not a Map<string, something>. The value type is the thing that
 * rots: once an entry can carry a payload, somebody will put a timestamp in
 * it. A Set can only remember that a thing happened, which is all
 * double-spend prevention needs.
 */
export class NullifierStore {
  private readonly epochs = new Map<number, Set<Nullifier>>();

  /** How many epochs are kept. Older buckets are dropped whole. */
  constructor(private readonly keepEpochs: number = 2) {}

  /**
   * Records a nullifier as spent, and says whether it was already.
   *
   * The check and the insert are one operation on purpose: a caller that read
   * first and wrote second would have a window in which the same token could
   * be redeemed twice.
   */
  spend(epoch: number, nullifier: Nullifier): SpendResult {
    if (!NULLIFIER_PATTERN.test(nullifier)) {
      // Not a shape this store accepts. Refusing is safer than storing an
      // unexpected string, which is how something identifying gets in.
      throw new Error("A nullifier must be 64 lowercase hex characters.");
    }

    this.prune(epoch);

    let bucket = this.epochs.get(epoch);
    if (!bucket) {
      bucket = new Set<Nullifier>();
      this.epochs.set(epoch, bucket);
    }

    if (bucket.has(nullifier)) return { fresh: false };
    bucket.add(nullifier);
    return { fresh: true };
  }

  /** Drops every epoch older than the window. Called on write, never swept. */
  private prune(currentEpoch: number): void {
    const oldest = currentEpoch - this.keepEpochs + 1;
    for (const epoch of this.epochs.keys()) {
      if (epoch < oldest) this.epochs.delete(epoch);
    }
  }

  /** Total entries held. For a health check; deliberately not per-epoch. */
  size(): number {
    let total = 0;
    for (const bucket of this.epochs.values()) total += bucket.size;
    return total;
  }

  /** Epochs currently held. Used by the contract test. */
  liveEpochs(): number[] {
    return [...this.epochs.keys()].sort((a, b) => a - b);
  }

  /** Everything forgotten. Used by tests, and by nothing else. */
  clear(): void {
    this.epochs.clear();
  }
}

/**
 * The process-wide store.
 *
 * Held on globalThis for the same reason the presence registry is: Next's dev
 * server re-evaluates modules, and a store that reset on every hot reload
 * would silently stop preventing double-spends in development — the one
 * environment where anybody would notice.
 */
const globalForNullifiers = globalThis as unknown as {
  __cephroomNullifiers?: NullifierStore;
};

export function nullifierStore(): NullifierStore {
  globalForNullifiers.__cephroomNullifiers ??= new NullifierStore();
  return globalForNullifiers.__cephroomNullifiers;
}
