"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { DiffView } from "@/components/diff-view";
import { diffLines, diffStats, toHunks } from "@/lib/diff";

/**
 * Proposing an edit, posted straight to the author's node.
 *
 * The whole exchange is browser-to-node: the current text is fetched from
 * them, the diff is computed here, and the proposal is posted back to them.
 * Under Contract 2 the platform cannot be a party to this — it would mean
 * holding someone's draft.
 */
export function NodeProposalForm({
  columnId,
  address,
  nodeKey,
  fromName,
  canPropose,
}: {
  columnId: string;
  address: string;
  nodeKey: string;
  fromName: string;
  canPropose: boolean;
}) {
  const [original, setOriginal] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [title, setTitle] = useState("");
  const [rationale, setRationale] = useState("");
  const [showDiff, setShowDiff] = useState(false);
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "sending" } | { kind: "error"; message: string } | { kind: "sent"; id: string }
  >({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `${address}/column/${encodeURIComponent(columnId)}`,
          { headers: { authorization: `Bearer ${nodeKey}` } },
        );
        if (!response.ok) throw new Error(`node returned ${response.status}`);
        const column = (await response.json()) as {
          source: string | null;
          entitled: boolean;
        };
        if (cancelled) return;
        if (!column.entitled) {
          setState({
            kind: "error",
            message:
              "You can only propose edits to a column you can read in full.",
          });
          return;
        }
        setOriginal(column.source ?? "");
        setDraft(column.source ?? "");
      } catch (error) {
        if (!cancelled) {
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : "unreachable",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, columnId, nodeKey]);

  const { hunks, stats } = useMemo(() => {
    const lines = diffLines(original ?? "", draft);
    return { hunks: toHunks(lines), stats: diffStats(lines) };
  }, [original, draft]);

  const changed = stats.added > 0 || stats.removed > 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState({ kind: "sending" });
    try {
      const response = await fetch(`${address}/proposals`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${nodeKey}`,
        },
        body: JSON.stringify({ columnId, title, rationale, body: draft, fromName }),
      });
      const json = (await response.json()) as { id?: string; error?: string };
      if (!response.ok) throw new Error(json.error ?? `node returned ${response.status}`);
      setState({ kind: "sent", id: json.id! });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "could not send",
      });
    }
  }

  if (!canPropose) {
    return (
      <div className="mt-8 rounded-xl border border-rule bg-paper-raised p-6">
        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-accent">
          Member feature
        </p>
        <h2 className="mt-2 font-serif text-[1.3rem] font-semibold">
          Proposing needs a key with write:propose
        </h2>
        <p className="mt-2 max-w-[54ch] text-[0.92rem] leading-relaxed text-ink-muted">
          The author&rsquo;s node checks the scope on your key before it accepts
          anything — we are not in that decision, so we could not grant it for
          you even if we wanted to.
        </p>
        <Link
          href="/pricing"
          className="mt-5 inline-block rounded-md bg-accent px-5 py-2.5 text-[0.88rem] font-medium text-white transition-colors hover:bg-accent-hover"
        >
          See plans
        </Link>
      </div>
    );
  }

  if (state.kind === "sent") {
    return (
      <div className="mt-8 rounded-xl border border-verified/30 bg-verified-wash p-6">
        <h2 className="font-serif text-[1.3rem] font-semibold text-verified">
          Sent to the author&rsquo;s machine
        </h2>
        <p className="mt-2 max-w-[54ch] text-[0.92rem] leading-relaxed text-ink-muted">
          It is stored next to the column on their disk. Nothing about it
          reached us, so if you want to follow it you will find it on their
          node while they are serving.
        </p>
        <p className="mt-2 font-mono text-[0.76rem] text-ink-faint">{state.id}</p>
        <Link
          href={`/read/${columnId}/proposals`}
          className="mt-5 inline-block rounded-md border border-rule-strong px-4 py-2 text-[0.88rem] font-medium transition-colors hover:border-ink-faint"
        >
          See proposals on this column
        </Link>
      </div>
    );
  }

  if (original === null) {
    return (
      <p className="mt-8 text-[0.9rem] text-ink-muted">
        {state.kind === "error" ? state.message : "Fetching the current text…"}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-muted">
          What is this proposal
        </span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
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
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
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

      <p className="text-[0.82rem] leading-relaxed text-ink-muted">
        You are editing the Markdown source, claim blocks included. The
        author&rsquo;s node re-parses it and refuses anything whose claims do
        not resolve, so a broken number cannot arrive as a proposal.
      </p>

      <div hidden={showDiff}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={26}
          spellCheck
          className={`${INPUT} resize-y font-mono text-[0.82rem] leading-relaxed`}
        />
      </div>

      {showDiff &&
        (hunks.length === 0 ? (
          <p className="rounded-xl border border-rule px-4 py-8 text-center text-[0.88rem] text-ink-muted">
            Nothing has changed yet.
          </p>
        ) : (
          <DiffView hunks={hunks} />
        ))}

      {state.kind === "error" && (
        <p
          role="alert"
          className="rounded-md border border-broken/30 bg-broken-wash px-3 py-2 text-[0.83rem] text-broken"
        >
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={!changed || state.kind === "sending"}
        className="rounded-md bg-accent px-5 py-2.5 text-[0.9rem] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        {state.kind === "sending" ? "Sending…" : "Send to the author"}
      </button>
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
