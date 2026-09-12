"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  clearWallet,
  stockUp,
  walletHealth,
  type WalletHealth,
} from "@/lib/tokens/wallet";

export function TokenWallet({ issuing }: { issuing: boolean }) {
  const [health, setHealth] = useState<WalletHealth | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    walletHealth().then((next) => {
      if (live) setHealth(next);
    });
    return () => {
      live = false;
    };
  }, []);

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
        {health === null
          ? "Checking this browser…"
          : health.holding === 0
            ? "This browser is holding no tokens, so your searches are reaching us with your ordinary key — which means we could, in principle, put a month of them next to your name."
            : health.stale
              ? null
              : `This browser is holding ${health.usable} token${health.usable === 1 ? "" : "s"}. Each one spends a search at the reach your plan bought, carrying no identity at all.`}
      </p>

      {health?.stale && (
        <div
          role="status"
          className="mt-2 rounded-lg border border-broken/40 bg-broken-wash p-4"
        >
          <p className="text-[0.88rem] font-medium text-broken">
            The {health.holding} token{health.holding === 1 ? "" : "s"} this
            browser is holding cannot be spent.
          </p>
          <p className="mt-2 text-[0.85rem] leading-relaxed text-ink-muted">
            They were signed by an issuer key that is no longer published. The
            signing keys live in memory and rotate hourly, so a restart here
            retires them — we cannot keep them without storing something, and we
            would rather tell you than let your searches quietly go back to
            arriving with your subscription attached. Until you take a fresh
            batch, that is what is happening.
          </p>
        </div>
      )}

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
            if (result.ok) setHealth(await walletHealth());
            else setError(result.error);
            setBusy(false);
          }}
          className="rounded-md bg-accent px-4 py-2 text-[0.86rem] font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {busy
            ? "Getting tokens…"
            : health?.stale
              ? "Get a fresh batch"
              : "Get anonymous search tokens"}
        </button>

        {health !== null && health.holding > 0 && (
          <button
            type="button"
            onClick={() => {
              clearWallet();
              setHealth({ holding: 0, usable: 0, stale: false });
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
