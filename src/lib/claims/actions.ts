"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";

import { db } from "@/lib/db";
import { columns } from "@/lib/db/schema";
import { getViewer } from "@/lib/entitlements";

import { runChecks, syncClaims } from "./runner";

/**
 * Re-runs every claim in a column. Only the author can trigger it: a check
 * run writes rows, so this is not a read-only endpoint.
 */
export async function rerunChecks(formData: FormData) {
  const columnId = String(formData.get("columnId") ?? "");
  const viewer = await getViewer();

  const column = await db.query.columns.findFirst({
    where: eq(columns.id, columnId),
  });
  if (!column) throw new Error("No such column.");

  const canRun =
    viewer.id === column.authorId || viewer.role === "editor";
  if (!canRun) throw new Error("Only the author can re-run these checks.");

  // Re-parse first, so a body edited outside the studio is reflected before
  // the run rather than after it.
  await syncClaims(column.id, column.body);
  await runChecks(column.id, { trigger: "manual" });

  refresh();
}
