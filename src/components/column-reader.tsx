"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { CheckBadge } from "@/components/check-badge";
import { ClaimChip, type ClaimView } from "@/components/claim-chip";
import { Paywall } from "@/components/paywall";
import type { Access, Tier } from "@/lib/access";
import { formatValue, type ParsedClaim } from "@/lib/claims/syntax";
import { concludeRun, judge, type Conclusion } from "@/lib/claims/verdict";
import { remarkClaims } from "@/lib/markdown/remark-claims";

/**
 * Reads a column by fetching it from the contributor's node.
 *
 * This runs in the browser on purpose. Under Contract 2 the platform must not
 * hold or proxy content, so the bytes go straight from the author's machine
 * to the reader's — the server that rendered this page never sees them.
 *
 * Claims are verified here too, at read time, against the dataset fetched
 * from whichever node is serving it. That is a consequence of Contract 2
 * rather than a design flourish: a stored check run would be a derived record
 * of content the platform may not keep. It turns out better than what it
 * replaced, because a badge can no longer be green from a run three weeks ago.
 */

interface ServedColumn {
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
  servedAt: string;
}

interface Fact {
  subject: string;
  object: string;
  metric: string;
  scope: string;
  value: number;
  unit: string | null;
  nPoints: number | null;
  nDocs: number | null;
}

interface Dataset {
  id: string;
  name: string;
  release: string;
  facts: Fact[];
}

type Phase =
  | { state: "loading" }
  | { state: "offline"; reason: string }
  | { state: "ready"; column: ServedColumn; datasets: Map<string, Dataset> };

export function ColumnReader({
  id,
  address,
  servedBy,
  datasets: datasetAddresses,
  nodeKey,
  tier,
  signedIn,
}: {
  id: string;
  address: string;
  servedBy: string;
  datasets: Record<string, string>;
  nodeKey: string | null;
  tier: Tier;
  signedIn: boolean;
}) {
  const [phase, setPhase] = useState<Phase>({ state: "loading" });
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`${address}/column/${encodeURIComponent(id)}`, {
          headers: nodeKey ? { authorization: `Bearer ${nodeKey}` } : {},
        });
        if (!response.ok) throw new Error(`node returned ${response.status}`);
        const column = (await response.json()) as ServedColumn;

        const needed = [...new Set(column.claims.map((claim) => claim.datasetSlug))];
        const datasets = new Map<string, Dataset>();
        for (const slug of needed) {
          const datasetAddress = datasetAddresses[slug];
          if (!datasetAddress) continue;
          const data = await fetch(`${datasetAddress}/dataset`);
          if (data.ok) datasets.set(slug, (await data.json()) as Dataset);
        }

        if (cancelled) return;
        setPhase({ state: "ready", column, datasets });
        setCheckedAt(new Date().toLocaleTimeString());
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
  }, [address, id, nodeKey, datasetAddresses]);

  const resolved = useMemo(() => {
    if (phase.state !== "ready") return null;
    return resolveClaims(phase.column.claims, phase.datasets);
  }, [phase]);

  if (phase.state === "loading") {
    return (
      <main className="mx-auto max-w-[46rem] px-5 py-20">
        <p className="text-[0.9rem] text-ink-muted">
          Fetching from {servedBy}&rsquo;s machine…
        </p>
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
          className="mt-6 inline-block rounded-md bg-accent px-5 py-2.5 text-[0.9rem] font-medium text-white transition-colors hover:bg-accent-hover"
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
              resolved. Either the dataset moved, or nobody is currently serving
              the dataset it needs.
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
            components={components(claims, tier !== "reader")}
          >
            {column.prose}
          </ReactMarkdown>
        </div>

        {column.entitled && (
          <section className="mt-14 rounded-xl border border-rule bg-paper-sunken p-5">
            <h2 className="font-serif text-[1.1rem] font-semibold">
              Disagree with this?
            </h2>
            <p className="mt-1.5 max-w-[54ch] text-[0.88rem] leading-relaxed text-ink-muted">
              Send {servedBy} an edit. It goes straight to their machine and is
              stored there next to the column — Receptorome neither holds it nor
              sees it.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href={`/read/${column.id}/propose`}
                className="rounded-md border border-rule-strong px-4 py-2 text-[0.86rem] font-medium transition-colors hover:border-ink-faint"
              >
                Propose an edit
              </Link>
              <Link
                href={`/read/${column.id}/proposals`}
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
            claimCount={claims.size}
            returnTo={`/read/${column.id}`}
          />
        )}
      </article>
    </main>
  );
}

/**
 * Runs every claim against the datasets currently being served. The pure
 * judge from lib/claims/verdict is the same code the author's editor uses.
 */
function resolveClaims(claims: ParsedClaim[], datasets: Map<string, Dataset>) {
  const views = new Map<string, ClaimView>();
  const verdicts: ("verified" | "drifted" | "broken")[] = [];

  for (const claim of claims) {
    const dataset = datasets.get(claim.datasetSlug);
    const fact = dataset?.facts.find(
      (candidate) =>
        candidate.subject === claim.subject &&
        candidate.object === claim.object &&
        candidate.metric === claim.metric &&
        candidate.scope === claim.scope,
    );

    const observed = !fact
      ? { value: null, unit: null }
      : claim.select === "n_points"
        ? { value: fact.nPoints, unit: null }
        : claim.select === "n_docs"
          ? { value: fact.nDocs, unit: null }
          : { value: fact.value, unit: fact.unit };

    const judgement = !dataset
      ? {
          verdict: "broken" as const,
          deltaPct: null,
          note: `Nobody is serving the dataset "${claim.datasetSlug}" right now, so this number cannot be checked.`,
        }
      : judge(
          { value: claim.expectedValue, unit: claim.expectedUnit },
          observed,
          claim.tolerance,
        );

    verdicts.push(judgement.verdict);

    views.set(claim.key, {
      key: claim.key,
      display:
        observed.value !== null
          ? formatValue(observed.value, observed.unit)
          : formatValue(claim.expectedValue, claim.expectedUnit),
      verdict: judgement.verdict,
      authored: formatValue(claim.expectedValue, claim.expectedUnit),
      observed:
        observed.value !== null ? formatValue(observed.value, observed.unit) : "—",
      deltaPct: judgement.deltaPct,
      tolerance:
        claim.tolerance.kind === "percent"
          ? `${claim.tolerance.amount}%`
          : `±${claim.tolerance.amount}`,
      note:
        judgement.note ??
        (fact ? null : `No cell for ${claim.subject} × ${claim.object}.`),
      query: {
        dataset: dataset?.name ?? claim.datasetSlug,
        datasetSlug: claim.datasetSlug,
        metric: claim.metric,
        subject: claim.subject,
        object: claim.object,
        scope: claim.scope,
        select: claim.select,
      },
      release: dataset?.release ?? null,
      checkedAt: "just now, in your browser",
      nPoints: fact?.nPoints ?? null,
      nDocs: fact?.nDocs ?? null,
    });
  }

  return {
    views,
    conclusion: concludeRun(verdicts) as Conclusion,
    counts: {
      verified: verdicts.filter((v) => v === "verified").length,
      drifted: verdicts.filter((v) => v === "drifted").length,
      broken: verdicts.filter((v) => v === "broken").length,
    },
  };
}

function components(
  claims: Map<string, ClaimView>,
  canInspect: boolean,
): Components {
  const map = {
    claim: ({ node }: { node?: { properties?: Record<string, unknown> } }) => {
      const key = String(node?.properties?.claimkey ?? "");
      return <ClaimChip claim={claims.get(key)} canInspect={canInspect} />;
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
