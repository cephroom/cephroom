"use client";

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export interface ClaimView {
  key: string;
  /** The value as it stands in the dataset right now. */
  display: string;
  verdict: "verified" | "drifted" | "broken";
  authored: string;
  observed: string;
  deltaPct: number | null;
  tolerance: string;
  note: string | null;
  query: {
    dataset: string;
    datasetSlug: string;
    /** The pseudonymous subject serving the dataset, for the explorer link. */
    owner: string;
    metric: string;
    subject: string;
    object: string;
    scope: string;
    select: string;
  };
  release: string | null;
  checkedAt: string | null;
  nPoints: number | null;
  nDocs: number | null;
}

/** A plain-language gloss of what the claim's `select` actually asserts. */
function describeSelect(select: string): string {
  switch (select) {
    case "n_points":
      return "This claim asserts the number of measurements behind the cell, not a value.";
    case "n_docs":
      return "This claim asserts how many independent papers report the cell.";
    case "fold_spread":
      return "This claim asserts the full fold spread — the loosest measurement over the tightest. It is a claim about how far the labs disagree, not about the median.";
    case "fold_spread_iqr":
      return "This claim asserts the interquartile fold spread — disagreement across the middle half of measurements, ignoring outliers. It is a claim about how well the labs agree.";
    default:
      return "This claim asserts the cell's value against the author's recorded number.";
  }
}

const TONE = {
  verified: {
    dot: "bg-verified",
    text: "text-verified",
    wash: "bg-verified-wash",
    label: "Verified",
  },
  drifted: {
    dot: "bg-drifted",
    text: "text-drifted",
    wash: "bg-drifted-wash",
    label: "Drifted",
  },
  broken: {
    dot: "bg-broken",
    text: "text-broken",
    wash: "bg-broken-wash",
    label: "Broken",
  },
} as const;

export function ClaimChip({
  claim,
  canInspect,
}: {
  claim: ClaimView | undefined;
  canInspect: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const panelId = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLSpanElement>(null);

  // A chip near the right margin would push its panel off-screen and create
  // horizontal page scroll. Measure once on open and slide it back into view.
  useLayoutEffect(() => {
    if (!open) {
      setShift(0);
      return;
    }
    const panel = panelRef.current;
    if (!panel) return;

    const margin = 12;
    const rect = panel.getBoundingClientRect();
    const overflowRight = rect.right - (window.innerWidth - margin);
    const next = overflowRight > 0 ? -Math.min(overflowRight, rect.left - margin) : 0;
    setShift(next);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!claim) {
    return (
      <span className="font-mono text-[0.9em] text-broken" title="Undefined claim">
        [unresolved claim]
      </span>
    );
  }

  const tone = TONE[claim.verdict];

  return (
    <span ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-baseline gap-1 rounded px-1 py-px font-mono text-[0.88em] tnum ${tone.text} ${tone.wash} decoration-dotted underline-offset-[3px] transition-opacity hover:opacity-80`}
        title={`${tone.label} — click for provenance`}
      >
        <span
          aria-hidden
          className={`inline-block h-[5px] w-[5px] shrink-0 translate-y-[-2px] rounded-full ${tone.dot}`}
        />
        {claim.display}
      </button>

      <span
        ref={panelRef}
        id={panelId}
        hidden={!open}
        role="dialog"
        aria-label={`Provenance for ${claim.key}`}
        style={{ transform: shift ? `translateX(${shift}px)` : undefined }}
        className="absolute left-0 top-[calc(100%+6px)] z-30 block w-[min(21rem,calc(100vw-1.5rem))] rounded-lg border border-rule bg-paper-raised p-3.5 text-left font-sans text-[0.8rem] leading-normal text-ink shadow-lg"
      >
        <span className="mb-2.5 flex items-center justify-between gap-2">
          <span className={`flex items-center gap-1.5 font-medium ${tone.text}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
            {tone.label}
          </span>
          <code className="text-[0.72rem] text-ink-faint">{claim.key}</code>
        </span>

        {canInspect ? (
          <>
            <span className="mb-2.5 block rounded-md border border-rule bg-paper-sunken p-2 font-mono text-[0.72rem] leading-relaxed text-ink-muted">
              {claim.query.metric}({claim.query.subject} ×{" "}
              {claim.query.object})
              <br />
              scope: {claim.query.scope} · select: {claim.query.select}
            </span>

            <span className="mb-2.5 block text-[0.75rem] text-ink-muted">
              {describeSelect(claim.query.select)}
            </span>

            <span className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <Row label="Authored" value={claim.authored} />
              <Row label="Dataset now" value={claim.observed} />
              {claim.deltaPct !== null && (
                <Row
                  label="Drift"
                  value={`${claim.deltaPct > 0 ? "+" : ""}${claim.deltaPct.toFixed(1)}% (tolerance ${claim.tolerance})`}
                />
              )}
              {claim.nPoints !== null && (
                <Row
                  label="Evidence"
                  value={`${claim.nPoints} measurements · ${claim.nDocs ?? "?"} papers`}
                />
              )}
              {claim.release && <Row label="Release" value={claim.release} />}
              {claim.checkedAt && (
                <Row label="Last check" value={claim.checkedAt} />
              )}
            </span>

            {claim.note && (
              <span className="mt-2.5 block rounded-md border border-rule px-2 py-1.5 text-[0.75rem] text-ink-muted">
                {claim.note}
              </span>
            )}

            <Link
              href={`/read/${encodeURIComponent(claim.query.owner)}/${encodeURIComponent(claim.query.datasetSlug)}?subject=${encodeURIComponent(claim.query.subject)}&object=${encodeURIComponent(claim.query.object)}`}
              className="mt-3 inline-block text-[0.78rem] font-medium text-accent hover:underline"
            >
              Open in dataset explorer →
            </Link>
          </>
        ) : (
          <>
            <span className="block text-ink-muted">
              The claim inspector shows the query behind this number, the
              measurement count supporting it, and its drift since publication.
            </span>
            <Link
              href="/pricing"
              className="mt-2.5 inline-block text-[0.78rem] font-medium text-accent hover:underline"
            >
              Included with Member →
            </Link>
          </>
        )}
      </span>
    </span>
  );
}

// Chips render inside paragraphs, so the panel is built from phrasing
// elements only. A <dl> here would close the surrounding <p> during parsing
// and produce a hydration mismatch.
function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-ink-faint">{label}</span>
      <span className="tnum text-ink">{value}</span>
    </>
  );
}
