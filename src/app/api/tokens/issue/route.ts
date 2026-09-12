import { NextResponse } from "next/server";

import { getViewer } from "@/lib/auth/session";
import { entitlementFor } from "@/lib/stripe/entitlement";
import { issuanceGate } from "@/lib/tokens/issuance-gate";
import { BATCH_SIZE, issueBatch, tokenTierFor } from "@/lib/tokens/issuer";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!issuanceGate().tryEnter()) {
    return NextResponse.json(
      { error: "Busy signing. Try again in a moment." },
      {
        status: 503,
        headers: { "cache-control": "no-store", "retry-after": "2" },
      },
    );
  }

  return issuanceGate().run(() => issue(request));
}

async function issue(request: Request) {
  const viewer = await getViewer();
  if (!viewer.sub) {
    return NextResponse.json(
      { error: "Sign in first." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const entitlement = await entitlementFor(viewer.sub);
  const tier = tokenTierFor(entitlement.discovery);
  if (!tier) {
    return NextResponse.json(
      {
        error:
          "Anonymous discovery tokens come with a paid discovery plan. Browsing is free and needs none.",
      },
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
