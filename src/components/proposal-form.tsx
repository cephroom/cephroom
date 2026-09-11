"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { DiffView } from "@/components/diff-view";
import type { CollabState } from "@/lib/collab/actions";
import { diffLines, diffStats, toHunks } from "@/lib/diff";

export function ProposalForm({
  columnId,
  body,
  action,
}: {
  columnId: string;
  body: string;
  action: (state: CollabState, formData: FormData) => Promise<CollabState>;
}) {
  const [draft, setDraft] = useState(body);
  const [showDiff, setShowDiff] = useState(false);
  const [state, submit] = useActionState<CollabState, FormData>(action, {});

  const { hunks, stats } = useMemo(() => {
    const lines = diffLines(body, draft);
    return { hunks: toHunks(lines), stats: diffStats(lines) };
  }, [body, draft]);

  const changed = stats.added > 0 || stats.removed > 0;

  return (
    <form action={submit} className="mt-6 space-y-4">
      <input type="hidden" name="columnId" value={columnId} />

      <label className="block">
        <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-muted">
          What is this proposal
        </span>
        <input
          name="title"
          required
          placeholder="Correct the olanzapine 5-HT2A value"
          className={INPUT}
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-muted">
          Why
        </span>
        <textarea
          name="rationale"
          rows={3}
          placeholder="What is wrong, and what should convince the author you are right."
          className={INPUT}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-4">
        <div className="flex rounded-lg border border-rule bg-paper-raised p-1">
          <Tab active={!showDiff} onClick={() => setShowDiff(false)}>
            Edit
          </Tab>
          <Tab active={showDiff} onClick={() => setShowDiff(true)}>
            Diff
          </Tab>
        </div>

        <span className="text-[0.8rem] tnum">
          {changed ? (
            <>
              <span className="text-verified">+{stats.added}</span>{" "}
              <span className="text-broken">−{stats.removed}</span>
            </>
          ) : (
            <span className="text-ink-faint">no changes yet</span>
          )}
        </span>
      </div>

      <div hidden={showDiff}>
        <textarea
          name="body"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={28}
          spellCheck
          className={`${INPUT} resize-y font-mono text-[0.82rem] leading-relaxed`}
        />
      </div>

      {showDiff && (
        <div>
          {hunks.length === 0 ? (
            <p className="rounded-xl border border-rule px-4 py-8 text-center text-[0.88rem] text-ink-muted">
              Nothing has changed yet.
            </p>
          ) : (
            <DiffView hunks={hunks} />
          )}
        </div>
      )}

      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-broken/30 bg-broken-wash px-3 py-2 text-[0.83rem] text-broken"
        >
          {state.error}
        </p>
      )}

      <Submit disabled={!changed} />
    </form>
  );
}

const INPUT =
  "w-full rounded-md border border-rule-strong bg-paper-raised px-3 py-2 text-[0.9rem] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent";

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-3.5 py-1 text-[0.83rem] font-medium transition-colors ${
        active ? "bg-accent text-white" : "text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="rounded-md bg-accent px-5 py-2.5 text-[0.9rem] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
    >
      {pending ? "Submitting…" : "Open the proposal"}
    </button>
  );
}
