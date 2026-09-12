
export const ISSUANCE_CONCURRENCY = 2;

/**
 * Named in PERMITTED_GLOBAL_STATE. Counts work in flight, never people.
 *
 * Blind signing is expensive, so something has to bound how much of it runs at
 * once or a subscriber can spend the server's CPU twelve signatures at a time.
 * The obvious bound is per-subscriber, and it is unavailable: a per-person
 * limit is a per-person counter, which is an activity record - contract 2.
 *
 * So the state here is one integer for the whole process. It does not know who
 * asked and cannot be made to. That means it throttles honest and abusive
 * callers alike during a burst, which is a worse mechanism than a per-person
 * limit and is the one that fits the contract. issuance-is-bounded.test.ts
 * asserts the slot is released even when the work throws, because a leaked slot
 * would degrade this into a permanent refusal.
 */
export class IssuanceGate {
  private active = 0;

  constructor(private readonly capacity: number = ISSUANCE_CONCURRENCY) {}

  inFlight(): number {
    return this.active;
  }

  tryEnter(): boolean {
    if (this.active >= this.capacity) return false;
    this.active += 1;
    return true;
  }

  leave(): void {
    this.active = Math.max(0, this.active - 1);
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } finally {
      this.leave();
    }
  }
}

const globalForGate = globalThis as unknown as {
  __cephroomIssuanceGate?: IssuanceGate;
};

export function issuanceGate(): IssuanceGate {
  globalForGate.__cephroomIssuanceGate ??= new IssuanceGate();
  return globalForGate.__cephroomIssuanceGate;
}
