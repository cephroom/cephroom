"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { clearWallet, stockUp, walletCount } from "@/lib/tokens/wallet";

/**
 * `issuing` is whether the viewer's discovery plan issues tokens at all. The
 * free plan does not, because a consumer with no subscription has nothing for
 * their searching to be linked to — there is no protection to sell them.
 */
export function TokenWallet({ issuing }: { issuing: boolean }) {
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read on mount rather than during render: localStorage does not exist on
  // the server, and reading it in render would produce a hydration mismatch.
  useEffect(() => setCount(walletCount()), []);

  if (!issuing) {
    return (
      <p className="text-[0.88rem] leading-relaxed text-ink-muted">
        Nothing to hide yet: your searches reach us with no subscription behind
        them, so there is nothing for them to be linked to. Tokens come with a
        paid discovery plan, which is also the point at which they start
        mattering.{" "}
        <Link href="/pricing" className="font-medium text-accent hover:underline">
          See plans
        </Link>
        .
      </p>
    );
  }

  return (
    <div>
      <p className="text-[0.88rem] leading-relaxed text-ink-muted">
        {count === null
          ? "Checking this browser…"
          : count === 0
            ? "This browser is holding no tokens, so your searches are reaching us with your ordinary key — which means we could, in principle, put a month of them next to your name."
            : `This browser is holding ${count} token${count === 1 ? "" : "s"}. Each one spends a search at the reach your plan bought, carrying no identity at all.`}
      </p>

      {error && (
        <p role="status" className="mt-2 text-[0.83rem] text-broken">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const result = await stockUp();
            if (result.ok) setCount(walletCount());
            else setError(result.error);
            setBusy(false);
          }}
          className="rounded-md bg-accent px-4 py-2 text-[0.86rem] font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {busy ? "Getting tokens…" : "Get anonymous search tokens"}
        </button>

        {count !== null && count > 0 && (
          <button
            type="button"
            onClick={() => {
              clearWallet();
              setCount(0);
            }}
            className="rounded-md border border-field-border px-4 py-2 text-[0.84rem] font-medium transition-colors hover:border-ink-faint"
          >
            Throw them away
          </button>
        )}
      </div>

      <p className="mt-4 text-[0.8rem] leading-relaxed text-ink-faint">
        Getting tokens is the one moment we know it is you asking — we check
        your subscription, then sign twelve values we cannot see. Spending one
        later carries no cookie and we cannot tell which batch it came from, so
        a run of queries cannot be read back as one person&rsquo;s programme of
        work.
        What this does <em>not</em>{" "}
        hide is covered on{" "}
        <Link href="/privacy" className="text-accent hover:underline">
          the privacy page
        </Link>
        , and the limits are real.
      </p>
    </div>
  );
}
