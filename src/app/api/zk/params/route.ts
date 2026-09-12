import { NextResponse } from "next/server";

import { PROVIDERS, refreshProviderKeys, windowSize } from "@/lib/zk/jwks";
import {
  ACCEPTED_PROVIDERS,
  CIRCUIT,
  PUBLIC_SIGNAL_LAYOUT,
  SYSTEM,
} from "@/lib/zk/params";

export const dynamic = "force-dynamic";

/**
 * Everything needed to verify a proof, and nothing about who made one.
 *
 * Published so it can be checked rather than trusted. A prover operator fetches
 * this to see which circuit and proof system the platform accepts; anybody at
 * all can fetch it, regenerate the verification key from the pinned circuit and
 * the public powers-of-tau, and confirm the hash. Under a deterministic setup
 * that check is conclusive — see docs/PROVER-PROTOCOL.md.
 *
 * There is deliberately no list of provers here, and there will not be one. A
 * list published by the platform is a default, a default is where everyone
 * goes, and the trust this design moves to a party the user chooses would move
 * straight back to a party we chose.
 */
export async function GET() {
  for (const issuer of ACCEPTED_PROVIDERS) {
    await refreshProviderKeys(issuer);
  }

  return NextResponse.json(
    {
      protocol: "cephroom-zk/1",
      circuit: CIRCUIT,
      system: SYSTEM,
      publicSignalLayout: PUBLIC_SIGNAL_LAYOUT,
      verificationKeyHash: process.env.ZK_VERIFICATION_KEY_SHA256 ?? null,
      providers: ACCEPTED_PROVIDERS.map((issuer) => ({
        issuer,
        jwksUri: PROVIDERS[issuer]?.jwksUri ?? null,
        keysInWindow: windowSize(issuer),
      })),
      // Stated in the machine-readable surface too, not only in the prose, so
      // a client library has no excuse for not showing it.
      notice:
        "A prover sees the token you send it. Choose one you trust, or run your own: docs/PROVER-PROTOCOL.md.",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
