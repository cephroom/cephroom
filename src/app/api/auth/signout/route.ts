import { NextResponse } from "next/server";

import { clearedCookies } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const response = NextResponse.redirect(new URL("/", url.origin), 303);
  for (const cookie of clearedCookies()) response.cookies.set(cookie);
  return response;
}
