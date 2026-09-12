
export type Nullifier = string;

const NULLIFIER_PATTERN = /^[0-9a-f]{64}$/;

export interface SpendResult {
  fresh: boolean;
}

/**
 * Contract 2's one named exception, and the reason it is survivable.
 *
 * A blind signature cannot stop the same token being spent twice unless
 * something remembers that it was spent, so "the platform stores nothing"
 * stopped being literally true and was restated rather than quietly left
 * inaccurate.
 *
 * What is in it: one opaque 32-byte hash per redemption, derived from a nonce
 * the issuer has never seen. Not a person, not an account, not a column, and
 * nothing that can be joined to either. What bounds it: two epochs, pruned on
 * every spend, in memory, gone with the process.
 *
 * The shape is the argument. A Set of fixed-width hashes has no room for a
 * payload - there is nowhere to add a timestamp, an address or a count without
 * changing the type, which makes the growth of this record a visible diff
 * rather than a quiet one. no-user-data.test.ts spends forty epochs and asserts
 * the size stays at two.
 */
export class NullifierStore {
  private readonly epochs = new Map<number, Set<Nullifier>>();

  constructor(private readonly keepEpochs: number = 2) {}

/**
 * Throws on a malformed nullifier rather than storing it.
 *
 * The pattern is the only thing keeping this Set from accepting arbitrary
 * strings, and an arbitrary string is somewhere a caller could put something
 * about a person. Rejecting loudly means a bug that starts passing the wrong
 * value is a crash, not a slow accumulation of unbounded keys.
 */
  spend(epoch: number, nullifier: Nullifier): SpendResult {
    if (!NULLIFIER_PATTERN.test(nullifier)) {
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

  private prune(currentEpoch: number): void {
    const oldest = currentEpoch - this.keepEpochs + 1;
    for (const epoch of this.epochs.keys()) {
      if (epoch < oldest) this.epochs.delete(epoch);
    }
  }

  size(): number {
    let total = 0;
    for (const bucket of this.epochs.values()) total += bucket.size;
    return total;
  }

  liveEpochs(): number[] {
    return [...this.epochs.keys()].sort((a, b) => a - b);
  }

  clear(): void {
    this.epochs.clear();
  }
}

const globalForNullifiers = globalThis as unknown as {
  __cephroomNullifiers?: NullifierStore;
};

export function nullifierStore(): NullifierStore {
  globalForNullifiers.__cephroomNullifiers ??= new NullifierStore();
  return globalForNullifiers.__cephroomNullifiers;
}
