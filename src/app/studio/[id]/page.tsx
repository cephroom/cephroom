import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";

import { ColumnEditor } from "@/components/column-editor";
import { formatDateTime } from "@/lib/columns";
import { db } from "@/lib/db";
import { columns, revisions } from "@/lib/db/schema";
import { getViewer } from "@/lib/entitlements";
import {
  deleteDraft,
  previewClaims,
  publishColumn,
  saveColumn,
  unpublishColumn,
} from "@/lib/studio/actions";
import { canAuthor, canEditColumn } from "@/lib/studio/permissions";

export const metadata: Metadata = { title: "Edit column" };

export default async function EditColumnPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await getViewer();

  if (!viewer.id) redirect(`/signin?callbackUrl=/studio/${id}`);
  if (!canAuthor(viewer)) redirect("/studio");

  const column = await db.query.columns.findFirst({
    where: eq(columns.id, id),
  });
  if (!column) notFound();
  if (!canEditColumn(viewer, column)) notFound();

  const history = await db.query.revisions.findMany({
    where: eq(revisions.columnId, column.id),
    orderBy: [desc(revisions.number)],
    limit: 10,
  });

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/studio"
          className="text-[0.82rem] text-ink-faint transition-colors hover:text-ink"
        >
          ← Studio
        </Link>
        <div className="flex items-center gap-3 text-[0.78rem] text-ink-faint">
          <span
            className={`rounded-full border px-2 py-0.5 uppercase tracking-[0.06em] ${
              column.status === "published"
                ? "border-verified/30 bg-verified-wash text-verified"
                : "border-rule text-ink-muted"
            }`}
          >
            {column.status}
          </span>
          {column.status === "published" && (
            <Link
              href={`/columns/${column.slug}`}
              className="text-accent hover:underline"
            >
              view live →
            </Link>
          )}
          <Link
            href={`/columns/${column.slug}/checks`}
            className="hover:text-ink"
          >
            check history
          </Link>
        </div>
      </div>

      <ColumnEditor
        column={{
          id: column.id,
          slug: column.slug,
          title: column.title,
          subtitle: column.subtitle ?? "",
          excerpt: column.excerpt ?? "",
          body: column.body,
          access: column.access,
          status: column.status,
          repoUrl: column.repoUrl ?? "",
          repoCommit: column.repoCommit ?? "",
        }}
        saveAction={saveColumn}
        publishAction={publishColumn}
        unpublishAction={unpublishColumn}
        deleteAction={deleteDraft}
        previewAction={previewClaims}
      />

      {history.length > 0 && (
        <section className="mt-10 border-t border-rule pt-7">
          <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-ink-faint">
            Revisions
          </h2>
          <ol className="mt-3">
            {history.map((revision) => (
              <li
                key={revision.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-rule py-2.5 text-[0.85rem] last:border-0"
              >
                <span className="font-mono text-[0.78rem] text-ink-faint">
                  r{revision.number}
                </span>
                <span>{revision.message}</span>
                <time className="ml-auto shrink-0 text-[0.76rem] text-ink-faint">
                  {formatDateTime(revision.createdAt)}
                </time>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
