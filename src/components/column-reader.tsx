"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { CheckBadge } from "@/components/check-badge";
import { ClaimChip, type ClaimView } from "@/components/claim-chip";
import { Paywall } from "@/components/paywall";
import type { Access, Tier } from "@/lib/access";
import { type ParsedClaim } from "@/lib/claims/syntax";
import {
  resolveClaims,
  type Dataset,
  type ResolvedClaim,
} from "@/lib/claims/resolve";
import { type Conclusion } from "@/lib/claims/verdict";
import { remarkClaims } from "@/lib/markdown/remark-claims";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { servingMismatch } from "@/lib/signaling/serving";
import { spendToken } from "@/lib/tokens/wallet";


interface ServedColumn {
  /** Who this machine says it is. Checked against the contributor asked for. */
  servedBySub?: string;
  id: string;
  title: string;
  subtitle: string;
  access: Access;
  repo: string | null;
  commit: string | null;
  author: string;
  entitled: boolean;
  prose: string;
  hiddenBlocks: number;
  claims: ParsedClaim[];
  withheldClaims?: string[];
  withheldClaimCount?: number;
  servedAt: string;
}

type Phase =
  | { state: "loading" }
  | { state: "offline"; reason: string }
  // Kept separate from `offline` on purpose. A node that answered promptly
  // and truthfully, and simply is not the contributor the registry named, has
  // not "stopped answering" — and saying so would put a wrong explanation
  // above a right one.
  | { state: "impostor"; detail: string }
  | { state: "ready"; column: ServedColumn; datasets: Map<string, Dataset> };

export function ColumnReader({
  sub,
  id,
  address,
  servedBy,
  payTo,
  nodeKey,
  tier,
  signedIn,
}: {
  sub: string;
  id: string;
  address: string;
  servedBy: string;
  payTo: string | null;
  nodeKey: string | null;
  tier: Tier;
  signedIn: boolean;
}) {
  const [phase, setPhase] = useState<Phase>({ state: "loading" });
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [anonymous, setAnonymous] = useState(false);
  const base = `/read/${encodeURIComponent(sub)}/${encodeURIComponent(id)}`;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const spent = await spendToken();
        if (cancelled) return;
        const presentedKey = spent?.key ?? nodeKey;
        setAnonymous(Boolean(spent));

        const response = await fetchWithTimeout(`${address}/column/${encodeURIComponent(id)}`, {
          headers: presentedKey ? { authorization: `Bearer ${presentedKey}` } : {},
        });
        if (!response.ok) throw new Error(`node returned ${response.status}`);
        const column = (await response.json()) as ServedColumn;

        // Before anything is rendered, and before any further request to this
        // machine: is it the contributor the registry said it was? An address
        // in the registry is a string somebody announced, and one contributor
        // can announce another's node.
        const impostor = servingMismatch(sub, column.servedBySub);
        if (impostor) {
          if (!cancelled) setPhase({ state: "impostor", detail: impostor });
          return;
        }

        const needed = [...new Set(column.claims.map((claim) => claim.datasetSlug))];
        const datasets = new Map<string, Dataset>();
        for (const slug of needed) {
          const data = await fetchWithTimeout(
            `${address}/dataset/${encodeURIComponent(slug)}`,
          ).catch(() => null);
          if (data?.ok) datasets.set(slug, (await data.json()) as Dataset);
        }

        if (cancelled) return;
        setPhase({ state: "ready", column, datasets });
        // Pinned locale: a bare toLocaleTimeString renders in the browser's
        // system locale, which showed Chinese AM/PM markers in an English UI.
        setCheckedAt(
          new Date().toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        );
      } catch (error) {
        if (cancelled) return;
        setPhase({
          state: "offline",
          reason: error instanceof Error ? error.message : "unreachable",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // `sub` included: it is what the fetched content is checked against,
  // so a stale one would verify against the wrong contributor.
  }, [address, id, nodeKey, sub]);

  const resolved = useMemo(() => {
    if (phase.state !== "ready") return null;
    return resolveClaims(phase.column.claims, phase.datasets, sub);
  }, [phase, sub]);

  if (phase.state === "loading") {
    return (
      <main className="mx-auto max-w-[46rem] px-5 py-20">
        <p className="text-[0.9rem] text-ink-muted">
          Fetching from {servedBy}&rsquo;s machine…
        </p>
      </main>
    );
  }

  if (phase.state === "impostor") {
    return (
      <main className="mx-auto max-w-[40rem] px-5 py-20">
        <h1 className="font-serif text-[1.8rem] font-semibold tracking-[-0.025em]">
          This is not {servedBy}&rsquo;s machine
        </h1>
        <p className="mt-4 text-[0.98rem] leading-relaxed text-ink-muted">
          Somebody announced an address that answers for a different
          contributor. Nothing from it is shown here: whatever is at that
          address may be perfectly good work, but it is not the work you asked
          for and not from the person you asked for it from.
        </p>
        <p className="mt-2 font-mono text-[0.78rem] text-ink-faint">
          {address} — {phase.detail}
        </p>
        <p className="mt-4 max-w-[52ch] text-[0.86rem] leading-relaxed text-ink-faint">
          The platform cannot catch this for you. It is handed an address by
          whoever announces it and never visits one — staying out of that
          request is the reason nothing you read passes through it. So the
          check happens here, in your browser, against what the machine itself
          says it is.
        </p>
        <Link
          href="/read"
          className="mt-6 inline-block rounded-md bg-accent px-5 py-2.5 text-[0.9rem] font-medium text-accent-ink transition-colors hover:bg-accent-hover"
        >
          See what is online
        </Link>
      </main>
    );
  }

  if (phase.state === "offline") {
    return (
      <main className="mx-auto max-w-[40rem] px-5 py-20">
        <h1 className="font-serif text-[1.8rem] font-semibold tracking-[-0.025em]">
          {servedBy}&rsquo;s node stopped answering
        </h1>
        <p className="mt-4 text-[0.98rem] leading-relaxed text-ink-muted">
          It announced itself a moment ago but the request did not reach it.
          Nothing is cached here to show you instead.
        </p>
        <p className="mt-2 font-mono text-[0.78rem] text-ink-faint">
          {address} — {phase.reason}
        </p>
        <Link
          href="/read"
          className="mt-6 inline-block rounded-md bg-accent px-5 py-2.5 text-[0.9rem] font-medium text-accent-ink transition-colors hover:bg-accent-hover"
        >
          See what is online
        </Link>
      </main>
    );
  }

  const { column } = phase;
  const claims = resolved!.views;
  const conclusion = resolved!.conclusion;
  const counts = resolved!.counts;

  return (
    <main>
      <article className="mx-auto max-w-[46rem] px-5 py-10 sm:py-14">
        <Link
          href="/read"
          className="text-[0.82rem] text-ink-faint transition-colors hover:text-ink"
        >
          ← Reading now
        </Link>

        <header className="mt-7 border-b border-rule pb-8">
          <h1 className="font-serif text-[2rem] font-semibold leading-[1.12] tracking-[-0.025em] sm:text-[2.5rem]">
            {column.title}
          </h1>
          {column.subtitle && (
            <p className="mt-4 font-serif text-[1.12rem] leading-relaxed text-ink-muted">
              {column.subtitle}
            </p>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.82rem] text-ink-muted">
            <span className="font-medium text-ink">{column.author}</span>
            <span aria-hidden className="text-ink-faint">·</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-verified" aria-hidden />
              served live from {servedBy}&rsquo;s machine
            </span>
            {column.access !== "public" && (
              <span className="rounded-full border border-rule-strong px-2 py-px text-[0.68rem] font-medium uppercase tracking-[0.06em]">
                {column.access}
              </span>
            )}
          </div>
        </header>

        <section
          aria-label="Claim check status"
          className="mt-7 rounded-xl border border-rule bg-paper-raised px-4 py-3.5"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <CheckBadge conclusion={conclusion} counts={counts} size="md" />
            <span className="text-[0.8rem] text-ink-muted">
              checked in your browser at {checkedAt}
            </span>
            {anonymous && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-counter/30 bg-counter-wash px-2 py-0.5 text-[0.7rem] font-medium text-counter"
                title="Fetched with an anonymous access token. The node was shown a tier and no identity."
              >
                <span aria-hidden>▚</span>
                read anonymously
              </span>
            )}
          </div>

          {conclusion === "drifted" && (
            <p className="mt-3 border-t border-rule pt-3 text-[0.82rem] leading-relaxed text-drifted">
              {counts.drifted} claim{counts.drifted === 1 ? " has" : "s have"}{" "}
              moved beyond the tolerance the author set. The value shown is the
              current one; the sentence around it may no longer follow.
            </p>
          )}
          {conclusion === "broken" && (
            <p className="mt-3 border-t border-rule pt-3 text-[0.82rem] leading-relaxed text-broken">
              {counts.broken} claim{counts.broken === 1 ? "" : "s"} could not be
              resolved.{" "}
              {}
              Open one to see why — each says what went wrong with it.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-rule pt-3 text-[0.78rem] text-ink-muted">
            <span>
              <span className="text-ink-faint">from</span>{" "}
              <span className="font-mono">{address}</span>
            </span>
            {[...phase.datasets.values()].map((dataset) => (
              <span key={dataset.id}>
                <span className="text-ink-faint">dataset</span> {dataset.id}{" "}
                <span className="font-mono">@{dataset.release}</span>
                {dataset.generatedAt && (
                  <span className="text-ink-faint">
                    {" "}
                    · generated{" "}
                    {new Date(dataset.generatedAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                )}
              </span>
            ))}
            {column.repo && (
              <a
                href={column.repo}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-ink"
              >
                <span className="text-ink-faint">repo</span>{" "}
                {column.repo.replace("https://github.com/", "")}
                {column.commit && <span className="font-mono"> @{column.commit}</span>}
              </a>
            )}
          </div>
        </section>

        <div className="prose mt-10">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkClaims]}
            components={components(
              claims,
              tier !== "reader",
              new Set(column.withheldClaims ?? []),
            )}
          >
            {column.prose}
          </ReactMarkdown>
        </div>

          {payTo && (
            <section className="mt-14 rounded-xl border border-counter/30 bg-counter-wash p-5">
              <h2 className="font-serif text-[1.1rem] font-semibold text-counter">
                Pay {servedBy} directly
              </h2>
              <p className="mt-1.5 max-w-[54ch] text-[0.88rem] leading-relaxed text-ink-muted">
                Your membership pays for the broker and the reading tools. It
                does not pay {servedBy}, and we take no share of anything you
                send them. This is what they gave as a way to reach them:
              </p>
              <p className="mt-3 break-all rounded-md border border-rule bg-paper-raised p-3 font-mono text-[0.82rem] text-ink">
                {payTo}
              </p>
              <p className="mt-3 max-w-[54ch] text-[0.78rem] leading-relaxed text-ink-faint">
                We are not part of whatever happens next. Nothing is calculated,
                held, routed or recorded here — we do not learn whether you sent
                anything, and neither the amount nor the fact of it is visible
                to us or to anybody else on this site.
              </p>
            </section>
          )}

        {column.entitled && (
          <section className="mt-14 rounded-xl border border-rule bg-paper-sunken p-5">
            <h2 className="font-serif text-[1.1rem] font-semibold">
              Disagree with this?
            </h2>
            <p className="mt-1.5 max-w-[54ch] text-[0.88rem] leading-relaxed text-ink-muted">
              Send {servedBy} an edit. It goes straight to their machine and is
              stored there next to the column — Cephroom neither holds it nor
              sees it.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href={`${base}/propose`}
                className="rounded-md border border-field-border px-4 py-2 text-[0.86rem] font-medium transition-colors hover:border-ink-faint"
              >
                Propose an edit
              </Link>
              <Link
                href={`${base}/proposals`}
                className="rounded-md px-4 py-2 text-[0.86rem] font-medium text-ink-muted transition-colors hover:text-ink"
              >
                See proposals
              </Link>
            </div>
          </section>
        )}

        {!column.entitled && (
          <Paywall
            access={column.access as "member" | "lab"}
            tier={tier}
            signedIn={signedIn}
            hiddenBlocks={column.hiddenBlocks}
            claimCount={column.withheldClaimCount ?? 0}
            returnTo={base}
          />
        )}
      </article>
    </main>
  );
}

function components(
  claims: Map<string, ResolvedClaim>,
  canInspect: boolean,
  withheld: Set<string>,
): Components {
  const map = {
    claim: ({ node }: { node?: { properties?: Record<string, unknown> } }) => {
      const key = String(node?.properties?.claimkey ?? "");
      return (
        <ClaimChip
          claim={claims.get(key)}
          canInspect={canInspect}
          withheld={withheld.has(key)}
        />
      );
    },
    table: ({ children }: { children?: React.ReactNode }) => (
      <div className="scroll-x">
        <table>{children}</table>
      </div>
    ),
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      const external = Boolean(href?.startsWith("http"));
      return (
        <a
          href={href}
          target={external ? "_blank" : undefined}
          rel={external ? "noopener noreferrer" : undefined}
        >
          {children}
        </a>
      );
    },
  };
  return map as unknown as Components;
}
