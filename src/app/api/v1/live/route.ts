import { NextResponse } from "next/server";

import { envelope, HEADERS } from "@/lib/api/shape";
import { registry } from "@/lib/signaling/registry";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const tags = url.searchParams.getAll("tag").map((tag) => tag.toLowerCase());
  const kind = url.searchParams.get("kind");

  const located = q ? registry().search(q) : allLive();

  const results = located
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
      // The address is the point of this endpoint: a client fetches the bytes
      // from here, directly, and the platform is not in that request.
      address: entry.presence.address,
      id: entry.item.id,
      title: entry.item.title,
      kind: entry.item.kind,
      tags: entry.item.tags,
      access: entry.item.access ?? "public",
      summary: entry.item.summary ?? null,
      openProposals: entry.item.openProposals ?? 0,
      fetch: {
        column: `${entry.presence.address}/column/${encodeURIComponent(entry.item.id)}`,
        dataset: `${entry.presence.address}/dataset/${encodeURIComponent(entry.item.id)}`,
      },
    }));

  return NextResponse.json(
    {
      ...envelope(),
      contributors: new Set(results.map((r) => r.sub)).size,
      count: results.length,
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
