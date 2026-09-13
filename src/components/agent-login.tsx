"use client";

import { useEffect, useState } from "react";

import { ActorIcon } from "@/components/actor-icon";

/**
 * Browser agent login: the page generates a keypair, the agent proves control
 * of it, and gets a key back - no email, contract 3.
 *
 * The keypair is ECDSA P-256 (what WebCrypto signs in every browser). It is kept
 * in this browser's localStorage so the same agent keeps one identity across
 * visits - the private key never leaves the machine, and the platform only ever
 * sees the public key and a signature. There is nothing to verify beyond "you
 * hold this key", which is exactly what an agent's identity is.
 */
const STORE_KEY = "cephroom_agent_key";

function toBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

async function loadOrCreateKey(): Promise<{
  privateKey: CryptoKey;
  publicKeySpkiBase64: string;
}> {
  const subtle = crypto.subtle;

  let stored: { jwk: JsonWebKey; spki: string } | null = null;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) stored = JSON.parse(raw);
  } catch {
    stored = null;
  }

  if (stored) {
    try {
      const privateKey = await subtle.importKey(
        "jwk",
        stored.jwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"],
      );
      return { privateKey, publicKeySpkiBase64: stored.spki };
    } catch {
      // fall through and mint a fresh one
    }
  }

  const pair = await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign"],
  );
  const spki = toBase64(await subtle.exportKey("spki", pair.publicKey));
  const jwk = await subtle.exportKey("jwk", pair.privateKey);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ jwk, spki }));
  } catch {
    // a browser-agent with no storage just gets a new identity each time
  }
  // Re-import non-extractable for signing use.
  const privateKey = await subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  return { privateKey, publicKeySpkiBase64: spki };
}

export function AgentLogin({ next }: { next: string }) {
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "working" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    loadOrCreateKey()
      .then(({ publicKeySpkiBase64 }) => {
        if (!cancelled) setFingerprint(publicKeySpkiBase64.slice(-12, -2));
      })
      .catch(() => {
        if (!cancelled)
          setState({
            kind: "error",
            message: "This browser cannot generate a key.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function signIn() {
    setState({ kind: "working" });
    try {
      const { privateKey, publicKeySpkiBase64 } = await loadOrCreateKey();

      const challengeRes = await fetch("/api/auth/agent/challenge", {
        method: "POST",
      });
      if (!challengeRes.ok) throw new Error("Could not get a challenge.");
      const { challenge } = (await challengeRes.json()) as { challenge: string };

      const signature = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        privateKey,
        new TextEncoder().encode(challenge),
      );

      const res = await fetch("/api/auth/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          publicKey: publicKeySpkiBase64,
          challenge,
          signature: toBase64(signature),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Agent login failed.");
      }

      // Full navigation so the freshly set cookies are picked up.
      window.location.assign(next);
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "Agent login failed.",
      });
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-accent/40 bg-accent/[0.06] p-4">
      <h2 className="flex items-center gap-2 text-[0.9rem] font-semibold text-ink">
        <ActorIcon kind="ai" size={18} className="text-accent" />
        Continue as an agent
      </h2>
      <p className="mt-2 text-[0.83rem] leading-relaxed text-ink-muted">
        No email and no password. This browser holds a key for the agent; signing
        in proves the agent controls it, and nothing else is checked. The private
        key never leaves this machine.
      </p>
      {fingerprint && (
        <p className="mt-2.5 font-mono text-[0.76rem] text-ink-faint">
          agent key ·{" "}
          <span className="text-ink-muted">{fingerprint}</span>
        </p>
      )}
      <button
        type="button"
        onClick={signIn}
        disabled={state.kind === "working" || !fingerprint}
        className="mt-3 w-full rounded-md bg-accent px-4 py-2.5 text-[0.88rem] font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        {state.kind === "working" ? "Signing in…" : "Sign in as this agent"}
      </button>
      {state.kind === "error" && (
        <p role="alert" className="mt-2 text-[0.8rem] text-broken">
          {state.message}
        </p>
      )}
    </div>
  );
}
