import { SignJWT, jwtVerify } from "jose";

import { ISSUER, verificationKey } from "@/lib/keys/tokens";
import { unitsForAmount } from "./units";

/**
 * The allowance grant: prepaid credit, carried by the reader.
 *
 * This is the shape the money flow takes. A subscription payment splits on
 * arrival — the platform's share stays at Stripe as revenue, and the
 * contributors' share becomes **units written into a grant the reader holds**.
 * It is not a balance sitting here waiting to be assigned; there is nothing on
 * the platform to assign. An obligation to pay anybody comes into existence
 * only when a dual-signed receipt is presented at settlement, and it is capped
 * by the grant that receipt draws on.
 *
 * The grant binds a **public key**, not a subject. Spending requires the
 * matching private key, which the reader generates and never sends. That is
 * what makes a receipt's consumer signature mean anything — and it means
 * sharing a grant requires sharing a private key, which is at least an
 * explicit act rather than an accident.
 *
 * It has its own audience and its own lifetime, deliberately not the access
 * key's. An access key lives fifteen minutes; an allowance has to survive a
 * billing period, and folding the two together would reset the allowance on
 * every renewal or stretch the session key to a month.
 */

export const GRANT_AUDIENCE = "cephroom:allowance";

export interface AllowanceGrant {
  /** Random id. Names no person; the settlement counter is keyed by it. */
  aid: string;
  /** Units prepaid. */
  units: number;
  /** Billing period. Settlement pays for periods after a contributor's mark. */
  period: number;
  /** SPKI of the key that may spend this. The reader holds the private half. */
  cpk: string;
  exp: number;
}

/** Periods are months since epoch: coarse, monotonic, and needs no clock sync. */
export function currentPeriod(now: number = Date.now()): number {
  const date = new Date(now);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

/**
 * Mints a grant for a payment that has already arrived.
 *
 * Called after Stripe confirms, never before — the units exist because the
 * money did. `unitsForAmount` rounds down, so a grant can never be worth more
 * than the contributor share of what was actually received.
 */
export async function mintGrant(input: {
  amountMinor: number;
  consumerPublicKey: string;
  now?: number;
  signingKey: CryptoKey;
}): Promise<{ token: string; grant: AllowanceGrant }> {
  const now = input.now ?? Date.now();
  const period = currentPeriod(now);
  const units = unitsForAmount(input.amountMinor);
  const aid = crypto.randomUUID().replace(/-/g, "");

  // One period plus a tail, so a grant issued on the last day of a month is
  // still spendable while that period settles.
  const expiresAt = Math.floor(now / 1000) + 45 * 24 * 60 * 60;

  const token = await new SignJWT({
    aid,
    units,
    period,
    cpk: input.consumerPublicKey,
  })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(GRANT_AUDIENCE)
    // No subject. A grant is a bearer allowance bound to a key, and putting
    // the reader's subject in it would let a contributor holding a receipt
    // learn who paid — which is exactly what Layer 1 removed.
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(input.signingKey);

  return { token, grant: { aid, units, period, cpk: input.consumerPublicKey, exp: expiresAt } };
}

/** Verifies a grant. Public key only, so a node can check one on its own. */
export async function verifyGrant(
  token: string,
): Promise<AllowanceGrant | null> {
  try {
    const { payload } = await jwtVerify(token, await verificationKey(), {
      issuer: ISSUER,
      audience: GRANT_AUDIENCE,
    });

    const { aid, units, period, cpk } = payload as Record<string, unknown>;
    if (
      typeof aid !== "string" ||
      typeof units !== "number" ||
      typeof period !== "number" ||
      typeof cpk !== "string"
    ) {
      return null;
    }
    return { aid, units, period, cpk, exp: payload.exp! };
  } catch {
    return null;
  }
}
