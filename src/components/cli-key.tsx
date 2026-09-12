"use client";

import { useState } from "react";

/**
 * Getting a credential onto a machine that has no browser.
 *
 * Found by walking the consumer role against the CLI: the first version told
 * people to open a devtools console and paste a `fetch` call. That works and
 * is obviously wrong — the rule is that anything only the API can do is a UI
 * defect, and "get the credential the API needs" was exactly that.
 *
 * What it hands over is a renewal key, not an API key. The difference is not
 * cosmetic: an API key is a stable identifier the issuer stores so it can
 * check it, and Contract 1 forbids the storing. This is a signed statement the
 * holder carries, verified by signature, written down nowhere, and expiring on
 * its own in seven days.
 */
export function CliKey() {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; key: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [copied, setCopied] = useState<string | null>(null);

  async function reveal() {
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/auth/cli-key", { method: "POST" });
      if (!response.ok) throw new Error("Could not issue a key.");
      const body = (await response.json()) as { key: string };
      setState({ kind: "ready", key: body.key });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "Something went wrong.",
      });
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard denied. The value is on screen and selectable.
    }
  }

  const command =
    state.kind === "ready"
      ? `npx tsx scripts/cephroom.ts login ${state.key}`
      : "";

  return (
    <div className="mt-4">
      <p className="text-[0.8rem] leading-relaxed text-ink-muted">
        There are no API keys here — an API key is a stable identifier issued to
        a person, which is the thing this platform will not hold. A renewal key
        does the same job without being one: it renews your access for seven
        days, it is checked by its signature, and no record of it exists.
      </p>

      {state.kind !== "ready" && (
        <button
          type="button"
          onClick={reveal}
          disabled={state.kind === "loading"}
          className="mt-3 rounded-md border border-field-border px-4 py-2 text-[0.85rem] font-medium transition-colors hover:border-ink-faint disabled:opacity-60"
        >
          {state.kind === "loading" ? "Issuing…" : "Reveal a key for the CLI"}
        </button>
      )}

      {state.kind === "error" && (
        <p role="alert" className="mt-2 text-[0.8rem] text-broken">
          {state.message}
        </p>
      )}

      {state.kind === "ready" && (
        <div className="mt-3">
          <p className="mb-1.5 text-[0.76rem] font-medium text-ink-muted">
            Run this on the machine you want to work from:
          </p>
          <div className="flex items-start gap-2">
            <code className="block flex-1 overflow-x-auto rounded-md border border-rule bg-paper-sunken p-2.5 font-mono text-[0.72rem] leading-relaxed break-all">
              {command}
            </code>
            <button
              type="button"
              onClick={() => copy(command, "command")}
              className="shrink-0 rounded-md border border-field-border px-3 py-2 text-[0.8rem] font-medium transition-colors hover:border-ink-faint"
            >
              {copied === "command" ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-2 text-[0.76rem] leading-relaxed text-ink-faint">
            Seven days, and it cannot be revoked — there is no blocklist,
            because a blocklist is state. Treat it like a password you are
            unable to change. It is freshly minted rather than the one in this
            browser, so a script and a browser never share one credential.
          </p>
        </div>
      )}
    </div>
  );
}
