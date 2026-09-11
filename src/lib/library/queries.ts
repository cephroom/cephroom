import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { bookmarks } from "@/lib/db/schema";

export async function isBookmarked(
  userId: string | null,
  columnId: string,
): Promise<boolean> {
  if (!userId) return false;
  const row = await db.query.bookmarks.findFirst({
    where: and(eq(bookmarks.userId, userId), eq(bookmarks.columnId, columnId)),
  });
  return Boolean(row);
}
