/**
 * A ceiling on how much signing work is in flight at once.
 *
 * Blind-signing a batch costs the platform twelve RSA-2048 signatures and a
 * Stripe call — measured at 6.3 seconds of platform time, and four concurrent
 * batches took 25.6 seconds because they serialise on CPU. Before this
 * existed, a single paying subscriber could occupy that path indefinitely
 * (6,375 tokens an hour, no refusals) and spend 574 Stripe calls an hour
 * doing it, competing with sign-in and billing for the same rate limit.
 *
 * The gate counts *work*, never people. That is not a simplification — it is
 * the only version available. A per-subscriber limit would be a per-person
 * activity record held in memory and consulted on every request, which is
 * precisely what Contract 1 forbids, and calling it a rate limiter rather
 * than a profile would not change what it is.
 *
 * What that buys and what it does not:
 *
 *   - The platform's cost per unit time is bounded regardless of who is
 *     asking or how many of them there are. Load turns into refusals rather
 *     than exhaustion, and honest subscribers — who top up rarely, twelve
 *     tokens at a time — never meet it.
 *   - It does not bound how much anonymous access one subscription yields.
 *     A patient farmer farms slower. Closing that needs person-linkable state
 *     (Contract 1), a consumable balance (Contract 10: a tier "is not
 *     consumed by use"), or linking issuance to redemption (Contract 7, the
 *     entire point of Layer 1). Each is a worse thing than the thing it fixes,
 *     so the exposure is accepted and written down instead.
 */

/**
 * How many batches may be signed at once.
 *
 * Above one, because honest issuance is bursty and a single slow batch must
 * not make the endpoint look broken. Low, because the work is measured in
 * seconds of CPU and the point is to leave some.
 */
export const ISSUANCE_CONCURRENCY = 2;

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
    // Clamped: an unbalanced release must not hand out a slot that does not
    // exist. The opposite mistake — a slot taken and never returned — turns a
    // ceiling into a permanent outage, which is why `run` exists.
    this.active = Math.max(0, this.active - 1);
  }

  /** Runs work inside a slot, returning it whether or not the work throws. */
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
