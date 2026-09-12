import { methodSpread, selectByMethod } from "@/lib/claims/method";
import { formatValue, isFoldSelect, type ParsedClaim } from "@/lib/claims/syntax";
import { concludeRun, judge, type Conclusion, type Verdict } from "@/lib/claims/verdict";

/**
 * Running a column's claims against the datasets its author is serving.
 *
 * This lived inside the reader component until the API was built, which made
 * it the clearest example of the rule that an API nobody can do the real work
 * through is decorative: a script could fetch a column, but it could not
 * *check* one without reimplementing the judge, the method selection, the
 * statistic selection and the display rules — and a second implementation of
 * the drift rules would eventually disagree with the first, silently, which is
 * the whole failure this platform exists to prevent.
 *
 * So it is here, pure and free of React and of Node built-ins, and the reader
 * and the API call the same function. A consumer who does not trust the
 * platform's rendering can import it and check a column themselves against
 * bytes they fetched from the author's node directly.
 */

/** A fact as a node serves it. */
export interface Fact {
  subject: string;
  object: string;
  metric: string;
  scope: string;
  /** The analysis that produced this number, or null when there is one. */
  method?: string | null;
  value: number;
  unit: string | null;
  nPoints: number | null;
  nDocs: number | null;
  foldSpread: number | null;
  foldSpreadIqr: number | null;
  nMeasurements: number | null;
  nCensored: number | null;
  pdspFold: number | null;
  /** The spread the dataset reports, in the value's units. Null: none given. */
  dispersion?: number | null;
  dispersionKind?: string | null;
  nObservations?: number | null;
}

export interface Dataset {
  id: string;
  name: string;
  description: string;
  source: string;
  release: string;
  generatedAt: string | null;
  notes: string[];
  facts: Fact[];
}

/** One claim, judged. The same shape the reader renders and the API returns. */
export interface ResolvedClaim {
  key: string;
  display: string;
  verdict: Verdict;
  authored: string;
  observed: string;
  deltaPct: number | null;
  tolerance: string;
  note: string | null;
  query: {
    dataset: string;
    datasetSlug: string;
    owner: string;
    metric: string;
    subject: string;
    object: string;
    method: string | null;
    scope: string;
    select: string;
  };
  release: string | null;
  checkedAt: string | null;
  nPoints: number | null;
  nDocs: number | null;
}

export interface ResolutionRun {
  views: Map<string, ResolvedClaim>;
  conclusion: Conclusion;
  counts: { verified: number; drifted: number; broken: number };
}

/** Human phrase for a claim's select, for the "statistic not available" note. */
function describeStat(select: ParsedClaim["select"]): string {
  switch (select) {
    case "fold_spread_iqr":
      return "interquartile fold spread";
    case "fold_spread":
      return "fold spread";
    case "n_points":
      return "measurement count";
    case "n_docs":
      return "document count";
    case "censored_fraction":
      return "censored fraction";
    case "pdsp_fold":
      return "PDSP cross-check";
    default:
      return "value";
  }
}

export function resolveClaims(
  claims: ParsedClaim[],
  datasets: Map<string, Dataset>,
  owner: string,
  /** How the check should describe when it happened. The reader says "in your
   *  browser"; an API consumer is told the timestamp instead. */
  checkedAt: string = "just now",
): ResolutionRun {
  const views = new Map<string, ResolvedClaim>();
  const verdicts: Verdict[] = [];

  for (const claim of claims) {
    const dataset = datasets.get(claim.datasetSlug);
    // Everything matching the query except the analysis. Usually one row; for
    // a dataset that holds the same cell under several pipelines, several.
    const candidates = (dataset?.facts ?? [])
      .filter(
        (candidate) =>
          candidate.subject === claim.subject &&
          candidate.object === claim.object &&
          candidate.metric === claim.metric &&
          candidate.scope === claim.scope,
      )
      .map((candidate) => ({ ...candidate, method: candidate.method ?? null }));

    const picked = selectByMethod(candidates, claim.method);
    const fact = picked.kind === "resolved" ? picked.fact : undefined;

    // A cell with several analyses and a claim that names none is the case
    // this whole mechanism exists for. It resolves broken and says which
    // analyses there are, rather than choosing one or averaging them into a
    // number no experiment produced. See src/lib/claims/method.ts.
    // ...except for method_spread, which is a question *about* the set of
    // analyses. Demanding that it name one would be demanding it answer a
    // different question.
    const methodProblem =
      claim.select === "method_spread"
        ? null
        : picked.kind === "ambiguous"
          ? `This cell exists under ${picked.methods.length} analyses (${picked.methods.join(", ")}). A claim has to name which one it means — add a "method:" line.`
          : picked.kind === "unknown"
            ? `No analysis called "${claim.method}" here. This cell has: ${picked.methods.join(", ")}.`
            : null;

    // method_spread is a statement about *all* the analyses of a cell, so it
    // resolves from the candidate set rather than from one picked fact — and
    // is the one select that does not need a `method:` line, because naming a
    // single analysis would defeat the question it asks.
    const observed: { value: number | null; unit: string | null } =
      claim.select === "method_spread"
        ? { value: methodSpread(candidates), unit: null }
        : !fact
      ? { value: null, unit: null }
      : claim.select === "n_points"
        ? { value: fact.nPoints, unit: null }
        : claim.select === "n_docs"
          ? { value: fact.nDocs, unit: null }
          : claim.select === "fold_spread"
            ? { value: fact.foldSpread, unit: null }
            : claim.select === "fold_spread_iqr"
              ? { value: fact.foldSpreadIqr, unit: null }
              : claim.select === "censored_fraction"
                ? {
                    value:
                      fact.nCensored !== null &&
                      fact.nMeasurements !== null &&
                      fact.nMeasurements > 0
                        ? fact.nCensored / fact.nMeasurements
                        : null,
                    unit: null,
                  }
                : claim.select === "pdsp_fold"
                  ? { value: fact.pdspFold, unit: null }
                  : claim.select === "dispersion"
                    ? { value: fact.dispersion ?? null, unit: fact.unit }
                    : { value: fact.value, unit: fact.unit };

    // Fold spread reads as a ratio ("5.07×"); a censored fraction reads as a
    // percentage ("7%"); everything else in its own unit.
    const show = (value: number | null, unit: string | null) =>
      value === null
        ? "—"
        : isFoldSelect(claim.select)
          ? `${formatValue(value)}×`
          : claim.select === "censored_fraction"
            ? `${formatValue(value * 100)}%`
            : formatValue(value, unit);

    const judgement = !dataset
      ? {
          verdict: "broken" as const,
          deltaPct: null,
          note: `Nobody is serving the dataset "${claim.datasetSlug}" right now, so this number cannot be checked.`,
        }
      : methodProblem
        ? { verdict: "broken" as const, deltaPct: null, note: methodProblem }
      : judge(
          { value: claim.expectedValue, unit: claim.expectedUnit },
          observed,
          claim.tolerance,
        );

    verdicts.push(judgement.verdict);

    // When the cell exists but the selected statistic does not — a human-scope
    // interquartile fold spread, say, which the pipeline does not compute — the
    // judge sees a null observed value and reports "no cell matches this query".
    // The cell is there; only the statistic is absent. Say what is actually
    // missing rather than implying the query found nothing.
    const statMissing =
      Boolean(dataset) &&
      Boolean(fact) &&
      observed.value === null &&
      !methodProblem;
    const note = statMissing
      ? `This cell reports no ${describeStat(claim.select)} to check — the statistic is not available for this query.`
      : (judgement.note ??
        // Keyed on the candidate set, not on one picked fact: method_spread
        // resolves from every analysis of a cell and never picks one, so
        // testing `fact` here reported "no cell" under a green verdict.
        (candidates.length > 0
          ? null
          : `No cell for ${claim.subject} × ${claim.object}.`));

    views.set(claim.key, {
      key: claim.key,
      display:
        observed.value !== null
          ? withDispersion(show(observed.value, observed.unit), claim, fact)
          : show(claim.expectedValue, claim.expectedUnit),
      verdict: judgement.verdict,
      authored: show(claim.expectedValue, claim.expectedUnit),
      observed: show(observed.value, observed.unit),
      deltaPct: judgement.deltaPct,
      tolerance:
        claim.tolerance.kind === "percent"
          ? `${claim.tolerance.amount}%`
          : `±${claim.tolerance.amount}`,
      note,
      query: {
        dataset: dataset?.name ?? claim.datasetSlug,
        datasetSlug: claim.datasetSlug,
        owner,
        metric: claim.metric,
        subject: claim.subject,
        object: claim.object,
        method: claim.method,
        scope: claim.scope,
        select: claim.select,
      },
      release: dataset?.release ?? null,
      checkedAt,
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



/**
 * Renders a value with the spread the dataset reports around it.
 *
 * "59.45 %" becomes "59.45 ± 3.33 %". Not decoration: the honest rendering of
 * a distribution is not its centre, and showing the centre alone is how this
 * repository came to ship a column asserting a direction from a gap of 2.02
 * against a standard error of 2.99.
 *
 * Only for `select: value`. A count, a fold ratio or the dispersion itself has
 * no dispersion of its own to show, and attaching one would be nonsense.
 */
function withDispersion(
  rendered: string,
  claim: ParsedClaim,
  fact: { dispersion?: number | null; unit?: string | null } | undefined,
): string {
  if (claim.select !== "value") return rendered;
  if (!fact || fact.dispersion === null || fact.dispersion === undefined) {
    return rendered;
  }
  const unit = fact.unit ? ` ${fact.unit}` : "";
  const bare = rendered.endsWith(unit) ? rendered.slice(0, -unit.length) : rendered;
  return `${bare} ± ${formatValue(fact.dispersion)}${unit}`;
}
