"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";

import type {
  ClaimPreview,
  PreviewResult,
  SaveState,
} from "@/lib/studio/actions";

interface EditableColumn {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  excerpt: string;
  body: string;
  access: "public" | "member" | "lab";
  status: "draft" | "published" | "archived";
  repoUrl: string;
  repoCommit: string;
}

export function ColumnEditor({
  column,
  saveAction,
  publishAction,
  unpublishAction,
  deleteAction,
  previewAction,
}: {
  column: EditableColumn;
  saveAction: (state: SaveState, formData: FormData) => Promise<SaveState>;
  publishAction: (state: SaveState, formData: FormData) => Promise<SaveState>;
  unpublishAction: (state: SaveState, formData: FormData) => Promise<SaveState>;
  deleteAction: (state: SaveState, formData: FormData) => Promise<SaveState>;
  previewAction: (body: string) => Promise<PreviewResult>;
}) {
  const [body, setBody] = useState(column.body);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [checking, startChecking] = useTransition();

  const [saveState, save] = useActionState<SaveState, FormData>(saveAction, {});
  const [publishState, publish] = useActionState<SaveState, FormData>(
    publishAction,
    {},
  );
  const [unpublishState, unpublish] = useActionState<SaveState, FormData>(
    unpublishAction,
    {},
  );
  const [deleteState, remove] = useActionState<SaveState, FormData>(
    deleteAction,
    {},
  );

  // Resolve the claims a moment after typing stops, so the panel keeps up
  // without firing a query on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      startChecking(async () => setPreview(await previewAction(body)));
    }, 600);
    return () => clearTimeout(timer);
  }, [body, previewAction]);

  const status = publishState.error
    ? publishState
    : unpublishState.error || unpublishState.ok
      ? unpublishState
      : publishState.ok
        ? publishState
        : saveState;

  return (
    <div className="mt-6 grid gap-7 md:grid-cols-[1.35fr_1fr] md:items-start">
      <form action={save} className="space-y-4">
        <input type="hidden" name="columnId" value={column.id} />

        <Field label="Title">
          <input
            name="title"
            defaultValue={column.title}
            className={INPUT}
            placeholder="The claim the piece is making"
          />
        </Field>

        <Field
          label="Standfirst"
          hint="One or two sentences. Shown under the title and in the feed."
        >
          <textarea
            name="subtitle"
            defaultValue={column.subtitle}
            rows={2}
            className={INPUT}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Who can read it">
            <select
              name="access"
              defaultValue={column.access}
              className={INPUT}
            >
              <option value="public">Public — free to read</option>
              <option value="member">Member</option>
              <option value="lab">Lab</option>
            </select>
          </Field>

          <Field label="Slug" hint={column.status === "published" ? "Fixed once published." : "Follows the title until publish."}>
            <input
              readOnly
              value={`/columns/${column.slug}`}
              className={`${INPUT} text-ink-faint`}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1.6fr_1fr]">
          <Field label="Repository" hint="The code behind the analysis.">
            <input
              name="repoUrl"
              defaultValue={column.repoUrl}
              placeholder="https://github.com/org/repo"
              className={INPUT}
            />
          </Field>
          <Field label="Commit" hint="Pins it to a revision.">
            <input
              name="repoCommit"
              defaultValue={column.repoCommit}
              placeholder="9f2c1ab"
              className={`${INPUT} font-mono`}
            />
          </Field>
        </div>

        <Field
          label="Body"
          hint="Markdown, plus {{claim:key}} references and ```claim blocks."
        >
          <textarea
            name="body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={26}
            spellCheck
            className={`${INPUT} resize-y font-mono text-[0.82rem] leading-relaxed`}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <Save />
          {preview && (
            <span className="text-[0.78rem] tnum text-ink-faint">
              {preview.wordCount} words · {preview.claims.length} claims
            </span>
          )}
        </div>

        {status.message && !status.error && (
          <p
            role="status"
            className="rounded-md border border-verified/30 bg-verified-wash px-3 py-2 text-[0.82rem] text-verified"
          >
            {status.message}
          </p>
        )}
        {status.error && (
          <div
            role="alert"
            className="rounded-md border border-broken/30 bg-broken-wash px-3 py-2 text-[0.82rem] text-broken"
          >
            <p className="font-medium">{status.error}</p>
            {status.blocking && (
              <ul className="mt-1.5 space-y-1">
                {status.blocking.map((line) => (
                  <li key={line}>· {line}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </form>

      <aside className="space-y-4 md:sticky md:top-20">
        <ClaimPanel preview={preview} checking={checking} />

        <div className="rounded-xl border border-rule bg-paper-raised p-4">
          <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-ink-faint">
            Publishing
          </h2>
          <p className="mt-2 text-[0.82rem] leading-relaxed text-ink-muted">
            Save first — publish runs the checks against what is stored, and
            refuses if any claim fails to resolve. Drift does not block; it is
            flagged on the page.
          </p>

          <form action={publish} className="mt-3 space-y-2.5">
            <input type="hidden" name="columnId" value={column.id} />
            <input
              name="message"
              placeholder="Revision message"
              className={`${INPUT} text-[0.85rem]`}
            />
            <Publish published={column.status === "published"} />
          </form>

          {column.status === "published" ? (
            <form action={unpublish} className="mt-2.5">
              <input type="hidden" name="columnId" value={column.id} />
              <Unpublish />
            </form>
          ) : (
            <form action={remove} className="mt-2.5">
              <input type="hidden" name="columnId" value={column.id} />
              <Delete />
            </form>
          )}

          {deleteState.error && (
            <p role="alert" className="mt-2 text-[0.78rem] text-broken">
              {deleteState.error}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

const INPUT =
  "w-full rounded-md border border-rule-strong bg-paper-raised px-3 py-2 text-[0.9rem] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-muted">
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block text-[0.74rem] text-ink-faint">{hint}</span>
      )}
    </label>
  );
}

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-accent px-5 py-2.5 text-[0.88rem] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
    >
      {pending ? "Saving…" : "Save draft"}
    </button>
  );
}

function Publish({ published }: { published: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md border border-accent bg-transparent px-4 py-2 text-[0.86rem] font-medium text-accent transition-colors hover:bg-accent-wash disabled:opacity-60"
    >
      {pending
        ? "Running checks…"
        : published
          ? "Publish an update"
          : "Run checks and publish"}
    </button>
  );
}

function Delete() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md px-4 py-2 text-[0.84rem] text-ink-faint transition-colors hover:text-broken disabled:opacity-60"
    >
      {pending ? "Deleting..." : "Delete this draft"}
    </button>
  );
}

function Unpublish() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md px-4 py-2 text-[0.84rem] text-ink-muted transition-colors hover:text-ink disabled:opacity-60"
    >
      {pending ? "Working…" : "Move back to draft"}
    </button>
  );
}

const TONE = {
  verified: {
    dot: "bg-verified",
    text: "text-verified",
    border: "border-verified/30",
  },
  drifted: {
    dot: "bg-drifted",
    text: "text-drifted",
    border: "border-drifted/30",
  },
  broken: { dot: "bg-broken", text: "text-broken", border: "border-broken/30" },
} as const;

function ClaimPanel({
  preview,
  checking,
}: {
  preview: PreviewResult | null;
  checking: boolean;
}) {
  const broken = preview?.claims.filter((c) => c.verdict === "broken") ?? [];

  return (
    <div className="rounded-xl border border-rule bg-paper-raised">
      <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
        <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-ink-faint">
          Claims
        </h2>
        <span className="text-[0.72rem] text-ink-faint">
          {checking ? "checking…" : "live"}
        </span>
      </div>

      {preview?.errors.length ? (
        <ul className="space-y-1.5 border-b border-rule bg-broken-wash/40 px-4 py-3">
          {preview.errors.map((error) => (
            <li key={error.message} className="text-[0.8rem] leading-relaxed text-broken">
              {error.message}
            </li>
          ))}
        </ul>
      ) : null}

      {!preview || preview.claims.length === 0 ? (
        <p className="px-4 py-6 text-center text-[0.84rem] text-ink-muted">
          No claims yet. Reference one with{" "}
          <code className="font-mono text-[0.78rem]">{"{{claim:key}}"}</code>{" "}
          and define it in a fenced block.
        </p>
      ) : (
        <ul>
          {preview.claims.map((claim) => (
            <ClaimRow key={claim.key} claim={claim} />
          ))}
        </ul>
      )}

      {broken.length > 0 && (
        <p className="border-t border-rule px-4 py-2.5 text-[0.78rem] text-broken">
          {broken.length} claim{broken.length === 1 ? "" : "s"} will block
          publishing.
        </p>
      )}
    </div>
  );
}

function ClaimRow({ claim }: { claim: ClaimPreview }) {
  const tone = TONE[claim.verdict];
  return (
    <li className="border-b border-rule px-4 py-3 last:border-0">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
        <code className="font-mono text-[0.78rem]">{claim.key}</code>
        <span className={`ml-auto text-[0.74rem] font-medium ${tone.text}`}>
          {claim.verdict}
        </span>
      </div>

      <p className="mt-1.5 break-words font-mono text-[0.7rem] leading-relaxed text-ink-faint">
        {claim.query}
      </p>

      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[0.76rem] tnum">
        <span className="text-ink-faint">
          authored <span className="text-ink">{claim.authored}</span>
        </span>
        <span className="text-ink-faint">
          dataset <span className="text-ink">{claim.observed}</span>
        </span>
        {claim.deltaPct !== null && claim.deltaPct !== 0 && (
          <span className={tone.text}>
            {claim.deltaPct > 0 ? "+" : ""}
            {claim.deltaPct.toFixed(1)}%
          </span>
        )}
        {claim.nDocs !== null && (
          <span className="text-ink-faint">n={claim.nPoints}, {claim.nDocs} papers</span>
        )}
      </div>

      {claim.note && (
        <p className={`mt-1.5 text-[0.76rem] leading-relaxed ${tone.text}`}>
          {claim.note}
        </p>
      )}
    </li>
  );
}
