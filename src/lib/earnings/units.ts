/**
 * What a unit is, and why payout can never exceed intake.
 *
 * The risk this whole subsystem exists to close: a capability key carries its
 * own authority and is verified by signature, never by a lookup. Share one and
 * every handshake it produces looks legitimate, so a per-handshake payout has
 * no upper bound. **Subscription therefore becomes prepaid credit.** A reader
 * buys units; units are the only thing that can be spent; and a contributor is
 * paid for units that were demonstrably spent.
 *
 * The invariant falls straight out of that and is asserted in
 * `tests/contracts/earnings-invariants.test.ts`:
 *
 *     Σ paid to contributors  ≤  Σ units granted × CONTRIBUTOR_SHARE
 *                             ≤  Σ money received
 *
 * Nothing about honesty, collusion or key sharing can break it, because none
 * of those create units. They only decide who spends the ones already bought.
 */

/** A unit is a kibibyte served. Small enough that a dropped chunk is cheap. */
export const BYTES_PER_UNIT = 1024;

/**
 * What the platform keeps, and what is reserved for whoever served the bytes.
 *
 * The reserved portion is deliberately **not** a balance held here. It is a
 * number of spendable units written into the reader's own grant, and it
 * becomes an obligation only when a dual-signed receipt is presented at
 * settlement. Between settlements the platform holds no pending balances at
 * all — the record is in the keys, on the parties' machines.
 */
export const CONTRIBUTOR_SHARE = 0.7;
export const PLATFORM_SHARE = 1 - CONTRIBUTOR_SHARE;

/**
 * Units granted for an amount paid, in the smallest currency unit.
 *
 * Rounded **down**. A rounding error in the reader's favour would issue units
 * that were never paid for, which is the one direction that breaks the
 * invariant; in the platform's favour it merely shortchanges by less than a
 * unit, which is a kibibyte.
 */
export function unitsForAmount(
  amountMinor: number,
  minorPerUnit: number = MINOR_PER_UNIT,
): number {
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) return 0;
  return Math.floor((amountMinor * CONTRIBUTOR_SHARE) / minorPerUnit);
}

/**
 * What one unit costs the reader, in the smallest currency unit.
 *
 * A tenth of a cent per kibibyte — so a $9 month buys roughly 6,300 units,
 * which is about 6 MB of served prose and datasets. The number is a policy
 * choice and lives here rather than being scattered; what matters structurally
 * is that it is fixed at grant time and written into the grant, so a later
 * change cannot retroactively inflate what an outstanding grant is worth.
 */
export const MINOR_PER_UNIT = 0.1;

/** What a contributor is owed for units they can prove were spent with them. */
export function payoutMinor(units: number): number {
  if (!Number.isFinite(units) || units <= 0) return 0;
  return units * MINOR_PER_UNIT;
}

/** Units a byte count consumes. Partial units round up: bytes are bytes. */
export function unitsForBytes(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.ceil(bytes / BYTES_PER_UNIT);
}
