/**
 * Staying discoverable.
 *
 * The platform's registry is a Map with a fifteen-second lease and no
 * durability at all — it forgets on restart, and forgets a node that goes
 * quiet. That is Contract 2 working as intended, and it only works because
 * the two endpoints take responsibility for the connection between them.
 *
 * The node was not taking its share. `announce()` built the heartbeat
 * interval inside its own success path, so a node whose *first* announce
 * failed never scheduled anything again: it logged one line about not being
 * discoverable and then served, correctly and invisibly, for as long as it
 * ran. Starting the node and the platform together is enough to trigger it,
 * which is what a process manager, a compose file, or a rebooting machine all
 * do.
 *
 * The shape of the bug was the giveaway. A platform restart *after* a good
 * announce was handled — a 410 on the heartbeat re-announces — while the same
 * situation a second earlier was permanent. Retrying belongs outside the
 * attempt, so it lives here, with the timer injected so the policy can be
 * tested without waiting for real seconds to pass.
 */

export interface PresenceLoopOptions {
  /** Announce, returning the lease length in seconds. Throws if it failed. */
  announce: () => Promise<number>;
  /** Refresh the lease. Returns the status, or null if it never arrived. */
  beat: () => Promise<number | null>;
  schedule?: (ms: number, fn: () => void) => ReturnType<typeof setTimeout>;
  cancel?: (handle: ReturnType<typeof setTimeout>) => void;
}

/** First retry delay, and the ceiling it doubles towards. */
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

  /** Announce, and keep announcing until it works. Never throws. */
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
      // A success clears the backoff, so a node that has been unreachable for
      // an hour returns to the normal cadence immediately rather than waiting
      // out the long delay it happened to be on.
      this.backoff = FIRST_BACKOFF_MS;
      // A third of the lease: two beats may be lost before anything lapses.
      this.next(Math.max(2_000, (leaseSeconds * 1000) / 3), () => this.pulse());
    } catch {
      // Deliberately silent after the first report. A node that cannot reach
      // the platform is still serving; saying so once a second helps nobody.
      this.live = false;
      const delay = this.backoff;
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
      this.next(delay, () => this.attempt());
    }
  }

  private async pulse(): Promise<void> {
    if (this.stopped) return;

    const status = await this.options.beat().catch(() => null);
    // 410 means the lease lapsed — usually the platform restarted and has
    // never heard of us. A dropped request means the same thing from here.
    if (status === null || status === 410) {
      this.live = false;
      await this.attempt();
      return;
    }

    this.next(this.beatInterval, () => this.pulse());
  }

  /** Kept from the last successful announce so a pulse can reschedule itself. */
  private beatInterval = 5_000;

  private next(ms: number, fn: () => void): void {
    if (this.stopped) return;
    this.beatInterval = ms;
    if (this.timer) this.options.cancel(this.timer);
    this.timer = this.options.schedule(ms, fn);
  }
}
