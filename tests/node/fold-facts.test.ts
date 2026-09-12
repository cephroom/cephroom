import { describe, expect, it } from "vitest";

import { foldForScope } from "../../node/fold-facts";

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
