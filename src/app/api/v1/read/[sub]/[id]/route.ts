import { NextResponse } from "next/server";

import { envelope, HEADERS } from "@/lib/api/shape";
import { registry } from "@/lib/signaling/registry";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ sub: string; id: string }> },
) {
  const { sub, id } = await context.params;
  const located = registry().find(decodeURIComponent(sub), decodeURIComponent(id));

  if (!located) {
    // Deliberately uninformative, and for the same reason the offline page is:
    // the platform cannot say what used to be here, because it never knew.
    return NextResponse.json(
      {
        ...envelope(),
        error: "not-served",
        detail:
          "Nobody is serving this right now. Nothing about it is stored here, so there is no title, author or last-seen time to give you.",
      },
      { status: 404, headers: HEADERS },
    );
  }

  const { presence, item } = located;
  const base = presence.address;

  return NextResponse.json(
    {
      ...envelope(),
      sub: presence.sub,
      servedBy: presence.displayName,
      address: base,
      item: {
        id: item.id,
        title: item.title,
        kind: item.kind,
        tags: item.tags,
        access: item.access ?? "public",
        summary: item.summary ?? null,
        openProposals: item.openProposals ?? 0,
      },
      fetch: {
        // Present your read key as `authorization: Bearer <key>`. Without one
        // you get the public preview; the node decides, not us.
        self: `${base}/${item.kind}/${encodeURIComponent(item.id)}`,
        manifest: `${base}/manifest`,
        proposals: `${base}/proposals?column=${encodeURIComponent(item.id)}`,
      },
      rules: {
        contentComesFromTheNode:
          "The platform never returns column or dataset bytes. Fetch `fetch.self` directly from the address above.",
        datasetsComeFromTheSameNode:
          "Resolve every claim's dataset from this node, not from whichever node announces that slug. An author vouches for the data they serve; letting a stranger's node answer would let anyone substitute the numbers a claim is checked against.",
        accessIsDecidedByTheNode:
          "Send your read key to the node. The platform cannot enforce access and does not try — it is not in the request path.",
      },
    },
    { headers: HEADERS },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: HEADERS });
}
