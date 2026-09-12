/**
 * The platform's two writes, and nothing else.
 *
 * The design says the server writes exactly twice per connection: once when it
 * opens and once when it closes. Both are **secondary confirmation, not the
 * record of truth** — the truth is the receipt chain the two parties build
 * between themselves. If this registry vanished mid-session, settlement would
 * be unaffected, because settlement reads receipts.
 *
 * So what is it for? One thing, and it is the case the receipt chain genuinely
 * cannot handle: **concurrent use of a shared grant.**
 *
 * A reader who shares their key shares their allowance. Two sessions running
 * at once can each draw the whole thing, and neither contributor can see the
 * other. The cap at settlement keeps total payout bounded — that invariant
 * never breaks — but it does so by refusing to pay one of them for work they
 * actually did. Refusing the *second concurrent open* instead means the second
 * contributor never does the work, which is a far better failure: nobody is
 * out of pocket and the reader is told immediately why.
 *
 * It holds one entry per open connection, in RAM, dying with the process. No
 * subject, no address, no history — an `aid`, which is a random value naming
 * no person, and an opaque session id. Sequential sharing (passing the key
 * around over time) is not addressed here and does not need to be: it is
 * bounded by the allowance itself.
 */

export interface OpenSession {
  aid: string;
  sid: string;
  /** Units the grant was worth. Carried so a close can report what is left. */
  grantUnits: number;
  openedAtEpoch: number;
}

export type OpenResult =
  | { ok: true; session: OpenSession }
  | { ok: false; reason: "already-open" };

/** Sessions live for one epoch past their open, then lapse like a lease. */
export const SESSION_EPOCH_MS = 10 * 60 * 1000;

export class SessionRegistry {
  /** Keyed by grant, because one grant may have one open session. */
  private readonly byGrant = new Map<string, OpenSession>();

  private epoch(now: number): number {
    return Math.floor(now / SESSION_EPOCH_MS);
  }

  /**
   * The first of the platform's two writes.
   *
   * Refuses a second concurrent session on one grant. Lapsed sessions are
   * filtered on read rather than swept, the same way the presence registry
   * does it: a session stops counting because its epoch passed, not because a
   * cleanup job noticed.
   */
  open(
    aid: string,
    sid: string,
    grantUnits: number,
    now: number = Date.now(),
  ): OpenResult {
    const epoch = this.epoch(now);
    const existing = this.byGrant.get(aid);

    if (existing && existing.openedAtEpoch >= epoch - 1 && existing.sid !== sid) {
      return { ok: false, reason: "already-open" };
    }

    const session: OpenSession = { aid, sid, grantUnits, openedAtEpoch: epoch };
    this.byGrant.set(aid, session);
    return { ok: true, session };
  }

  /**
   * The second write. Idempotent, because a close can arrive twice — a clean
   * shutdown and then a lapse — and neither is more true than the other.
   */
  close(aid: string, sid: string): void {
    const existing = this.byGrant.get(aid);
    if (existing && existing.sid === sid) this.byGrant.delete(aid);
  }

  isOpen(aid: string, now: number = Date.now()): boolean {
    const existing = this.byGrant.get(aid);
    if (!existing) return false;
    return existing.openedAtEpoch >= this.epoch(now) - 1;
  }

  /** Open sessions. For a health check; never per-person. */
  size(): number {
    return this.byGrant.size;
  }

  clear(): void {
    this.byGrant.clear();
  }
}

const globalForSessions = globalThis as unknown as {
  __cephroomSessions?: SessionRegistry;
};

export function sessions(): SessionRegistry {
  globalForSessions.__cephroomSessions ??= new SessionRegistry();
  return globalForSessions.__cephroomSessions;
}

/**
 * The per-grant spent counter.
 *
 * One integer per grant, keyed by a random `aid` that names nobody. It exists
 * because two contributors can each hold genuine receipts against one shared
 * grant, and without it each could be paid the full allowance.
 *
 * This is the same bounded exception as the Layer 1 nullifier set rather than
 * a new kind of state, and it is bounded the same way: a grant has a period,
 * periods close, and a counter for a closed period is dropped whole. It is not
 * a balance — it never goes up as money arrives and it is never owed to
 * anybody. It only ever records how much of an already-purchased allowance has
 * been drawn.
 */
export class SpentCounter {
  /** period → `${aid}:${sid}` → the highest figure ever drawn for it. */
  private readonly byPeriod = new Map<number, Map<string, number>>();

  constructor(private readonly keepPeriods = 2) {}

  /** Everything drawn against a grant: the sum of its sessions' maxima. */
  spent(aid: string, period: number): number {
    const bucket = this.byPeriod.get(period);
    if (!bucket) return 0;

    let total = 0;
    const prefix = `${aid}:`;
    for (const [key, units] of bucket) {
      if (key.startsWith(prefix)) total += units;
    }
    return total;
  }

  /**
   * Records a draw as the **maximum** for its session, never a sum.
   *
   * Keyed by session rather than by grant, and this is load-bearing rather
   * than tidiness. Keys cannot be revoked in this design, so a contributor
   * keeps every serve key they have ever held — including the one from before
   * a settlement, carrying the old watermark. Presenting the same receipts
   * with the old key gets past the watermark check.
   *
   * Found by probing the live endpoint. Summing per grant let that drain a
   * grant by re-settling one session repeatedly; taking the maximum per
   * session makes the second presentation draw nothing, because the session's
   * highest figure has not moved. The headline invariant held either way —
   * payout was always capped at the grant — but "capped at the grant" is a
   * much weaker promise than "paid once for work done once".
   */
  advance(
    draws: { aid: string; sid: string; units: number }[],
    period: number,
  ): void {
    this.prune(period);
    let bucket = this.byPeriod.get(period);
    if (!bucket) {
      bucket = new Map();
      this.byPeriod.set(period, bucket);
    }
    for (const draw of draws) {
      const key = `${draw.aid}:${draw.sid}`;
      bucket.set(key, Math.max(bucket.get(key) ?? 0, draw.units));
    }
  }

  /** What a single session has already drawn. */
  spentForSession(aid: string, sid: string, period: number): number {
    return this.byPeriod.get(period)?.get(`${aid}:${sid}`) ?? 0;
  }

  private prune(current: number): void {
    const oldest = current - this.keepPeriods + 1;
    for (const period of this.byPeriod.keys()) {
      if (period < oldest) this.byPeriod.delete(period);
    }
  }

  size(): number {
    let total = 0;
    for (const bucket of this.byPeriod.values()) total += bucket.size;
    return total;
  }

  clear(): void {
    this.byPeriod.clear();
  }
}

const globalForSpent = globalThis as unknown as {
  __cephroomSpent?: SpentCounter;
};

export function spentCounter(): SpentCounter {
  globalForSpent.__cephroomSpent ??= new SpentCounter();
  return globalForSpent.__cephroomSpent;
}
