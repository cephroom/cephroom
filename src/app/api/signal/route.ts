import { NextResponse } from "next/server";

import { NO_STORE } from "@/lib/api/shape";

import { verifyAccessKey, verifyServeKey } from "@/lib/keys/tokens";
import {
  announcementSchema,
  withinCapacity,
} from "@/lib/signaling/announcement";
import { LEASE_SECONDS, registry } from "@/lib/signaling/registry";
import { FREE_SERVING_CAPACITY } from "@/lib/stripe/plans";

export const dynamic = "force-dynamic";


/**
 * Who is announcing, and how much they may announce.
 *
 * Both come from the key. A serve key carries the capacity its plan bought;
 * an ordinary session key carries none, so it gets the free capacity — which
 * is the point, because serving is free and signing in is enough.
 */
async function announcer(
  request: Request,
): Promise<{ sub: string; capacity: number } | null> {
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();

  const serve = await verifyServeKey(token);
  if (serve) return serve;

  const access = await verifyAccessKey(token);
  if (access?.sub) {
    return { sub: access.sub, capacity: FREE_SERVING_CAPACITY };
  }
  return null;
}

export async function POST(request: Request) {
  const caller = await announcer(request);
  if (!caller) {
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

  if (!withinCapacity(parsed.data, caller.capacity)) {
    return NextResponse.json(
      {
        error: `This key may announce ${caller.capacity} items at once; the announcement has ${parsed.data.items.length}. Serving is free and this is only about volume — see /contribute#plans.`,
      },
      { status: 413, headers: NO_STORE },
    );
  }

  const handle = registry().announce({ sub: caller.sub, ...parsed.data });
  return NextResponse.json(
    { connectionId: handle.connectionId, leaseSeconds: LEASE_SECONDS },
    { headers: NO_STORE },
  );
}

export async function PUT(request: Request) {
  const sub = (await announcer(request))?.sub;
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
  const sub = (await announcer(request))?.sub;
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
