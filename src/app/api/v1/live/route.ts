import { NextResponse } from "next/server";

import { envelope, HEADERS } from "@/lib/api/shape";
import type { DiscoveryTier } from "@/lib/access";
import { getViewer } from "@/lib/auth/session";
import { verifyAccessKey } from "@/lib/keys/tokens";
import { fairShare } from "@/lib/signaling/fair-share";
import { registry } from "@/lib/signaling/registry";
import { DISCOVERY_CONCURRENCY, DISCOVERY_REACH } from "@/lib/stripe/plans";

export const dynamic = "force-dynamic";

/**
 * The discovery plan behind this request.
 *
 * From the session cookie, or from an anonymous token presented as a bearer —
 * the token path is the point of Layer 1 now that reading is ungated: a
 * subscriber's *queries* are the one activity the platform can still see, and
 * a token lets them spend their reach without the search being attached to
 * their subscription.
 *
 * No key is not an error. Browsing is free and needs none.
 */
async function reachFor(request: Request): Promise<DiscoveryTier> {
  const header = request.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    const key = await verifyAccessKey(header.slice(7).trim());
    if (key?.discovery) return key.discovery;
  }
  return (await getViewer()).discovery;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const tags = url.searchParams.getAll("tag").map((tag) => tag.toLowerCase());
  const kind = url.searchParams.get("kind");

  const located = q ? registry().search(q) : allLive();

  const matching = located
    .filter((entry) => !kind || entry.item.kind === kind)
    .filter(
      (entry) =>
        tags.length === 0 ||
        tags.every((tag) =>
          entry.item.tags.map((t) => t.toLowerCase()).includes(tag),
        ),
    )
    .map((entry) => ({
      sub: entry.presence.sub,
      servedBy: entry.presence.displayName,
      // Announced by the contributor, passed on unread. Absent when they set
      // none: "nothing" is a legitimate answer to how to pay somebody, and an
      // empty string invites a client to render an empty payment box.
      ...(entry.presence.payTo ? { payTo: entry.presence.payTo } : {}),
      // The address is the point of this endpoint: a client fetches the bytes
      // from here, directly, and the platform is not in that request.
      address: entry.presence.address,
      id: entry.item.id,
      title: entry.item.title,
      kind: entry.item.kind,
      tags: entry.item.tags,
      summary: entry.item.summary ?? null,
      openProposals: entry.item.openProposals ?? 0,
      fetch: {
        column: `${entry.presence.address}/column/${encodeURIComponent(entry.item.id)}`,
        dataset: `${entry.presence.address}/dataset/${encodeURIComponent(entry.item.id)}`,
      },
    }));

  // An equal share of the page each, so one contributor announcing five
  // hundred items cannot bury the rest. Measured before this existed: one
  // hostile contributor held 97% of the listing and a search for a real tag
  // came back 506 results, 500 of them hers.
  //
  // How much of the page the caller gets is their discovery plan. It is the
  // same query over the same presence either way — a plan buys more of the
  // answer, never a different one, and never anything from inside a column.
  const discovery = await reachFor(request);
  const results = fairShare(
    matching,
    (entry) => entry.sub,
    DISCOVERY_REACH[discovery],
  );

  return NextResponse.json(
    {
      ...envelope(),
      contributors: new Set(results.map((r) => r.sub)).size,
      count: results.length,
      // What this plan is cleared for, so a crawler knows how hard to go
      // without guessing. The client does the crawling; we hand out the map.
      reach: {
        plan: discovery,
        results: DISCOVERY_REACH[discovery],
        concurrentNodes: DISCOVERY_CONCURRENCY[discovery],
      },
      // Stated, so a client can tell a short listing from a quiet network.
      ...(results.length < matching.length
        ? { truncated: true, matching: matching.length }
        : {}),
      results,
      note: "Presence only. Nothing that is not being served right now appears here, and nothing that ever was is recorded.",
    },
    { headers: HEADERS },
  );
}

function allLive() {
  return registry()
    .list()
    .flatMap((presence) => presence.items.map((item) => ({ presence, item })));
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: HEADERS });
}
