import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyAccessKey, verifyServeKey } from "@/lib/keys/tokens";
import { LEASE_SECONDS, registry } from "@/lib/signaling/registry";

export const dynamic = "force-dynamic";


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
  payTo: z.string().max(300).optional(),
  items: z.array(item).max(500),
});

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
