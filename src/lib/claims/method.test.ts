import { describe, expect, it } from "vitest";

import { methodSpread, methodsOf, selectByMethod } from "./method";


const ki = [{ method: null, value: 1.549 }];

const decoders = [
  { method: "offline", value: 59.45 },
  { method: "online", value: 70.0 },
];

describe("a dataset with one analysis behaves exactly as before", () => {
  it("resolves a claim that names no method", () => {
    const result = selectByMethod(ki, null);
    expect(result.kind).toBe("resolved");
    expect(result.kind === "resolved" && result.fact.value).toBe(1.549);
  });

  it("resolves a claim whose method line is empty or whitespace", () => {
    expect(selectByMethod(ki, "").kind).toBe("resolved");
    expect(selectByMethod(ki, "   ").kind).toBe("resolved");
  });

  it("refuses a claim that asks for a method the cell does not have", () => {
    const result = selectByMethod(ki, "online");
    expect(result.kind).toBe("unknown");
  });

  it("is missing, not ambiguous, when nothing matches the rest of the query", () => {
    expect(selectByMethod([], null).kind).toBe("missing");
    expect(selectByMethod([], "online").kind).toBe("missing");
  });
});

describe("a cell with several analyses will not answer an unqualified claim", () => {
  it("resolves broken-as-ambiguous rather than choosing", () => {
    const result = selectByMethod(decoders, null);
    expect(result.kind).toBe("ambiguous");
  });

  it("names the analyses that exist, so the error can teach", () => {
    const result = selectByMethod(decoders, null);
    expect(result.kind === "ambiguous" && result.methods).toEqual([
      "offline",
      "online",
    ]);
  });

  it("never averages them", () => {
    const result = selectByMethod(decoders, null);
    expect(result.kind).not.toBe("resolved");
  });

  it("resolves once the claim names one", () => {
    const result = selectByMethod(decoders, "online");
    expect(result.kind === "resolved" && result.fact.value).toBe(70.0);
  });

  it("matches a method name case- and space-insensitively", () => {
    expect(
      selectByMethod(decoders, "  Online ").kind === "resolved" &&
        selectByMethod(decoders, "  Online ").kind,
    ).toBe("resolved");
  });

  it("still refuses a method that is not there, and says what is", () => {
    const result = selectByMethod(decoders, "cross-session");
    expect(result.kind).toBe("unknown");
    expect(result.kind === "unknown" && result.methods).toEqual([
      "offline",
      "online",
    ]);
  });

  it("answers when several rows are all the same analysis", () => {
    const repeated = [
      { method: "online", value: 70.0 },
      { method: "online", value: 70.0 },
    ];
    expect(selectByMethod(repeated, null).kind).toBe("resolved");
  });
});

describe("methodsOf", () => {
  it("lists named methods in document order without duplicates", () => {
    expect(
      methodsOf([
        { method: "online" },
        { method: "offline" },
        { method: "online" },
      ]),
    ).toEqual(["online", "offline"]);
  });

  it("ignores unnamed analyses", () => {
    expect(methodsOf([{ method: null }, { method: "online" }])).toEqual([
      "online",
    ]);
  });
});

describe("methodSpread — how far the pipelines disagree", () => {
  it("is the ratio of the widest pair", () => {
    expect(methodSpread(decoders)).toBeCloseTo(70.0 / 59.45, 6);
  });

  it("is null when there is nothing to compare", () => {
    expect(methodSpread([{ method: "online", value: 70 }])).toBeNull();
    expect(methodSpread(ki)).toBeNull();
    expect(methodSpread([])).toBeNull();
  });

  it("refuses a non-positive value rather than inventing a ratio", () => {
    expect(
      methodSpread([
        { method: "a", value: 0 },
        { method: "b", value: 10 },
      ]),
    ).toBeNull();
    expect(
      methodSpread([
        { method: "a", value: -3 },
        { method: "b", value: 10 },
      ]),
    ).toBeNull();
  });

  it("ignores an unnamed analysis rather than mixing it in", () => {
    expect(
      methodSpread([
        { method: null, value: 1 },
        { method: "online", value: 70 },
      ]),
    ).toBeNull();
  });

  it("takes the extremes across more than two analyses", () => {
    expect(
      methodSpread([
        { method: "a", value: 50 },
        { method: "b", value: 70 },
        { method: "c", value: 60 },
      ]),
    ).toBeCloseTo(70 / 50, 6);
  });
});
