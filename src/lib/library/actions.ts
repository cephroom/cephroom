"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { bookmarks } from "@/lib/db/schema";
import { getViewer } from "@/lib/entitlements";

/**
 * Saving a column is a toggle, and deliberately not gated by plan: a free
 * reader should be able to keep a member column to come back to, which is
 * also the most honest upgrade prompt there is.
 */
export async function toggleBookmark(formData: FormData) {
  const columnId = String(formData.get("columnId") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "/columns");
  const viewer = await getViewer();

  if (!viewer.id) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(returnTo)}`);
  }

  const existing = await db.query.bookmarks.findFirst({
    where: and(
      eq(bookmarks.userId, viewer.id),
      eq(bookmarks.columnId, columnId),
    ),
  });

  if (existing) {
    await db
      .delete(bookmarks)
      .where(
        and(eq(bookmarks.userId, viewer.id), eq(bookmarks.columnId, columnId)),
      );
  } else {
    await db.insert(bookmarks).values({ userId: viewer.id, columnId });
  }

  refresh();
}
