import { describe, expect, it } from "vitest";

import { FOLD_SELECTS, isFoldSelect, parseBody } from "./syntax";

/**
 * pdsp_fold — the fold difference between ChEMBL's median and the independent
 * PDSP Ki Database's, for the same target and compound. A claim that a second,
 * separate database reproduces the number; near 1× is agreement. It reuses the
 * fold-select machinery, so this test mostly guards that wiring.
 */
function claim(value: string) {
  return [
    "{{claim:x}}",
    "",
    "```claim x",
    "dataset: receptorome-ki",
    "metric: median_ki_nm",
    "subject: DRD2",
    "object: clozapine",
    "scope: all",
    "select: pdsp_fold",
    `value: ${value}`,
    "tolerance: 20%",
    "```",
  ].join("\n");
}

describe("pdsp_fold grammar", () => {
  it("is a fold select, so it inherits ratio handling", () => {
    expect(FOLD_SELECTS).toContain("pdsp_fold");
    expect(isFoldSelect("pdsp_fold")).toBe(true);
  });

  it("parses as a bare ratio in any notation", () => {
    for (const written of ["1.33x", "1.33×", "1.33", "×1.33"]) {
      const [c] = parseBody(claim(written)).claims;
      expect(c.expectedValue).toBeCloseTo(1.33);
      expect(c.expectedUnit).toBeNull();
    }
  });

  it("rejects a non-positive ratio", () => {
    expect(parseBody(claim("0")).claims[0].expectedValue).toBeNull();
    expect(parseBody(claim("-2")).claims[0].expectedValue).toBeNull();
  });
});
