
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
