import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { proposals } from "@/lib/db/schema";

/** Proposals against a column, newest first, with their authors. */
export async function proposalsFor(columnId: string) {
  return db.query.proposals.findMany({
    where: eq(proposals.columnId, columnId),
    orderBy: [desc(proposals.createdAt)],
    with: { author: true },
  });
}

export async function openProposalCount(columnId: string): Promise<number> {
  const rows = await db.query.proposals.findMany({
    where: and(eq(proposals.columnId, columnId), eq(proposals.status, "open")),
    columns: { id: true },
  });
  return rows.length;
}
