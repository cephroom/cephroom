"use client";

import { useEffect, useState } from "react";

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

interface Proposal {
  id: string;
  title: string;
  rationale: string;
  fromSub: string;
  status: "open" | "merged" | "closed";
  createdAt: string;
}

const STATUS_TONE = {
  open: "border-accent/40 bg-accent-wash text-accent",
  merged: "border-verified/30 bg-verified-wash text-verified",
  closed: "border-rule bg-paper-sunken text-ink-muted",
} as const;

export function NodeProposalList({
  columnId,
  address,
  nodeKey,
}: {
  columnId: string;
  address: string;
  nodeKey: string | null;
}) {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetchWithTimeout(
          `${address}/proposals?column=${encodeURIComponent(columnId)}`,
          nodeKey ? { headers: { authorization: `Bearer ${nodeKey}` } } : undefined,
        );
        if (!response.ok) throw new Error(`node returned ${response.status}`);
        const json = (await response.json()) as { proposals: Proposal[] };
        if (!cancelled) setProposals(json.proposals);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "unreachable");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, columnId, nodeKey]);

  if (error) {
    return (
      <p className="mt-8 text-[0.9rem] text-ink-muted">
        The node stopped answering — {error}
      </p>
    );
  }

  if (!proposals) {
    return <p className="mt-8 text-[0.9rem] text-ink-muted">Fetching…</p>;
  }

  if (proposals.length === 0) {
    return (
      <p className="mt-8 rounded-xl border border-rule px-4 py-10 text-center text-[0.9rem] text-ink-muted">
        Nothing proposed yet.
      </p>
    );
  }

  return (
    <ul className="mt-3">
      {proposals.map((proposal) => (
        <li key={proposal.id} className="border-b border-rule py-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className={`rounded-full border px-2 py-0.5 text-[0.7rem] font-medium capitalize ${STATUS_TONE[proposal.status]}`}
            >
              {proposal.status}
            </span>
            <span className="font-serif text-[1.08rem] font-semibold">
              {proposal.title}
            </span>
          </div>
          {proposal.rationale && (
            <p className="mt-2 max-w-[60ch] text-[0.89rem] leading-relaxed text-ink-muted">
              {proposal.rationale}
            </p>
          )}
          <p className="mt-1.5 text-[0.78rem] text-ink-faint">
            <span className="font-mono text-[0.78rem]">{proposal.fromSub}</span>{" "}
            ·{" "}
            {new Date(proposal.createdAt).toLocaleString("en-GB", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </li>
      ))}
    </ul>
  );
}
