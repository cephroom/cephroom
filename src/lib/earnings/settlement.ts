import { payoutMinor } from "./units";

/**
 * Settlement: write the contributor's key first, then pay.
 *
 * ## Why the order is not negotiable
 *
 * If payment fired first and the write then failed, money would be out with no
 * record that it had been — and the next settlement would pay for the same
 * receipts again. That is precisely the mechanism by which total paid exceeds
 * total received, which is the risk this whole subsystem exists to close.
 *
 * Write-then-pay fails closed. A failure between the two means the contributor
 * has been marked as settled and not paid: they are short, they can see it,
 * and it is recoverable by a human. The other order is not recoverable,
 * because nothing anywhere records that the money went out.
 *
 * `settle()` therefore takes the two effects as separate injected functions
 * and calls them in that order, and
 * `tests/contracts/earnings-invariants.test.ts` fails if the sequence is ever
 * inverted. The test watches the order of calls rather than the result,
 * because a refactor that reordered them would still produce correct-looking
 * output on the happy path.
 *
 * ## Where the paid-through record lives
 *
 * Not here. The contributor's key carries `settledThroughPeriod`, and only
 * receipts from later periods are payable. So the platform holds no pending
 * balance between settlements: the watermark is one integer in a key on the
 * contributor's own machine, and re-presenting old receipts against a newer
 * key proves nothing.
 *
 * ## The one number that must be remembered
 *
 * Two contributors can each hold receipts against the same grant, and each
 * could legitimately claim up to its full allowance if nothing remembered what
 * had already been drawn. So a **spent counter per grant** exists: one integer,
 * keyed by a random `aid` that names no person, discarded when the grant
 * expires. It is the nullifier pattern again rather than a new kind of state,
 * and it is what makes the cap enforceable. See docs/EARNINGS.md.
 */

export interface GrantFacts {
  aid: string;
  /** Units the reader prepaid. The hard ceiling on everything below. */
  units: number;
  period: number;
}

export interface Claim {
  contributorSub: string;
  aid: string;
  sid: string;
  period: number;
  /** Highest cumulative figure a verified chain proved for this session. */
  units: number;
}

export interface SettlementInput {
  contributorSub: string;
  /** From the contributor's current key. Receipts at or before this are spent. */
  settledThroughPeriod: number;
  currentPeriod: number;
  claims: Claim[];
  grants: Map<string, GrantFacts>;
  /** Units already drawn against each grant, from the bounded spent counter. */
  alreadySpent: (aid: string) => number;
  /** Units already drawn for one particular session of that grant. */
  alreadySpentForSession?: (aid: string, sid: string) => number;
}

export interface SettlementPlan {
  contributorSub: string;
  /** Payable units after every cap and rejection. */
  units: number;
  amountMinor: number;
  newSettledThroughPeriod: number;
  /**
   * Per-session draw, so the spent counter can record a maximum rather than a
   * sum. Keyed by session because settlements can repeat: keys are not
   * revocable, so a contributor may present the same session again with an
   * older key, and a maximum makes that draw nothing.
   */
  draws: { aid: string; sid: string; units: number }[];
  rejected: { sid: string; reason: string }[];
}

/**
 * Works out what is payable, before anything is written or paid.
 *
 * Pure, and deliberately separate from the effects. Deciding *what* to pay and
 * *doing* it are different concerns, and keeping them apart is what lets the
 * ordering test watch the effects without having to simulate a settlement.
 */
export function planSettlement(input: SettlementInput): SettlementPlan {
  const rejected: { sid: string; reason: string }[] = [];
  const bySession = new Map<string, Claim>();

  for (const claim of input.claims) {
    if (claim.contributorSub !== input.contributorSub) {
      rejected.push({ sid: claim.sid, reason: "not-this-contributor" });
      continue;
    }
    if (claim.period <= input.settledThroughPeriod) {
      // Already settled. Re-presenting receipts from a paid period is the
      // simplest double-spend there is, and the watermark is what stops it.
      rejected.push({ sid: claim.sid, reason: "period-already-settled" });
      continue;
    }
    if (claim.period > input.currentPeriod) {
      rejected.push({ sid: claim.sid, reason: "period-not-yet-closed" });
      continue;
    }
    const grant = input.grants.get(claim.aid);
    if (!grant) {
      rejected.push({ sid: claim.sid, reason: "unknown-grant" });
      continue;
    }
    if (grant.period !== claim.period) {
      rejected.push({ sid: claim.sid, reason: "grant-period-mismatch" });
      continue;
    }

    // Replaying the same session twice adds nothing: the maximum wins rather
    // than the sum.
    const existing = bySession.get(claim.sid);
    if (!existing || claim.units > existing.units) bySession.set(claim.sid, claim);
  }

  // Draw against each grant, capped at what it was worth minus what has
  // already been drawn from it by anybody. This is where a shared key stops
  // being able to pay out more than it bought.
  const draws: { aid: string; sid: string; units: number }[] = [];
  const drawnThisPlan = new Map<string, number>();
  let units = 0;

  for (const claim of [...bySession.values()].sort((a, b) => a.sid.localeCompare(b.sid))) {
    const grant = input.grants.get(claim.aid)!;

    // Already paid for *this session*. A repeat presentation adds nothing,
    // because the counter holds the maximum rather than a running sum.
    const sessionAlready =
      input.alreadySpentForSession?.(claim.aid, claim.sid) ?? 0;
    if (claim.units <= sessionAlready) {
      rejected.push({ sid: claim.sid, reason: "session-already-paid" });
      // The draw is still recorded so the counter stays at the maximum even if
      // a later claim for the same session is lower.
      draws.push({ aid: claim.aid, sid: claim.sid, units: sessionAlready });
      continue;
    }

    const drawnAlready =
      input.alreadySpent(claim.aid) + (drawnThisPlan.get(claim.aid) ?? 0);
    const room = Math.max(0, grant.units - drawnAlready);

    if (room === 0) {
      rejected.push({ sid: claim.sid, reason: "allowance-exhausted" });
      continue;
    }

    // Only the increment over what this session already drew is payable.
    const increment = Math.min(claim.units - sessionAlready, room);
    if (increment < claim.units - sessionAlready) {
      rejected.push({ sid: claim.sid, reason: "allowance-partially-exhausted" });
    }

    draws.push({
      aid: claim.aid,
      sid: claim.sid,
      units: sessionAlready + increment,
    });
    drawnThisPlan.set(
      claim.aid,
      (drawnThisPlan.get(claim.aid) ?? 0) + increment,
    );
    units += increment;
  }

  return {
    contributorSub: input.contributorSub,
    units,
    amountMinor: payoutMinor(units),
    newSettledThroughPeriod: input.currentPeriod,
    draws,
    rejected,
  };
}

export type SettlementStep = "advance-spent" | "write-key" | "pay";

export interface SettlementEffects {
  /** Advances the per-grant spent counters. Must precede everything. */
  advanceSpent: (
    draws: { aid: string; sid: string; units: number }[],
  ) => Promise<void>;
  /** Writes the contributor's new key, carrying the advanced watermark. */
  writeKey: (plan: SettlementPlan) => Promise<string>;
  /** Moves the money. Last, always. */
  pay: (plan: SettlementPlan) => Promise<void>;
}

export interface SettlementOutcome {
  plan: SettlementPlan;
  /** The steps that actually ran, in order. Returned so a caller can assert it. */
  steps: SettlementStep[];
  key: string | null;
  paid: boolean;
  error: string | null;
}

/**
 * Runs a settlement, in the one order that fails closed.
 *
 *   advance the spent counters → write the contributor's key → pay
 *
 * Each step only runs if the one before it succeeded. A failure anywhere
 * leaves the contributor owed money with a record of why, which a person can
 * fix. The inverse order leaves money gone with no record, which nobody can.
 *
 * Nothing is paid when there is nothing payable — a zero-unit settlement still
 * advances the watermark, so a contributor who served nothing does not
 * accumulate an ever-growing window of re-presentable periods.
 */
export async function settle(
  plan: SettlementPlan,
  effects: SettlementEffects,
): Promise<SettlementOutcome> {
  const steps: SettlementStep[] = [];

  try {
    await effects.advanceSpent(plan.draws);
    steps.push("advance-spent");
  } catch (error) {
    return { plan, steps, key: null, paid: false, error: describe(error) };
  }

  let key: string;
  try {
    key = await effects.writeKey(plan);
    steps.push("write-key");
  } catch (error) {
    // The counters moved and the key did not. The contributor can re-present;
    // the cap already drawn means they cannot be paid twice for it, so this
    // fails in the direction of paying less rather than more.
    return { plan, steps, key: null, paid: false, error: describe(error) };
  }

  if (plan.amountMinor <= 0) {
    return { plan, steps, key, paid: false, error: null };
  }

  try {
    await effects.pay(plan);
    steps.push("pay");
  } catch (error) {
    return { plan, steps, key, paid: false, error: describe(error) };
  }

  return { plan, steps, key, paid: true, error: null };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
