import { describe, expect, it } from "vitest";

import { foldForScope } from "../../node/fold-facts";

/**
 * The scope-aware fold join. Human scope must not borrow the all-scope
 * interquartile spread — there is no human-only IQR in the report, so a
 * human-scope fold-IQR claim has to resolve broken rather than quietly
 * checking against a whole-cell number. This is the honesty rule that the
 * reader's "no interquartile spread here" note depends on.
 */
describe("foldForScope", () => {
  const fold = { all: 140.6, iqrAll: 5.07, human: 88.2 };

  it("gives all-scope facts the whole-cell fold and IQR", () => {
    expect(foldForScope(fold, "all")).toEqual({
      foldSpread: 140.6,
      foldSpreadIqr: 5.07,
    });
  });

  it("gives human scope the human fold but NEVER the all-scope IQR", () => {
    expect(foldForScope(fold, "human")).toEqual({
      foldSpread: 88.2,
      foldSpreadIqr: null,
    });
  });

  it("treats any non-human scope as whole-cell", () => {
    // A scope like "rat" is not human, so it is not entitled to a human fold
    // either; it falls back to the whole-cell numbers.
    expect(foldForScope(fold, "rat")).toEqual({
      foldSpread: 140.6,
      foldSpreadIqr: 5.07,
    });
  });

  it("carries nulls through when the cell has no fold at all", () => {
    expect(foldForScope({ all: null, iqrAll: null, human: null }, "all")).toEqual(
      { foldSpread: null, foldSpreadIqr: null },
    );
  });
});
