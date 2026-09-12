import { NextResponse } from "next/server";

import { envelope, HEADERS } from "@/lib/api/shape";
import { fairShare } from "@/lib/signaling/fair-share";
import { registry } from "@/lib/signaling/registry";

export const dynamic = "force-dynamic";

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
  const results = fairShare(matching, (entry) => entry.sub);

  return NextResponse.json(
    {
      ...envelope(),
      contributors: new Set(results.map((r) => r.sub)).size,
      count: results.length,
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
