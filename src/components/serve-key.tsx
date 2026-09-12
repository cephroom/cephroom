"use client";

import { useState } from "react";

export function ServeKey({ sub }: { sub: string }) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; key: string; days: number }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  async function reveal() {
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/auth/node-key", { method: "POST" });
      const json = (await response.json()) as {
        key?: string;
        expiresInDays?: number;
        error?: string;
      };
      if (!response.ok || !json.key) {
        throw new Error(json.error ?? "Could not issue a key.");
      }
      setState({ kind: "ready", key: json.key, days: json.expiresInDays ?? 30 });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed.",
      });
    }
  }

  async function copy(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
    }
  }

  return (
    <div className="mt-4">
      <p className="text-[0.8rem] leading-relaxed text-ink-muted">
        Your subject is{" "}
        <code className="font-mono text-[0.76rem] text-ink">{sub}</code>. To
        serve under it, reveal a key and set it as{" "}
        <code className="font-mono text-[0.76rem]">NODE_KEY</code>{" "}
        in your node&rsquo;s environment.
      </p>

      {state.kind !== "ready" && (
        <button
          type="button"
          onClick={reveal}
          disabled={state.kind === "loading"}
          className="mt-3 rounded-md border border-field-border px-4 py-2 text-[0.85rem] font-medium transition-colors hover:border-ink-faint disabled:opacity-60"
        >
          {state.kind === "loading" ? "Issuing…" : "Reveal a serve key"}
        </button>
      )}

      {state.kind === "error" && (
        <p role="alert" className="mt-2 text-[0.8rem] text-broken">
          {state.message}
        </p>
      )}

      {state.kind === "ready" && (
        <div className="mt-3">
          <div className="flex items-start gap-2">
            <code className="block flex-1 overflow-x-auto rounded-md border border-rule bg-paper-sunken p-2.5 font-mono text-[0.72rem] leading-relaxed break-all">
              {state.key}
            </code>
            <button
              type="button"
              onClick={() => copy(state.key)}
              className="shrink-0 rounded-md border border-field-border px-3 py-2 text-[0.8rem] font-medium transition-colors hover:border-ink-faint"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-2 text-[0.76rem] leading-relaxed text-ink-faint">
            Valid for {state.days} days. It cannot be revoked, only outlived —
            treat it like a password, and reveal a fresh one if it leaks. It
            grants only the ability to announce under your subject; it does not
            read anyone&rsquo;s data or touch billing.
          </p>
        </div>
      )}
    </div>
  );
}
