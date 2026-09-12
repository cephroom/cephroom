import { NextResponse } from "next/server";

import { PROVIDERS, refreshProviderKeys, windowSize } from "@/lib/zk/jwks";
import {
  ACCEPTED_PROVIDERS,
  CIRCUIT,
  PUBLIC_SIGNAL_LAYOUT,
  SYSTEM,
} from "@/lib/zk/params";

export const dynamic = "force-dynamic";

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
      // Everything a prover needs is in this response — the circuit, the
      // signal layout, the accepted provider keys. There is deliberately no
      // list of provers here and never will be: naming one would make it the
      // default, and a default prover is the centralisation this design
      // exists to avoid.
      notice:
        "A prover sees the token you send it. Choose one you trust, or run your own — everything needed to write one is in this response, and the platform runs no prover of its own.",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
