import { describe, expect, it } from "vitest";

import { parseBody } from "./syntax";

function claim(value: string, select = "censored_fraction") {
  return [
    "{{claim:cens}}",
    "",
    "```claim cens",
    "dataset: receptorome-ki",
    "metric: median_ki_nm",
    "subject: DRD2",
    "object: aripiprazole",
    `select: ${select}`,
    `value: ${value}`,
    "tolerance: 20%",
    "```",
  ].join("\n");
}

describe("censored_fraction grammar", () => {
  it("is accepted as a select", () => {
    expect(parseBody(claim("0.07")).errors).toEqual([]);
  });

  it("reads a bare fraction as itself", () => {
    const [c] = parseBody(claim("0.07")).claims;
    expect(c.expectedValue).toBeCloseTo(0.07);
    expect(c.expectedUnit).toBeNull();
  });

  it("reads a percentage as a fraction", () => {
    const [c] = parseBody(claim("7%")).claims;
    expect(c.expectedValue).toBeCloseTo(0.07);
    expect(c.expectedUnit).toBeNull();
  });

  it("accepts the whole-cell ceiling case, 100%", () => {
    const [c] = parseBody(claim("100%")).claims;
    expect(c.expectedValue).toBeCloseTo(1);
  });

  it("rejects a value outside [0, 1] as not a fraction", () => {
    for (const written of ["1.5", "150%", "-0.1"]) {
      const [c] = parseBody(claim(written)).claims;
      expect(c.expectedValue).toBeNull();
    }
  });
});
