"use server";

import { and, desc, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { runChecks, syncClaims } from "@/lib/claims/runner";
import { normaliseNewlines, parseBody } from "@/lib/claims/syntax";
import { db } from "@/lib/db";
import { columns, proposals, revisions } from "@/lib/db/schema";
import { canRead, getViewer } from "@/lib/entitlements";
import { readingMinutes, slugify } from "@/lib/studio/permissions";

export interface CollabState {
  error?: string;
  message?: string;
}

/**
 * Forking a column copies its text into a draft you own, with the lineage
 * recorded. The fork starts private; publishing it is a separate decision.
 *
 * Deliberately a copy rather than a live reference: a fork is a claim that
 * your version should stand on its own, and it should not silently change
 * when the original is edited.
 */
export async function forkColumn(formData: FormData) {
  const columnId = String(formData.get("columnId") ?? "");
  const viewer = await getViewer();

  if (!viewer.id) {
    redirect(`/signin?callbackUrl=${encodeURIComponent("/columns")}`);
  }

  const source = await db.query.columns.findFirst({
    where: eq(columns.id, columnId),
  });
  if (!source) throw new Error("No such column.");

  // You can only fork what you are entitled to read in full.
  if (!canRead(viewer, source.access)) {
    redirect(`/pricing?from=${encodeURIComponent(`/columns/${source.slug}`)}`);
  }

  const base = slugify(`${source.title} fork`);
  let slug = base;
  for (let attempt = 1; attempt < 100; attempt++) {
    const clash = await db.query.columns.findFirst({
      where: eq(columns.slug, slug),
    });
    if (!clash) break;
    slug = `${base}-${attempt + 1}`;
  }

  const [fork] = await db
    .insert(columns)
    .values({
      slug,
      title: `${source.title} (fork)`,
      subtitle: source.subtitle,
      excerpt: source.excerpt,
      body: source.body,
      authorId: viewer.id,
      status: "draft",
      access: source.access,
      forkedFromId: source.id,
      repoUrl: source.repoUrl,
      repoCommit: source.repoCommit,
      readingMinutes: source.readingMinutes,
    })
    .returning();

  await syncClaims(fork.id, fork.body);
  redirect(`/studio/${fork.id}`);
}

/** A reader-submitted edit. The pull request. */
export async function submitProposal(
  _prev: CollabState,
  formData: FormData,
): Promise<CollabState> {
  const columnId = String(formData.get("columnId") ?? "");
  const viewer = await getViewer();

  if (!viewer.id) return { error: "Sign in to propose an edit." };

  const column = await db.query.columns.findFirst({
    where: eq(columns.id, columnId),
  });
  if (!column) return { error: "No such column." };
  if (!canRead(viewer, column.access)) {
    return { error: "Proposing edits needs a membership." };
  }

  const body = normaliseNewlines(String(formData.get("body") ?? ""));
  const title = String(formData.get("title") ?? "").trim();
  const rationale = String(formData.get("rationale") ?? "").trim();

  if (!title) return { error: "Give the proposal a title." };
  if (body.trim() === normaliseNewlines(column.body).trim()) {
    return { error: "Nothing changed." };
  }

  const parsed = parseBody(body);
  if (parsed.errors.length > 0) {
    return { error: `Claim problems: ${parsed.errors[0].message}` };
  }

  const base = await db.query.revisions.findFirst({
    where: eq(revisions.columnId, column.id),
    orderBy: [desc(revisions.number)],
  });

  const [proposal] = await db
    .insert(proposals)
    .values({
      columnId: column.id,
      authorId: viewer.id,
      title,
      rationale,
      baseRevisionId: base?.id ?? null,
      body,
    })
    .returning();

  redirect(`/proposals/${proposal.id}`);
}

/**
 * Merging applies the proposal to the column, writes a revision crediting the
 * proposer, and re-runs CI. It refuses on a broken claim for the same reason
 * publish does.
 */
export async function mergeProposal(
  _prev: CollabState,
  formData: FormData,
): Promise<CollabState> {
  const proposalId = String(formData.get("proposalId") ?? "");

  try {
    const { viewer, proposal, column } = await loadReviewable(proposalId);
    if (proposal.status !== "open") return { error: "Already resolved." };

    await db
      .update(columns)
      .set({
        body: proposal.body,
        readingMinutes: readingMinutes(parseBody(proposal.body).prose),
        updatedAt: new Date(),
      })
      .where(eq(columns.id, column.id));

    await syncClaims(column.id, proposal.body);
    const { run, outcomes } = await runChecks(column.id, { trigger: "publish" });

    if (run.conclusion === "broken") {
      // Roll the body back rather than leave a published column with a number
      // that resolves to nothing.
      await db
        .update(columns)
        .set({ body: column.body, updatedAt: new Date() })
        .where(eq(columns.id, column.id));
      await syncClaims(column.id, column.body);
      await runChecks(column.id, { trigger: "manual" });

      return {
        error: `Merge reverted: ${outcomes.find((o) => o.verdict === "broken")?.note ?? "a claim does not resolve"}`,
      };
    }

    const previous = await db.query.revisions.findMany({
      where: eq(revisions.columnId, column.id),
    });

    await db.insert(revisions).values({
      columnId: column.id,
      number: previous.length + 1,
      title: column.title,
      body: proposal.body,
      message: `Merged proposal: ${proposal.title}`,
      authorId: proposal.authorId,
    });

    await db
      .update(proposals)
      .set({
        status: "merged",
        resolvedAt: new Date(),
        resolvedById: viewer.id,
      })
      .where(eq(proposals.id, proposal.id));

    refresh();
    return { message: "Merged, and the checks re-ran against the new text." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function closeProposal(
  _prev: CollabState,
  formData: FormData,
): Promise<CollabState> {
  const proposalId = String(formData.get("proposalId") ?? "");
  try {
    const { viewer, proposal } = await loadReviewable(proposalId);
    await db
      .update(proposals)
      .set({
        status: "closed",
        resolvedAt: new Date(),
        resolvedById: viewer.id,
      })
      .where(eq(proposals.id, proposal.id));
    refresh();
    return { message: "Closed without merging." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function loadReviewable(proposalId: string) {
  const viewer = await getViewer();
  if (!viewer.id) throw new Error("Sign in first.");

  const proposal = await db.query.proposals.findFirst({
    where: eq(proposals.id, proposalId),
  });
  if (!proposal) throw new Error("No such proposal.");

  const column = await db.query.columns.findFirst({
    where: eq(columns.id, proposal.columnId),
  });
  if (!column) throw new Error("No such column.");

  // Only the column's author, or an editor, decides what lands in it.
  if (viewer.id !== column.authorId && viewer.role !== "editor") {
    throw new Error("Only the author can resolve proposals on this column.");
  }

  return { viewer, proposal, column };
}
