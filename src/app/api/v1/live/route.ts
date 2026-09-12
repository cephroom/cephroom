import { NextResponse } from "next/server";

import { envelope, HEADERS } from "@/lib/api/shape";
import { registry } from "@/lib/signaling/registry";

export const dynamic = "force-dynamic";

/**
 * What is being served right now.
 *
 * The machine-readable form of `/read`, and the endpoint that was missing when
 * I last walked the consumer role: finding a column's address meant scraping
 * anchor tags out of rendered HTML.
 *
 * **Presence only.** This is a scan over live announcements, which is all the
 * platform has. A column nobody is serving is not here, not because it was
 * filtered out but because nothing anywhere knows it existed. There is no
 * `?since=`, no `?all=`, and no pagination cursor into history, because there
 * is no history to page into.
 *
 * Anonymous, because what is live is public — the same thing `/read` shows a
 * signed-out visitor. Access is decided by the node when you fetch, not here.
 *
 * Query parameters:
 *   `q`    free-text over titles, summaries and tags
 *   `tag`  exact tag match, repeatable
 *   `kind` "column" | "dataset"
 */
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
