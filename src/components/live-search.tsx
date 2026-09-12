"use client";

import Link from "next/link";
import { useState } from "react";

import { spendToken, type SpendOutcome } from "@/lib/tokens/wallet";


interface LiveResult {
  sub: string;
  servedBy: string;
  address: string;
  id: string;
  title: string;
  kind: "column" | "dataset";
  tags: string[];
  summary: string | null;
}

interface LiveAnswer {
  count: number;
  contributors: number;
  truncated?: boolean;
  matching?: number;
  reach: { plan: string; results: number; concurrentNodes: number };
  results: LiveResult[];
}

type State =
  | { phase: "server" }
  | { phase: "searching" }
  | {
      phase: "answered";
      query: string;
      answer: LiveAnswer;
      spend: SpendOutcome["kind"];
    }
  | { phase: "failed"; detail: string };

export function LiveSearch({
  initialQuery,
  children,
}: {
  initialQuery: string;
  children: React.ReactNode;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [state, setState] = useState<State>({ phase: "server" });

  async function run(event: React.FormEvent) {
    event.preventDefault();
    setState({ phase: "searching" });

    const spent = await spendToken();

    try {
      const response = await fetch(
        `/api/v1/live?q=${encodeURIComponent(query)}`,
        spent.kind === "spent"
          ? {
              headers: { authorization: `Bearer ${spent.key}` },
              credentials: "omit",
            }
          : {},
      );
      if (!response.ok) {
        throw new Error(`the listing returned ${response.status}`);
      }
      setState({
        phase: "answered",
        query,
        answer: (await response.json()) as LiveAnswer,
        spend: spent.kind,
      });
    } catch (caught) {
      setState({
        phase: "failed",
        detail: caught instanceof Error ? caught.message : "unreachable",
      });
    }
  }

  return (
    <div>
      <form action="/read" onSubmit={run} className="mt-6 flex max-w-md gap-2">
        <input
          name="q"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search what is online"
          aria-label="Search"
          className="w-full rounded-md border border-field-border bg-paper-raised px-3 py-2 text-[0.9rem] outline-none transition-colors placeholder:text-ink-faint focus:border-accent"
        />
        <button
          type="submit"
          className="shrink-0 rounded-md bg-accent px-4 py-2 text-[0.88rem] font-medium text-accent-ink transition-colors hover:bg-accent-hover"
        >
          Search
        </button>
      </form>

      {state.phase === "server" && children}

      {state.phase === "searching" && (
        <p className="mt-10 text-[0.9rem] text-ink-muted" role="status">
          Searching what is online&hellip;
        </p>
      )}

      {state.phase === "failed" && (
        <p className="mt-10 text-[0.9rem] text-ink-muted" role="status">
          The listing stopped answering &mdash; {state.detail}
        </p>
      )}

      {state.phase === "answered" && (
        <Answer
          query={state.query}
          answer={state.answer}
          spend={state.spend}
        />
      )}
    </div>
  );
}

const SPEND_NOTE: Record<SpendOutcome["kind"], string> = {
  spent:
    "Searched with an anonymous token and no cookie, so this query is not attached to your subscription.",
  empty:
    "Searched with your ordinary key, because this browser is holding no tokens. A token would have detached this query from your subscription.",
  stale:
    "Searched with your ordinary key. The tokens this browser held were signed by an issuer key that is no longer published, so they have been thrown away — this query IS attached to your subscription. Get a fresh batch from your key page.",
  refused:
    "Searched with your ordinary key. The token this browser spent was refused, so this query IS attached to your subscription. Get a fresh batch from your key page.",
  unreachable:
    "Searched with your ordinary key, because the token could not be redeemed just now. This query IS attached to your subscription; the token was kept.",
};

function Answer({
  query,
  answer,
  spend,
}: {
  query: string;
  answer: LiveAnswer;
  spend: SpendOutcome["kind"];
}) {
  const columns = answer.results.filter((result) => result.kind === "column");
  const datasets = answer.results.filter((result) => result.kind === "dataset");

  return (
    <div>
      <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-[0.82rem]">
        <Stat label="Contributors matched" value={String(answer.contributors)} />
        <Stat label="Columns matched" value={String(columns.length)} />
        <Stat label="Datasets matched" value={String(datasets.length)} />
      </dl>

      <p
        className={`mt-4 max-w-[62ch] text-[0.78rem] leading-relaxed ${
          spend === "stale" || spend === "refused"
            ? "text-broken"
            : "text-ink-faint"
        }`}
        role={spend === "stale" || spend === "refused" ? "status" : undefined}
      >
        {SPEND_NOTE[spend]}
        {answer.truncated
          ? ` ${answer.matching} matched; ${answer.reach.plan} returns ${answer.reach.results}.`
          : ""}
      </p>

      {answer.results.length === 0 && (
        <div className="mt-10 rounded-xl border border-rule bg-paper-raised px-6 py-12 text-center">
          <h2 className="font-serif text-[1.3rem] font-semibold">
            Nothing online matches that
          </h2>
          <p className="mx-auto mt-3 max-w-[50ch] text-[0.92rem] leading-relaxed text-ink-muted">
            Nothing being served right now matches &ldquo;{query}&rdquo;. There
            is no archive to fall back on &mdash; if nobody is serving it, it is
            not here to be found.
          </p>
        </div>
      )}

      {columns.length > 0 && (
        <section className="mt-2">
          <ul className="grid gap-x-10 sm:grid-cols-2">
            {columns.map((result) => (
              <li
                key={`${result.sub}-${result.id}`}
                className="border-b border-rule"
              >
                <Link
                  href={`/read/${encodeURIComponent(result.sub)}/${encodeURIComponent(result.id)}`}
                  className="group block py-7"
                >
                  <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.78rem] text-ink-faint">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-verified"
                        aria-hidden
                      />
                      {result.servedBy}
                    </span>
                    <span aria-hidden>·</span>
                    <span>serving live</span>
                  </div>

                  <h2 className="font-serif text-[1.32rem] font-semibold leading-snug tracking-[-0.015em] decoration-accent/40 underline-offset-4 group-hover:underline">
                    {result.title}
                  </h2>

                  {result.summary && (
                    <p className="mt-2 max-w-[60ch] text-[0.92rem] leading-relaxed text-ink-muted">
                      {result.summary}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {datasets.length > 0 && (
        <section className="mt-12">
          <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-ink-faint">
            Datasets being served
          </h2>
          <ul className="mt-3 space-y-3">
            {datasets.map((result) => (
              <li
                key={`${result.sub}-${result.id}`}
                className="rounded-xl border border-rule bg-paper-raised p-5"
              >
                <Link
                  href={`/read/${encodeURIComponent(result.sub)}/${encodeURIComponent(result.id)}`}
                  className="font-serif text-[1.15rem] font-semibold hover:underline"
                >
                  {result.title}
                </Link>
                {result.summary && (
                  <p className="mt-1.5 max-w-[62ch] text-[0.88rem] leading-relaxed text-ink-muted">
                    {result.summary}
                  </p>
                )}
                <p className="mt-2 text-[0.76rem] text-ink-faint">
                  served by {result.servedBy}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-faint">{label}</dt>
      <dd className="mt-0.5 font-mono text-[1rem]">{value}</dd>
    </div>
  );
}
