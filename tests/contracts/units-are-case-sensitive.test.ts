import { describe, expect, it } from "vitest";

import { judge } from "@/lib/claims/verdict";

/**
 * A unit's case carries its meaning, so the judge must not fold it away.
 *
 * SI is explicit: nM is nanomolar (a concentration), nm is nanometre (a
 * length); mM is millimolar, mm is millimetre; M is molar, m is metre. The
 * capital letter is not decoration. This platform's flagship dataset is Ki in
 * nM, so a check that treats "nm" and "nM" as the same unit would silently
 * accept a length where a concentration was claimed - on exactly the content it
 * exists to check.
 *
 * The judge already refuses to convert between units and calls a mismatch
 * broken. Lowercasing the unit before comparing quietly undid that for the one
 * class of mismatch a pharmacology reader most needs caught.
 */
const pct = (amount: number) => ({ kind: "percent" as const, amount });

describe("the judge distinguishes units that differ only in case", () => {
  it("calls nM against nm a broken unit mismatch, not a pass", () => {
    const result = judge(
      { value: 1.5, unit: "nM" },
      { value: 1.5, unit: "nm" },
      pct(10),
    );
    expect(result.verdict).toBe("broken");
    expect(result.note).toMatch(/unit/i);
  });

  it("distinguishes millimolar from millimetre", () => {
    expect(
      judge({ value: 5, unit: "mM" }, { value: 5, unit: "mm" }, pct(10)).verdict,
    ).toBe("broken");
  });

  it("distinguishes molar from metre", () => {
    expect(
      judge({ value: 1, unit: "M" }, { value: 1, unit: "m" }, pct(10)).verdict,
    ).toBe("broken");
  });

  it("still passes a genuine same-unit match", () => {
    expect(
      judge({ value: 1.5, unit: "nM" }, { value: 1.55, unit: "nM" }, pct(10))
        .verdict,
    ).toBe("verified");
  });

  it("still ignores surrounding whitespace, which carries no meaning", () => {
    expect(
      judge({ value: 1.5, unit: " nM " }, { value: 1.55, unit: "nM" }, pct(10))
        .verdict,
    ).toBe("verified");
  });

  it("still treats a missing unit on both sides as a match", () => {
    expect(
      judge({ value: 8.8, unit: null }, { value: 8.85, unit: null }, {
        kind: "absolute",
        amount: 0.1,
      }).verdict,
    ).toBe("verified");
  });
});
