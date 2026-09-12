
export type Nullifier = string;

const NULLIFIER_PATTERN = /^[0-9a-f]{64}$/;

export interface SpendResult {
  fresh: boolean;
}

export class NullifierStore {
  private readonly epochs = new Map<number, Set<Nullifier>>();

  constructor(private readonly keepEpochs: number = 2) {}

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
