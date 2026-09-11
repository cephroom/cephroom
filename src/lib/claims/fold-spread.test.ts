import { describe, expect, it } from "vitest";

import { parseBody } from "./syntax";
import { judge } from "./verdict";

/**
 * Fold-spread claims — the between-lab agreement bound.
 *
 * A claim can assert the full fold spread of a cell (loosest / tightest) or
 * its interquartile fold spread (the middle half). This is a claim about how
 * far measurements *disagree*, which a single median hides entirely: in the
 * source pipeline the median cell fold spread is 14.5x while the median IQR
 * fold spread is 2.25x, so the same median can sit on a tight core or on
 * genuine disagreement. These tests hold the grammar and the judging.
 */

function claim(select: string, value: string, tolerance = "15%") {
  return [
    "{{claim:agreement}}",
    "",
    "```claim agreement",
    "dataset: receptorome-ki",
    "metric: median_ki_nm",
    "subject: DRD2",
    "object: clozapine",
    `select: ${select}`,
    `value: ${value}`,
    `tolerance: ${tolerance}`,
    "```",
  ].join("\n");
}

describe("fold-spread grammar", () => {
  it("accepts fold_spread and fold_spread_iqr as selects", () => {
    expect(parseBody(claim("fold_spread", "140.6x")).errors).toEqual([]);
    expect(parseBody(claim("fold_spread_iqr", "5.07x")).errors).toEqual([]);
  });

  it("treats a fold value as a bare ratio, dropping any fold notation", () => {
    // "5x", "5-fold", "×5" and "5" are the same assertion — the notation must
    // not survive as a unit, or it would read as a mismatch against the
    // dimensionless observed value. Both trailing and leading notation work.
    for (const written of ["5.07x", "5.07-fold", "5.07×", "5.07", "×5.07", "x5.07"]) {
      const [c] = parseBody(claim("fold_spread_iqr", written)).claims;
      expect(c.expectedValue).toBeCloseTo(5.07);
      expect(c.expectedUnit).toBeNull();
    }
  });

  it("rejects a nonsensical non-positive fold ratio", () => {
    // A fold spread is loosest/tightest and is always ≥ 1; a negative or zero
    // ratio is not a real assertion, so it records no authored value (which
    // the judge then treats as broken) rather than a silent -5.
    for (const written of ["-5", "0"]) {
      const [c] = parseBody(claim("fold_spread", written)).claims;
      expect(c.expectedValue).toBeNull();
    }
  });

  it("still rejects an unknown select", () => {
    const { errors } = parseBody(claim("fold_spred", "5x"));
    expect(errors.some((e) => e.message.includes("unknown select"))).toBe(true);
  });
});

describe("judging a fold-spread claim", () => {
  const within = { kind: "percent" as const, amount: 15 };

  it("verifies when the interquartile spread is within tolerance", () => {
    const v = judge(
      { value: 5.07, unit: null },
      { value: 5.073, unit: null },
      within,
    );
    expect(v.verdict).toBe("verified");
  });

  it("drifts when the labs agree less than the author claimed", () => {
    const v = judge(
      { value: 5.07, unit: null },
      { value: 9.0, unit: null },
      within,
    );
    expect(v.verdict).toBe("drifted");
  });

  it("breaks when the cell has no interquartile spread to report", () => {
    // Too few measurements for quartiles: the observed value is null, and an
    // agreement claim on it cannot be honestly verified.
    const v = judge({ value: 5.07, unit: null }, { value: null, unit: null }, within);
    expect(v.verdict).toBe("broken");
  });
});
