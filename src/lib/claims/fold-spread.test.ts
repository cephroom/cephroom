import { describe, expect, it } from "vitest";

import { parseBody } from "./syntax";
import { judge } from "./verdict";


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
    for (const written of ["5.07x", "5.07-fold", "5.07×", "5.07", "×5.07", "x5.07"]) {
      const [c] = parseBody(claim("fold_spread_iqr", written)).claims;
      expect(c.expectedValue).toBeCloseTo(5.07);
      expect(c.expectedUnit).toBeNull();
    }
  });

  it("rejects a nonsensical non-positive fold ratio", () => {
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
    const v = judge({ value: 5.07, unit: null }, { value: null, unit: null }, within);
    expect(v.verdict).toBe("broken");
  });
});
