import type { ClaimTolerance } from "./syntax";

export type Verdict = "verified" | "drifted" | "broken";
export type Conclusion = "passing" | "drifted" | "broken" | "empty";

/**
 * A shape per verdict, so the check is legible without colour - WCAG 1.4.1.
 *
 * The product's whole value is that "verified" reads at a glance. Signalling it
 * with a red-or-green dot of one shape fails that glance for the ~8% of men
 * with red-green colour deficiency, on the exact number they came to check. So
 * each verdict gets a distinct character - not a coloured dot - and colour
 * becomes reinforcement rather than the signal:
 *
 *   verified  a check
 *   drifted   approximately-equal, because the value moved but is present
 *   broken    a cross, because it could not be resolved
 *   passing   a check, the whole-column form of verified
 *   empty     a dash, nothing to check
 *
 * Keyed by both Verdict and Conclusion so the inline chip and the summary
 * badge draw from one source and cannot drift apart.
 */
export const VERDICT_GLYPH: Record<Verdict | Conclusion, string> = {
  verified: "✓",
  passing: "✓",
  drifted: "≈",
  broken: "✕",
  empty: "–",
};

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
