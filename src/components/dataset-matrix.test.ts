import { describe, expect, it } from "vitest";

import { describeAgreement } from "./dataset-matrix";

/**
 * The matrix labels each cell's interquartile fold spread as tight / mixed /
 * loose against this dataset's own quartiles. The label is the signal; the
 * colour only reinforces it. These tests hold the thresholds and, more
 * importantly, the invariant that every band carries a word — so a reader
 * who cannot see the colour still knows how well the labs agree.
 */
describe("describeAgreement", () => {
  it("calls tight agreement below ~2.5x", () => {
    expect(describeAgreement(1).word).toBe("tight");
    expect(describeAgreement(2.5).word).toBe("tight");
  });

  it("calls the middle band mixed", () => {
    expect(describeAgreement(2.51).word).toBe("mixed");
    expect(describeAgreement(4).word).toBe("mixed");
  });

  it("calls wide disagreement loose", () => {
    expect(describeAgreement(4.01).word).toBe("loose");
    expect(describeAgreement(140).word).toBe("loose");
  });

  it("always pairs a word with a tone, never a tone alone", () => {
    for (const fold of [1, 2.5, 3, 5, 50]) {
      const { word, tone } = describeAgreement(fold);
      expect(word.length).toBeGreaterThan(0);
      expect(tone).toContain("text-");
    }
  });
});
