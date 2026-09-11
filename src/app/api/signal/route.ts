import { NextResponse } from "next/server";
import { z } from "zod";

import { LEASE_SECONDS, registry } from "@/lib/signaling/registry";

export const dynamic = "force-dynamic";

/**
 * Signaling. The only thing a node says to the platform, and the only thing
 * the platform remembers — in RAM, until the lease lapses.
 *
 * Note what is absent: the platform never reads the client IP. The address a
 * reader should fetch from is stated by the node in its own announcement.
 * Inferring it from the socket would be collecting a network identifier about
 * a person, which Contract 1 forbids.
 */

const item = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  kind: z.enum(["column", "dataset"]),
  tags: z.array(z.string().max(60)).max(20).default([]),
  access: z.enum(["public", "member", "lab"]).optional(),
  summary: z.string().max(600).optional(),
});

const announcement = z.object({
  sub: z.string().min(1).max(120),
  displayName: z.string().min(1).max(120),
  address: z
    .string()
    .url()
    .refine((value) => /^https?:/.test(value), "http(s) only"),
  items: z.array(item).max(500),
});

export async function POST(request: Request) {
  const parsed = announcement.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid announcement" },
      { status: 400 },
    );
  }

  const handle = registry().announce(parsed.data);
  return NextResponse.json({
    connectionId: handle.connectionId,
    leaseSeconds: LEASE_SECONDS,
  });
}

/** Extends a lease. A node calls this on a timer while it is serving. */
export async function PUT(request: Request) {
  const url = new URL(request.url);
  const connectionId = url.searchParams.get("connection") ?? "";

  const alive = registry().heartbeat(connectionId);
  return NextResponse.json(
    { alive, leaseSeconds: LEASE_SECONDS },
    { status: alive ? 200 : 410 },
  );
}

/**
 * Withdraws immediately, on graceful shutdown.
 *
 * Without this a stopped node would stay visible until its lease lapsed. With
 * it, "stop the process and the work disappears" is immediate in the ordinary
 * case, and bounded by the lease in the ungraceful one.
 */
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  registry().withdraw(url.searchParams.get("connection") ?? "");
  return NextResponse.json({ withdrawn: true });
}
