"use client";

import { useState } from "react";

import {
  bibtexCitation,
  plainCitation,
  type Citation,
} from "@/lib/cite";

/**
 * "Cite this reading" - contract 2, built entirely in the browser.
 *
 * Every research tool a contributor already trusts offers a citation
 * (Zenodo, protocols.io), and a researcher who reads a column and cannot
 * reference it will not use it in their work. The gap this fills is the one the
 * link-rot and content-drift literature names directly: a citation to a live
 * dataset should date the check, and a Cephroom citation can, because it is the
 * only kind that carries what was verified at read time.
 *
 * Nothing here reaches the platform. The citation is assembled from what the
 * reader already fetched and checked, and copying it is a browser API. A
 * server-side "cite" endpoint would be a record of who read what, which is the
 * thing contract 2 forbids - so this is a client component with no fetch.
 */
export function CiteReading({ citation }: { citation: Citation }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<"plain" | "bibtex">("plain");
  const [copied, setCopied] = useState(false);

  const text =
    format === "plain" ? plainCitation(citation) : bibtexCitation(citation);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // A denied clipboard is not an error worth a banner: the text is on the
      // page, selectable, and the reader can copy it by hand.
    }
  }

  return (
    <section className="mt-10 rounded-xl border border-rule bg-paper-raised p-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="font-serif text-[1.05rem] font-semibold">
          Cite this reading
        </span>
        <span className="text-[0.8rem] text-ink-faint" aria-hidden>
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {open && (
        <div className="mt-4">
          <p className="max-w-[58ch] text-[0.82rem] leading-relaxed text-ink-muted">
            This records what you saw and when you saw it — including which
            claims checked out against which dataset release. It is not a
            permanent link: this work is served only while its author is online,
            so cite it as a reading, not as an archive.
          </p>

          <div
            className="mt-4 inline-flex rounded-md border border-field-border p-0.5 text-[0.8rem]"
            role="tablist"
            aria-label="Citation format"
          >
            {(["plain", "bibtex"] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={format === f}
                onClick={() => setFormat(f)}
                className={`rounded px-3 py-1 font-medium transition-colors ${
                  format === f
                    ? "bg-accent text-accent-ink"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {f === "plain" ? "Plain" : "BibTeX"}
              </button>
            ))}
          </div>

          <pre className="scroll-x mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg border border-rule bg-paper-sunken p-3 font-mono text-[0.76rem] leading-relaxed text-ink-muted">
            {text}
          </pre>

          <button
            type="button"
            onClick={copy}
            className="mt-3 rounded-md bg-accent px-4 py-2 text-[0.84rem] font-medium text-accent-ink transition-colors hover:bg-accent-hover"
          >
            {copied ? "Copied" : "Copy citation"}
          </button>
        </div>
      )}
    </section>
  );
}
