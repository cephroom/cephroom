
export interface PresenceLoopOptions {
  announce: () => Promise<number>;
  beat: () => Promise<number | null>;
  schedule?: (ms: number, fn: () => void) => ReturnType<typeof setTimeout>;
  cancel?: (handle: ReturnType<typeof setTimeout>) => void;
}

export const FIRST_BACKOFF_MS = 1_000;
export const MAX_BACKOFF_MS = 30_000;

export class PresenceLoop {
  private readonly options: Required<PresenceLoopOptions>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private backoff = FIRST_BACKOFF_MS;
  private live = false;
  private stopped = false;

  readonly maxBackoffMs = MAX_BACKOFF_MS;

  constructor(options: PresenceLoopOptions) {
    this.options = {
      schedule: (ms, fn) => setTimeout(fn, ms),
      cancel: (handle) => clearTimeout(handle),
      ...options,
    };
  }

  connected(): boolean {
    return this.live;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.attempt();
  }

  stop(): void {
    this.stopped = true;
    this.live = false;
    if (this.timer) this.options.cancel(this.timer);
    this.timer = null;
  }

  private async attempt(): Promise<void> {
    if (this.stopped) return;

    try {
      const leaseSeconds = await this.options.announce();
      this.live = true;
      this.backoff = FIRST_BACKOFF_MS;
      this.next(Math.max(2_000, (leaseSeconds * 1000) / 3), () => this.pulse());
    } catch {
      this.live = false;
      const delay = this.backoff;
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
      this.next(delay, () => this.attempt());
    }
  }

  private async pulse(): Promise<void> {
    if (this.stopped) return;

    const status = await this.options.beat().catch(() => null);
    if (status === null || status === 410) {
      this.live = false;
      await this.attempt();
      return;
    }

    this.next(this.beatInterval, () => this.pulse());
  }

  private beatInterval = 5_000;

  private next(ms: number, fn: () => void): void {
    if (this.stopped) return;
    this.beatInterval = ms;
    if (this.timer) this.options.cancel(this.timer);
    this.timer = this.options.schedule(ms, fn);
  }
}
