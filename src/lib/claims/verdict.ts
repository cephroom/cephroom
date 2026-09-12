import type { ClaimTolerance } from "./syntax";

export type Verdict = "verified" | "drifted" | "broken";
export type Conclusion = "passing" | "drifted" | "broken" | "empty";

export interface Judgement {
  verdict: Verdict;
  deltaPct: number | null;
  note: string | null;
}

export function judge(
  expected: { value: number | null; unit: string | null },
  observed: { value: number | null | undefined; unit: string | null | undefined },
  tolerance: ClaimTolerance,
): Judgement {
  if (observed.value === null || observed.value === undefined) {
    return {
      verdict: "broken",
      deltaPct: null,
      note: "No cell in the dataset matches this query.",
    };
  }

  if (expected.value === null) {
    return {
      verdict: "broken",
      deltaPct: null,
      note: "The claim records no authored value, so there is nothing to check against.",
    };
  }

  const expectedUnit = normaliseUnit(expected.unit);
  const observedUnit = normaliseUnit(observed.unit);
  if (expectedUnit !== observedUnit) {
    return {
      verdict: "broken",
      deltaPct: null,
      note: `Unit mismatch: claim says ${expected.unit ?? "no unit"}, dataset says ${observed.unit ?? "no unit"}. No conversion is applied.`,
    };
  }

  const diff = observed.value - expected.value;
  const deltaPct =
    expected.value === 0 ? null : (diff / Math.abs(expected.value)) * 100;

  const withinTolerance =
    tolerance.kind === "absolute"
      ? Math.abs(diff) <= tolerance.amount
      : deltaPct === null
        ? Math.abs(diff) <= tolerance.amount
        : Math.abs(deltaPct) <= tolerance.amount;

  if (withinTolerance) {
    return { verdict: "verified", deltaPct, note: null };
  }

  return {
    verdict: "drifted",
    deltaPct,
    note: `Dataset value moved beyond the ${describeTolerance(tolerance)} tolerance.`,
  };
}

export function describeTolerance(tolerance: ClaimTolerance): string {
  return tolerance.kind === "percent"
    ? `${trimNumber(tolerance.amount)}%`
    : `±${trimNumber(tolerance.amount)}`;
}

export function concludeRun(verdicts: Verdict[]): Conclusion {
  if (verdicts.length === 0) return "empty";
  if (verdicts.includes("broken")) return "broken";
  if (verdicts.includes("drifted")) return "drifted";
  return "passing";
}

function normaliseUnit(unit: string | null | undefined): string {
  return (unit ?? "").trim().toLowerCase();
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}
