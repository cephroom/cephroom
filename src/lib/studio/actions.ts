"use server";

import { and, eq, ne } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { evaluateClaim, runChecks, syncClaims } from "@/lib/claims/runner";
import {
  formatValue,
  normaliseNewlines,
  parseBody,
} from "@/lib/claims/syntax";
import { db } from "@/lib/db";
import { checkRuns, columns, revisions } from "@/lib/db/schema";
import { getViewer } from "@/lib/entitlements";

import { canAuthor, canEditColumn, readingMinutes, slugify } from "./permissions";

export interface ClaimPreview {
  key: string;
  verdict: "verified" | "drifted" | "broken";
  authored: string;
  observed: string;
  deltaPct: number | null;
  note: string | null;
  query: string;
  nPoints: number | null;
  nDocs: number | null;
}

export interface PreviewResult {
  claims: ClaimPreview[];
  errors: { key: string | null; message: string }[];
  wordCount: number;
}

export interface SaveState {
  ok?: boolean;
  message?: string;
  error?: string;
  /** Claim problems that blocked a publish. */
  blocking?: string[];
}

async function loadEditable(columnId: string) {
  const viewer = await getViewer();
  if (!canAuthor(viewer)) {
    throw new Error("Your plan does not include the studio.");
  }

  const column = await db.query.columns.findFirst({
    where: eq(columns.id, columnId),
  });
  if (!column) throw new Error("No such column.");
  if (!canEditColumn(viewer, column)) {
    throw new Error("That column is not yours to edit.");
  }

  return { viewer, column };
}

async function uniqueSlug(base: string, exceptId?: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const clash = await db.query.columns.findFirst({
      where: exceptId
        ? and(eq(columns.slug, candidate), ne(columns.id, exceptId))
        : eq(columns.slug, candidate),
    });
    if (!clash) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

/**
 * Resolves every claim in a body against the live dataset without writing
 * anything. This is what the editor panel calls while the author types, so
 * that a broken query is visible before publish rather than after it.
 */
export async function previewClaims(body: string): Promise<PreviewResult> {
  const viewer = await getViewer();
  if (!canAuthor(viewer)) {
    return { claims: [], errors: [{ key: null, message: "Not authorised." }], wordCount: 0 };
  }

  const parsed = parseBody(body);

  const claims: ClaimPreview[] = [];
  for (const claim of parsed.claims) {
    const outcome = await evaluateClaim(claim);
    claims.push({
      key: claim.key,
      verdict: outcome.verdict,
      authored: formatValue(claim.expectedValue, claim.expectedUnit),
      observed: formatValue(outcome.observedValue, outcome.observedUnit),
      deltaPct: outcome.deltaPct,
      note: outcome.note,
      query: `${claim.metric}(${claim.subject} × ${claim.object}) scope=${claim.scope} select=${claim.select}`,
      nPoints: outcome.evidence?.nPoints ?? null,
      nDocs: outcome.evidence?.nDocs ?? null,
    });
  }

  return {
    claims,
    errors: parsed.errors.map(({ key, message }) => ({ key, message })),
    wordCount: parsed.prose.split(/\s+/).filter(Boolean).length,
  };
}

export async function createColumn() {
  const viewer = await getViewer();
  if (!canAuthor(viewer) || !viewer.id) {
    throw new Error("Your plan does not include the studio.");
  }

  const [created] = await db
    .insert(columns)
    .values({
      slug: await uniqueSlug("untitled-draft"),
      title: "Untitled draft",
      body: STARTER_BODY,
      authorId: viewer.id,
      status: "draft",
      access: "member",
    })
    .returning();

  redirect(`/studio/${created.id}`);
}

export async function saveColumn(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const columnId = String(formData.get("columnId") ?? "");

  try {
    const { column } = await loadEditable(columnId);

    const title = String(formData.get("title") ?? "").trim() || "Untitled draft";
    // Store LF so a round-trip through the editor does not churn the body.
    const body = normaliseNewlines(String(formData.get("body") ?? ""));
    const parsed = parseBody(body);

    // The slug follows the title only while the column is still a draft.
    // Once published, the URL is a promise to whoever linked to it.
    const slug =
      column.status === "draft"
        ? await uniqueSlug(slugify(title), column.id)
        : column.slug;

    await db
      .update(columns)
      .set({
        title,
        slug,
        subtitle: String(formData.get("subtitle") ?? "").trim() || null,
        excerpt:
          String(formData.get("excerpt") ?? "").trim() ||
          String(formData.get("subtitle") ?? "").trim() ||
          null,
        body,
        access: String(formData.get("access") ?? "member") as
          | "public"
          | "member"
          | "lab",
        repoUrl: String(formData.get("repoUrl") ?? "").trim() || null,
        repoCommit: String(formData.get("repoCommit") ?? "").trim() || null,
        readingMinutes: readingMinutes(parsed.prose),
        updatedAt: new Date(),
      })
      .where(eq(columns.id, column.id));

    await syncClaims(column.id, body);
    refresh();

    return {
      ok: true,
      message: `Saved. ${plural(parsed.claims.length, "claim")} recorded.`,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Publish runs CI first and refuses on a broken claim.
 *
 * Drift does not block: a column may legitimately be *about* a value that has
 * moved. A broken claim is different - it means a number on the page resolves
 * to nothing at all, and there is no version of that which is publishable.
 */
export async function publishColumn(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const columnId = String(formData.get("columnId") ?? "");

  try {
    const { viewer, column } = await loadEditable(columnId);

    const parsed = parseBody(column.body);
    if (parsed.errors.length > 0) {
      return {
        error: "Fix the claim problems before publishing.",
        blocking: parsed.errors.map((e) => e.message),
      };
    }

    await syncClaims(column.id, column.body);
    const { run, outcomes } = await runChecks(column.id, { trigger: "publish" });

    if (run.conclusion === "broken") {
      return {
        error: "Publish blocked: some claims do not resolve.",
        blocking: outcomes
          .filter((outcome) => outcome.verdict === "broken")
          .map((outcome) => `${outcome.key}: ${outcome.note ?? "does not resolve"}`),
      };
    }

    const previous = await db.query.revisions.findMany({
      where: eq(revisions.columnId, column.id),
    });

    const [revision] = await db
      .insert(revisions)
      .values({
        columnId: column.id,
        number: previous.length + 1,
        title: column.title,
        body: column.body,
        message:
          String(formData.get("message") ?? "").trim() ||
          (previous.length === 0 ? "First publication" : "Update"),
        authorId: viewer.id,
      })
      .returning();

    await db
      .update(columns)
      .set({
        status: "published",
        publishedAt: column.publishedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(columns.id, column.id));

    // Attribute the run to the revision it validated.
    await db
      .update(checkRuns)
      .set({ revisionId: revision.id })
      .where(eq(checkRuns.id, run.id));

    refresh();
    return {
      ok: true,
      message:
        run.conclusion === "drifted"
          ? `Published as revision ${revision.number}, with ${plural(run.nDrifted, "drifted claim")} flagged on the page.`
          : `Published as revision ${revision.number}. ${plural(run.nVerified, "claim")} verified.`,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function unpublishColumn(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const columnId = String(formData.get("columnId") ?? "");
  try {
    const { column } = await loadEditable(columnId);
    await db
      .update(columns)
      .set({ status: "draft", updatedAt: new Date() })
      .where(eq(columns.id, column.id));
    refresh();
    return { ok: true, message: "Moved back to draft. The public URL now 404s." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Deletes a draft outright. Published columns are never deleted from here -
 * a URL somebody has linked to should stop resolving only by an explicit
 * unpublish, and even then the row survives so the revision history does.
 */
export async function deleteDraft(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const columnId = String(formData.get("columnId") ?? "");
  let ok = false;

  try {
    const { column } = await loadEditable(columnId);
    if (column.status === "published") {
      return { error: "Move it back to draft before deleting it." };
    }
    await db.delete(columns).where(eq(columns.id, column.id));
    ok = true;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  // redirect() throws, so it has to sit outside the try.
  if (ok) redirect("/studio");
  return {};
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

const STARTER_BODY = `Open with the claim the piece is actually making.

Then state a number the way Bindery wants it stated: as a query, not a
literal. The value below is what you observed; the reader sees what the
dataset says now.

Haloperidol binds D2 at {{claim:example}}.

\`\`\`claim example
dataset: receptorome-ki
metric:  median_ki_nm
subject: DRD2
object:  haloperidol
scope:   all
value:   1.549 nM
tolerance: 10%
\`\`\`

## A section

Delete all of this and write the real thing.
`;
