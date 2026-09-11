"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";
import type { CollabState } from "@/lib/collab/actions";

export function ProposalDecision({
  proposalId,
  mergeAction,
  closeAction,
}: {
  proposalId: string;
  mergeAction: (state: CollabState, formData: FormData) => Promise<CollabState>;
  closeAction: (state: CollabState, formData: FormData) => Promise<CollabState>;
}) {
  const [mergeState, merge] = useActionState<CollabState, FormData>(
    mergeAction,
    {},
  );
  const [closeState, close] = useActionState<CollabState, FormData>(
    closeAction,
    {},
  );
  const state = mergeState.error || mergeState.message ? mergeState : closeState;

  return (
    <section className="mt-8 rounded-xl border border-rule bg-paper-raised p-5">
      <h2 className="font-serif text-[1.15rem] font-semibold">Your call</h2>
      <p className="mt-1.5 max-w-[58ch] text-[0.87rem] leading-relaxed text-ink-muted">
        Merging replaces the column text, writes a revision crediting the
        proposer, and re-runs the checks. If a claim comes back broken the
        merge is rolled back rather than published.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <form action={merge}>
          <input type="hidden" name="proposalId" value={proposalId} />
          <SubmitButton
            label="Merge and re-run checks"
            pendingLabel="Merging…"
            variant="primary"
          />
        </form>

        <form action={close}>
          <input type="hidden" name="proposalId" value={proposalId} />
          <SubmitButton
            label="Close without merging"
            pendingLabel="Closing…"
            variant="outline"
          />
        </form>
      </div>

      {state.error && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-broken/30 bg-broken-wash px-3 py-2 text-[0.84rem] text-broken"
        >
          {state.error}
        </p>
      )}
      {state.message && (
        <p
          role="status"
          className="mt-4 rounded-md border border-verified/30 bg-verified-wash px-3 py-2 text-[0.84rem] text-verified"
        >
          {state.message}
        </p>
      )}
    </section>
  );
}
