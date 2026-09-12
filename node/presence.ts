
/**
 * A refusal the platform gave a reason for, as distinct from not reaching it.
 *
 * These need opposite responses and used to get the same one. "Your key may
 * announce 25 items and you sent 40" is fixable by the contributor and will
 * never be fixed by waiting; "connection refused" is the reverse. Collapsing
 * both into "could not reach the platform, still trying" told a contributor
 * with a real, stated problem to sit and wait for it to clear.
 *
 * permanent means "retrying this exact announcement cannot succeed". A rate
 * limit and a server error are not that, even though they arrive as failures,
 * so they stay transient.
 */
export class AnnounceRefused extends Error {
  readonly status: number;
  readonly detail: string;
  readonly permanent: boolean;

  constructor(status: number, detail: string) {
    super(`announce refused (${status}): ${detail}`);
    this.name = "AnnounceRefused";
    this.status = status;
    this.detail = detail;
    this.permanent = status >= 400 && status < 500 && status !== 429 && status !== 408;
  }
}

export interface PresenceFailure {
  detail: string;
  permanent: boolean;
}

export interface PresenceLoopOptions {
  announce: () => Promise<number>;
  beat: () => Promise<number | null>;
  schedule?: (ms: number, fn: () => void) => ReturnType<typeof setTimeout>;
  cancel?: (handle: ReturnType<typeof setTimeout>) => void;
  onFailure?: (detail: string, permanent: boolean) => void;
}

/**
 * A node that cannot reach the platform keeps serving and keeps trying.
 *
 * Contract 4 means a contributor's work is theirs to serve whether or not
 * discovery is up: the platform brokers the connection and holds no copy, so an
 * outage there must not stop the node answering readers who already know its
 * address. It backs off rather than hammering, and resets on success.
 *
 * The heartbeat runs at a third of the lease so two beats can be lost before
 * presence lapses. A 410 means the platform has forgotten this connection -
 * usually because it restarted - and the answer is to announce again rather
 * than to keep beating against a lease that no longer exists.
 */
export const FIRST_BACKOFF_MS = 1_000;
export const MAX_BACKOFF_MS = 30_000;

export class PresenceLoop {
  private readonly options: Required<PresenceLoopOptions>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private backoff = FIRST_BACKOFF_MS;
  private live = false;
  private stopped = false;
  private failure: PresenceFailure | null = null;

  readonly maxBackoffMs = MAX_BACKOFF_MS;

  constructor(options: PresenceLoopOptions) {
    this.options = {
      schedule: (ms, fn) => setTimeout(fn, ms),
      cancel: (handle) => clearTimeout(handle),
      onFailure: () => {},
      ...options,
    };
  }

  connected(): boolean {
    return this.live;
  }

  /**
   * The last reason announcing failed, or null once it has succeeded.
   *
   * Held so the node can say something true at startup instead of assuming the
   * platform is down, and cleared on success so a transient failure does not
   * leave a stale complaint behind.
   */
  lastFailure(): PresenceFailure | null {
    return this.failure;
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
      this.failure = null;
      this.backoff = FIRST_BACKOFF_MS;
      this.next(Math.max(2_000, (leaseSeconds * 1000) / 3), () => this.pulse());
    } catch (caught) {
      this.live = false;
      this.report(caught);

      // Retrying continues even when the refusal is permanent, so a contributor
      // who raises their plan comes back online without restarting the node.
      // What changes is that they are told the real reason rather than being
      // left to wait out a problem that will not clear on its own.
      const delay = this.backoff;
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
      this.next(delay, () => this.attempt());
    }
  }

  /**
   * Reports each distinct reason once.
   *
   * A node that reprints the same refusal every thirty seconds trains its
   * operator to stop reading the log, which costs more than the message buys.
   */
  private report(caught: unknown): void {
    const refused = caught instanceof AnnounceRefused;
    const detail = refused
      ? (caught as AnnounceRefused).detail
      : caught instanceof Error
        ? caught.message
        : String(caught);
    const permanent = refused ? (caught as AnnounceRefused).permanent : false;

    if (this.failure?.detail === detail && this.failure.permanent === permanent) {
      return;
    }
    this.failure = { detail, permanent };
    this.options.onFailure(detail, permanent);
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
