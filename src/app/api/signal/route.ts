import { NextResponse } from "next/server";

import { NO_STORE } from "@/lib/api/shape";

import { verifyAccessKey, verifyServeKey } from "@/lib/keys/tokens";
import { announcementSchema } from "@/lib/signaling/announcement";
import { LEASE_SECONDS, registry } from "@/lib/signaling/registry";

export const dynamic = "force-dynamic";


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
      { status: 401, headers: NO_STORE },
    );
  }

  const parsed = announcementSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid announcement" },
      { status: 400, headers: NO_STORE },
    );
  }

  const handle = registry().announce({ sub, ...parsed.data });
  return NextResponse.json(
    { connectionId: handle.connectionId, leaseSeconds: LEASE_SECONDS },
    { headers: NO_STORE },
  );
}

export async function PUT(request: Request) {
  const sub = await subject(request);
  if (!sub) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }

  const url = new URL(request.url);
  const alive = registry().heartbeat(
    url.searchParams.get("connection") ?? "",
    sub,
  );
  return NextResponse.json(
    { alive, leaseSeconds: LEASE_SECONDS },
    { status: alive ? 200 : 410, headers: NO_STORE },
  );
}

export async function DELETE(request: Request) {
  const sub = await subject(request);
  if (!sub) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }

  const url = new URL(request.url);
  const withdrawn = registry().withdraw(
    url.searchParams.get("connection") ?? "",
    sub,
  );
  return NextResponse.json({ withdrawn }, { headers: NO_STORE });
}
