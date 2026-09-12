import { NextResponse } from "next/server";

import { envelope, HEADERS } from "@/lib/api/shape";
import { verifyGrant, currentPeriod } from "@/lib/earnings/grant";
import { verifyChain, type Receipt } from "@/lib/earnings/receipt";
import { planSettlement, settle, type Claim, type GrantFacts } from "@/lib/earnings/settlement";
import { spentCounter } from "@/lib/earnings/sessions";
import { verifyServeKey } from "@/lib/keys/tokens";

export const dynamic = "force-dynamic";

/**
 * Settlement: a contributor presents receipts and is paid for what they prove.
 *
 * The ordering is the whole point and it is enforced by `settle()`, which runs
 * its three effects in one sequence and stops at the first failure:
 *
 *     advance the spent counters → write the contributor's key → pay
 *
 * Never payment first. If payment fired before the write and the write then
 * failed, money would be out with no record of it, and the next settlement
 * would pay for the same receipts again — which is exactly how total paid comes
 * to exceed total received. This way a failure means nothing was paid.
 * `tests/contracts/earnings-invariants.test.ts` watches the order of the calls,
 * not the result, so an inversion goes red even on the happy path.
 *
 * The platform holds no pending balance between settlements. What is payable is
 * computed from receipts the contributor brought and the watermark in their own
 * key; there is no parameter anywhere for "what we owe this contributor",
 * because nothing accrues one.
 */
export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) {
    return NextResponse.json(
      { ...envelope(), error: "A serve key identifies who is settling." },
      { status: 401, headers: HEADERS },
    );
  }

  const serve = await verifyServeKey(header.slice(7).trim());
  if (!serve?.sub) {
    return NextResponse.json(
      { ...envelope(), error: "That key does not verify." },
      { status: 401, headers: HEADERS },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    sessions?: unknown;
  } | null;

  /**
   * The watermark comes from the **key**, never from the request.
   *
   * Found by probing this endpoint: it originally read `settledThroughPeriod`
   * out of the body, so a contributor could present the same receipts twice by
   * sending the old watermark back — which is the double-payment this whole
   * design exists to make impossible. The record lives in the contributor's
   * key precisely so that it is not the contributor's word.
   *
   * A key with no watermark has never settled, so everything is payable.
   */
  const settledThroughPeriod = serve.settledThroughPeriod ?? -1;

  const offered = Array.isArray(body?.sessions) ? body.sessions : [];
  const claims: Claim[] = [];
  const grants = new Map<string, GrantFacts>();
  const refused: { sid: string; reason: string }[] = [];

  for (const entry of offered.slice(0, 500)) {
    const { grant: grantToken, receipts } = (entry ?? {}) as {
      grant?: unknown;
      receipts?: unknown;
    };
    if (typeof grantToken !== "string" || !Array.isArray(receipts)) continue;

    const grant = await verifyGrant(grantToken);
    if (!grant) {
      refused.push({ sid: "?", reason: "grant-does-not-verify" });
      continue;
    }

    const chain = receipts as Receipt[];
    const sid = chain[0]?.sid ?? "?";

    // The chain is checked against the grant's own public key, so a
    // contributor cannot present receipts signed by a key of their choosing.
    const checked = await verifyChain(
      chain,
      { aid: grant.aid, sid, consumerKey: grant.cpk },
      verifySignature,
    );
    if (!checked.ok) {
      refused.push({ sid, reason: checked.problems[0]?.reason ?? "bad-chain" });
      continue;
    }
    if (checked.units === 0) continue;

    // The receipts must name the contributor who is settling. Otherwise a
    // contributor could present somebody else's proven work as their own.
    if (chain[0]?.contributorSub !== serve.sub) {
      refused.push({ sid, reason: "not-this-contributor" });
      continue;
    }

    grants.set(grant.aid, { aid: grant.aid, units: grant.units, period: grant.period });
    claims.push({
      contributorSub: serve.sub,
      aid: grant.aid,
      sid,
      period: grant.period,
      units: checked.units,
    });
  }

  const period = currentPeriod();
  const counter = spentCounter();

  const plan = planSettlement({
    contributorSub: serve.sub,
    settledThroughPeriod,
    currentPeriod: period,
    claims,
    grants,
    alreadySpent: (aid) => counter.spent(aid, grants.get(aid)?.period ?? period),
    alreadySpentForSession: (aid, sid) =>
      counter.spentForSession(aid, sid, grants.get(aid)?.period ?? period),
  });

  const outcome = await settle(plan, {
    advanceSpent: async (draws) => {
      for (const draw of draws) {
        counter.advance([draw], grants.get(draw.aid)?.period ?? period);
      }
    },
    writeKey: async () => {
      // The watermark goes into the contributor's own key. That is where the
      // paid-through record lives — not here.
      const { mintServeKey } = await import("@/lib/keys/tokens");
      return mintServeKey({
        sub: serve.sub,
        tier: "reader",
        settledThroughPeriod: plan.newSettledThroughPeriod,
      });
    },
    pay: async () => {
      // Deliberately not implemented against a real payout rail in this
      // build. See docs/EARNINGS.md: wiring a transfer needs Stripe Connect
      // onboarding for every contributor, which is a product decision rather
      // than a defect, and shipping a stub that *looked* like it paid would be
      // far worse than one that says it does not.
      throw new Error(
        "No payout rail is configured. The key has been written, so this settlement is recorded and payable once one is.",
      );
    },
  });

  return NextResponse.json(
    {
      ...envelope(),
      units: plan.units,
      amountMinor: plan.amountMinor,
      settledThroughPeriod: plan.newSettledThroughPeriod,
      steps: outcome.steps,
      key: outcome.key,
      paid: outcome.paid,
      error: outcome.error,
      rejected: [...plan.rejected, ...refused],
    },
    { headers: HEADERS },
  );
}

async function verifySignature(
  spki: string,
  signature: string,
  message: string,
): Promise<boolean> {
  try {
    const { importSPKI } = await import("jose");
    const key = (await importSPKI(spki, "Ed25519")) as CryptoKey;
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      Uint8Array.from(Buffer.from(signature, "base64url")),
      new TextEncoder().encode(message),
    );
  } catch {
    return false;
  }
}
