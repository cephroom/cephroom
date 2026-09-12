import { describe, expect, it } from "vitest";

import { concludeRun, judge } from "./verdict";

const pct = (amount: number) => ({ kind: "percent" as const, amount });
const abs = (amount: number) => ({ kind: "absolute" as const, amount });

describe("judge", () => {
  it("verifies a value inside the tolerance", () => {
    const result = judge(
      { value: 1.549, unit: "nM" },
      { value: 1.6, unit: "nM" },
      pct(10),
    );
    expect(result.verdict).toBe("verified");
    expect(result.deltaPct).toBeCloseTo(3.29, 1);
  });

  it("flags drift beyond the tolerance and signs it", () => {
    const result = judge(
      { value: 3.2, unit: "nM" },
      { value: 4.0, unit: "nM" },
      pct(10),
    );
    expect(result.verdict).toBe("drifted");
    expect(result.deltaPct).toBeCloseTo(25, 5);
    expect(result.note).toContain("10%");
  });

  it("signs a downward move negative", () => {
    const result = judge(
      { value: 4.0, unit: "nM" },
      { value: 3.0, unit: "nM" },
      pct(10),
    );
    expect(result.deltaPct).toBeCloseTo(-25, 5);
  });

  it("treats the tolerance boundary as passing", () => {
    expect(
      judge({ value: 100, unit: "nM" }, { value: 110, unit: "nM" }, pct(10))
        .verdict,
    ).toBe("verified");
    expect(
      judge({ value: 100, unit: "nM" }, { value: 110.1, unit: "nM" }, pct(10))
        .verdict,
    ).toBe("drifted");
  });

  it("honours an absolute tolerance, which is what log-scale metrics need", () => {
    expect(
      judge({ value: 8.81, unit: null }, { value: 8.95, unit: null }, abs(0.1))
        .verdict,
    ).toBe("drifted");
    expect(
      judge({ value: 8.81, unit: null }, { value: 8.88, unit: null }, abs(0.1))
        .verdict,
    ).toBe("verified");
  });

  it("breaks rather than drifts when the query resolves to nothing", () => {
    const result = judge(
      { value: 1.5, unit: "nM" },
      { value: null, unit: null },
      pct(10),
    );
    expect(result.verdict).toBe("broken");
    expect(result.deltaPct).toBeNull();
  });

  it("breaks when the claim never recorded a value to check against", () => {
    expect(
      judge({ value: null, unit: "nM" }, { value: 1.5, unit: "nM" }, pct(10))
        .verdict,
    ).toBe("broken");
  });

  it("breaks on a unit mismatch instead of guessing a conversion", () => {
    const result = judge(
      { value: 1.55, unit: "nM" },
      { value: 1.55, unit: "uM" },
      pct(10),
    );
    expect(result.verdict).toBe("broken");
    expect(result.note).toContain("Unit mismatch");
    expect(result.note).toContain("No conversion");
  });

  it("ignores surrounding whitespace, which carries no meaning", () => {
    expect(
      judge({ value: 1.5, unit: "nM" }, { value: 1.5, unit: " nM " }, pct(10))
        .verdict,
    ).toBe("verified");
  });

  it("treats a unit that differs only in case as a mismatch, because case is meaning", () => {
    // nM (nanomolar) is not nm (nanometre). This test previously asserted the
    // opposite - that "nM" and " nm " matched - which was a scientific-
    // correctness bug: it accepted a length where a concentration was claimed.
    // See units-are-case-sensitive.test.ts and verdict.ts::normaliseUnit.
    expect(
      judge({ value: 1.5, unit: "nM" }, { value: 1.5, unit: "nm" }, pct(10))
        .verdict,
    ).toBe("broken");
  });

  it("treats a missing unit on both sides as a match", () => {
    expect(
      judge({ value: 93, unit: null }, { value: 93, unit: null }, pct(5))
        .verdict,
    ).toBe("verified");
  });

  it("falls back to an absolute comparison when the expected value is zero", () => {
    expect(
      judge({ value: 0, unit: null }, { value: 0, unit: null }, pct(10)).verdict,
    ).toBe("verified");
    expect(
      judge({ value: 0, unit: null }, { value: 40, unit: null }, pct(10))
        .verdict,
    ).toBe("drifted");
  });
});

describe("concludeRun", () => {
  it("reports an empty run", () => {
    expect(concludeRun([])).toBe("empty");
  });

  it("passes only when everything passes", () => {
    expect(concludeRun(["verified", "verified"])).toBe("passing");
  });

  it("lets the worst verdict win", () => {
    expect(concludeRun(["verified", "drifted"])).toBe("drifted");
    expect(concludeRun(["verified", "drifted", "broken"])).toBe("broken");
    expect(concludeRun(["broken"])).toBe("broken");
  });
});
