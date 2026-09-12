import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyAccessKey, verifyServeKey } from "@/lib/keys/tokens";
import { LEASE_SECONDS, registry } from "@/lib/signaling/registry";

export const dynamic = "force-dynamic";

/**
 * Signaling. The only thing a node says to the platform, and the only thing
 * the platform remembers — in RAM, until the lease lapses.
 *
 * Authenticated. Every call must carry a valid capability key, and the
 * subject is taken from that key rather than from the request body. This
 * closes a takedown: before it, the endpoints accepted a connectionId with no
 * proof of ownership, and that id was rendered into the /read page, so any
 * visitor could knock any contributor's node offline. Serving is still free —
 * any signed-in reader may announce — but it must be attributable, so nobody
 * can flood the registry anonymously or announce under someone else's
 * subject. See docs/CONTRACTS.md.
 *
 * Note what is still absent: the platform never reads the client IP. The
 * address a reader should fetch from is stated by the node in its own
 * announcement.
 */

const item = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  kind: z.enum(["column", "dataset"]),
  tags: z.array(z.string().max(60)).max(20).default([]),
  access: z.enum(["public", "member", "lab"]).optional(),
  summary: z.string().max(600).optional(),
  openProposals: z.number().int().min(0).max(100000).optional(),
});

// `sub` is intentionally absent: it comes from the key, never the body.
const announcement = z.object({
  displayName: z.string().min(1).max(120),
  address: z
    .string()
    .url()
    .refine((value) => /^https?:/.test(value), "http(s) only"),
  /**
   * Where this contributor says they can be paid. Opaque, and bounded.
   *
   * Not parsed, not validated beyond a length: recognising a wallet address
   * would be the first step towards routing to one, and the platform is not a
   * party to anything that happens with this string. Bounded because it is
   * held in RAM and repeated to readers, and an unbounded field a stranger can
   * set is a place to put something that is not a payment detail.
   */
  payTo: z.string().max(300).optional(),
  items: z.array(item).max(500),
});

/**
 * The authenticated subject, or null. Never trusts a body field for this.
 *
 * Either a full access key (a signed-in reader announcing from the browser)
 * or a serve key (the announce-only NODE_KEY a contributor runs unattended)
 * is accepted — both prove a subject, and announcing is all this route does.
 * The serve key is deliberately *not* an access key, so accepting it here is
 * the only place it is honoured.
 */
async function subject(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  const access = await verifyAccessKey(token);
  if (access?.sub) return access.sub;
  const serve = await verifyServeKey(token);
  return serve?.sub ?? null;
}

export async function POST(request: Request) {
  const sub = await subject(request);
  if (!sub) {
    return NextResponse.json(
      { error: "A valid key is required to announce." },
      { status: 401 },
    );
  }

  const parsed = announcement.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid announcement" },
      { status: 400 },
    );
  }

  const handle = registry().announce({ sub, ...parsed.data });
  return NextResponse.json({
    connectionId: handle.connectionId,
    leaseSeconds: LEASE_SECONDS,
  });
}

/** Extends a lease. A node calls this on a timer while it is serving. */
export async function PUT(request: Request) {
  const sub = await subject(request);
  if (!sub) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const alive = registry().heartbeat(
    url.searchParams.get("connection") ?? "",
    sub,
  );
  return NextResponse.json(
    { alive, leaseSeconds: LEASE_SECONDS },
    { status: alive ? 200 : 410 },
  );
}

/**
 * Withdraws immediately, on graceful shutdown.
 *
 * Only the subject that announced the connection can withdraw it. A leaked
 * connectionId is not a capability — the key is.
 */
export async function DELETE(request: Request) {
  const sub = await subject(request);
  if (!sub) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const withdrawn = registry().withdraw(
    url.searchParams.get("connection") ?? "",
    sub,
  );
  return NextResponse.json({ withdrawn });
}
