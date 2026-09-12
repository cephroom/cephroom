import { methodSpread, selectByMethod } from "@/lib/claims/method";
import { formatValue, isFoldSelect, type ParsedClaim } from "@/lib/claims/syntax";
import { concludeRun, judge, type Conclusion, type Verdict } from "@/lib/claims/verdict";


export interface Fact {
  subject: string;
  object: string;
  metric: string;
  scope: string;
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
  checkedAt: string = "just now",
): ResolutionRun {
  const views = new Map<string, ResolvedClaim>();
  const verdicts: Verdict[] = [];

  for (const claim of claims) {
    const dataset = datasets.get(claim.datasetSlug);
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

    const methodProblem =
      claim.select === "method_spread"
        ? null
        : picked.kind === "ambiguous"
          ? `This cell exists under ${picked.methods.length} analyses (${picked.methods.join(", ")}). A claim has to name which one it means — add a "method:" line.`
          : picked.kind === "unknown"
            ? `No analysis called "${claim.method}" here. This cell has: ${picked.methods.join(", ")}.`
            : null;

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

    const statMissing =
      Boolean(dataset) &&
      Boolean(fact) &&
      observed.value === null &&
      !methodProblem;
    const note = statMissing
      ? `This cell reports no ${describeStat(claim.select)} to check — the statistic is not available for this query.`
      : (judgement.note ??
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
