import { NextResponse } from "next/server";

import { envelope, HEADERS } from "@/lib/api/shape";
import type { DiscoveryTier } from "@/lib/access";
import { getViewer } from "@/lib/auth/session";
import { verifyAccessKey } from "@/lib/keys/tokens";
import { fairShare } from "@/lib/signaling/fair-share";
import { registry } from "@/lib/signaling/registry";
import { DISCOVERY_CONCURRENCY, DISCOVERY_REACH } from "@/lib/stripe/plans";

export const dynamic = "force-dynamic";

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
      ...(entry.presence.payTo ? { payTo: entry.presence.payTo } : {}),
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
      reach: {
        plan: discovery,
        results: DISCOVERY_REACH[discovery],
        concurrentNodes: DISCOVERY_CONCURRENCY[discovery],
      },
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
