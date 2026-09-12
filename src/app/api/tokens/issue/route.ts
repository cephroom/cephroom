import { NextResponse } from "next/server";

import { getViewer } from "@/lib/auth/session";
import { entitlementFor } from "@/lib/stripe/entitlement";
import { BATCH_SIZE, issueBatch, tokenTierFor } from "@/lib/tokens/issuer";

export const dynamic = "force-dynamic";

/**
 * Blind-signs a batch of access tokens for a subscriber.
 *
 * This is the **only** point in Layer 1 where the platform knows who it is
 * dealing with, and it is the half of the transaction that has to: somebody is
 * asking for tokens and the platform must not hand them to a non-subscriber.
 * So the caller's key is read, their entitlement is checked against Stripe
 * live, exactly as it is everywhere else, and then the platform signs.
 *
 * What it signs, it cannot see. Every element of `requests` is a blinded
 * message: the client multiplied its token by a random factor that never
 * leaves the browser. The signature that comes back is unblinded there, and
 * the result is a value this server has never held and cannot recognise. That
 * is RFC 9474, and it is why this endpoint can be authenticated while the
 * redemption endpoint is not.
 *
 * Note what is deliberately absent: no record that this subject received
 * tokens, no count, no timestamp. There is nothing to write down, because the
 * only defence against over-issuance that would be worth having is a per-
 * subject ledger, and that is the thing being removed. The bound is instead
 * the batch size and the tokens' one-hour lifetime — a subscriber who asks
 * repeatedly gets tokens they are entitled to anyway.
 */
export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer.sub) {
    return NextResponse.json(
      { error: "Sign in first." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  // Live from Stripe, not from the key, so a cancellation within the key's
  // fifteen minutes cannot buy an hour of anonymous tokens on top.
  const entitlement = await entitlementFor(viewer.sub);
  const tier = tokenTierFor(entitlement.tier);
  if (!tier) {
    return NextResponse.json(
      { error: "Anonymous reading tokens come with a membership." },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    requests?: unknown;
  } | null;

  if (!Array.isArray(body?.requests) || body.requests.length === 0) {
    return NextResponse.json(
      { error: "Send an array of blinded token requests." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  if (body.requests.length > BATCH_SIZE) {
    return NextResponse.json(
      { error: `At most ${BATCH_SIZE} tokens per request.` },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  let blinded: Uint8Array[];
  try {
    blinded = body.requests.map((entry) => {
      if (typeof entry !== "string") throw new Error("not a string");
      const bytes = Uint8Array.from(Buffer.from(entry, "base64"));
      // A blind RSA token request is 2 + 1 + 256 bytes. Bounding it here
      // keeps a malformed or hostile body from reaching the crypto.
      if (bytes.length !== 259) throw new Error("wrong length");
      return bytes;
    });
  } catch {
    return NextResponse.json(
      { error: "A token request was malformed." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const { epoch, responses } = await issueBatch(tier, blinded);
    return NextResponse.json(
      { epoch, tier, responses },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Could not sign this batch." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
