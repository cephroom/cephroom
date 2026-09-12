import { describe, expect, it } from "vitest";

import {
  formatValue,
  parseBody,
  parseMeasurement,
  referencedKeys,
} from "./syntax";

const CLAIM = [
  "```claim hal-d2",
  "dataset: receptorome-ki",
  "metric: median_ki_nm",
  "subject: DRD2",
  "object: haloperidol",
  "value: 1.549 nM",
  "tolerance: 10%",
  "```",
].join("\n");

describe("parseBody", () => {
  it("lifts claim blocks out of the prose", () => {
    const { prose, claims, errors } = parseBody(
      `Haloperidol binds D2 at {{claim:hal-d2}}.\n\n${CLAIM}\n`,
    );

    expect(errors).toEqual([]);
    expect(claims).toHaveLength(1);
    expect(prose).toBe("Haloperidol binds D2 at {{claim:hal-d2}}.");
    expect(prose).not.toContain("```claim");
  });

  it("parses every field of a claim", () => {
    const [claim] = parseBody(`{{claim:hal-d2}}\n\n${CLAIM}`).claims;

    expect(claim).toMatchObject({
      key: "hal-d2",
      datasetSlug: "receptorome-ki",
      metric: "median_ki_nm",
      subject: "DRD2",
      object: "haloperidol",
      scope: "all",
      select: "value",
      expectedValue: 1.549,
      expectedUnit: "nM",
      tolerance: { kind: "percent", amount: 10 },
    });
  });

  it("defaults scope, select and tolerance", () => {
    const body = [
      "{{claim:x}}",
      "",
      "```claim x",
      "dataset: d",
      "metric: m",
      "subject: s",
      "object: o",
      "value: 4",
      "```",
    ].join("\n");

    const [claim] = parseBody(body).claims;
    expect(claim.scope).toBe("all");
    expect(claim.select).toBe("value");
    expect(claim.tolerance).toEqual({ kind: "percent", amount: 10 });
    expect(claim.expectedUnit).toBeNull();
  });

  it("reads an absolute tolerance", () => {
    const body = [
      "{{claim:x}}",
      "",
      "```claim x",
      "dataset: d",
      "metric: median_pki",
      "subject: s",
      "object: o",
      "value: 8.81",
      "tolerance: 0.15",
      "```",
    ].join("\n");

    expect(parseBody(body).claims[0].tolerance).toEqual({
      kind: "absolute",
      amount: 0.15,
    });
  });

  it("reports a claim block that is missing required fields", () => {
    const body = ["{{claim:x}}", "", "```claim x", "dataset: d", "```"].join("\n");
    const { claims, errors } = parseBody(body);

    expect(claims).toHaveLength(0);
    expect(errors[0].message).toContain("missing");
    expect(errors[0].message).toContain("metric");
  });

  it("reports a reference with no definition", () => {
    const { errors } = parseBody("Binds at {{claim:ghost}}.");
    expect(errors).toHaveLength(1);
    expect(errors[0].key).toBe("ghost");
    expect(errors[0].message).toContain("no claim block defines it");
  });

  it("reports a definition nothing references", () => {
    const { errors } = parseBody(`No references here.\n\n${CLAIM}`);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("never referenced");
  });

  it("reports a duplicate key rather than silently keeping one", () => {
    const { claims, errors } = parseBody(
      `{{claim:hal-d2}}\n\n${CLAIM}\n\n${CLAIM}`,
    );
    expect(claims).toHaveLength(1);
    expect(errors.some((e) => e.message.includes("more than once"))).toBe(true);
  });

  it("keeps a claim reference that sits inside a table cell", () => {
    const body = [
      "| Compound | Ki |",
      "| --- | --- |",
      "| Haloperidol | {{claim:hal-d2}} |",
      "",
      CLAIM,
    ].join("\n");

    const { prose, errors } = parseBody(body);
    expect(errors).toEqual([]);
    expect(prose).toContain("| Haloperidol | {{claim:hal-d2}} |");
  });

  it("does not leave a blank gap where a block was removed", () => {
    const body = `First.\n\n${CLAIM}\n\nSecond.`;
    expect(parseBody(body).prose).toBe("First.\n\nSecond.");
  });

  it("parses a body that arrived with CRLF line endings", () => {
    // HTML normalises textarea values to CRLF on form submission. Before this
    // was handled, saving from the studio silently recorded zero claims while
    // the live preview - which passes the string directly - showed them all.
    const body = `Binds at {{claim:hal-d2}}.\n\n${CLAIM}\n`.replace(
      /\n/g,
      "\r\n",
    );
    const { claims, errors } = parseBody(body);

    expect(errors).toEqual([]);
    expect(claims).toHaveLength(1);
    expect(claims[0].expectedValue).toBe(1.549);
    expect(claims[0].expectedUnit).toBe("nM");
  });

  it("parses a body with lone carriage returns", () => {
    const body = `Binds at {{claim:hal-d2}}.\n\n${CLAIM}\n`.replace(/\n/g, "\r");
    expect(parseBody(body).claims).toHaveLength(1);
  });
});

describe("referencedKeys", () => {
  it("deduplicates and preserves document order", () => {
    expect(referencedKeys("{{claim:b}} {{claim:a}} {{claim:b}}")).toEqual([
      "b",
      "a",
    ]);
  });
});

describe("parseMeasurement", () => {
  it.each([
    ["1.549 nM", 1.549, "nM"],
    ["104.1nM", 104.1, "nM"],
    ["93", 93, null],
    ["8.81", 8.81, null],
    ["-0.5 log units", -0.5, "log units"],
    ["2.3e-4 M", 2.3e-4, "M"],
  ])("reads %s", (input, value, unit) => {
    expect(parseMeasurement(input)).toEqual({ value, unit });
  });

  it("returns nulls for something that is not a measurement", () => {
    expect(parseMeasurement("about a nanomolar")).toEqual({
      value: null,
      unit: null,
    });
  });
});

describe("formatValue", () => {
  it.each([
    [1.5491933, "nM", "1.55 nM"],
    [104.14883, "nM", "104.1 nM"],
    [3175.2, "nM", "3175 nM"],
    [0.5, "nM", "0.5 nM"],
    [93, null, "93"],
    [0.0031, null, "0.0031"],
  ])("formats %s", (value, unit, expected) => {
    expect(formatValue(value, unit)).toBe(expected);
  });

  it("renders an em dash for a missing value", () => {
    expect(formatValue(null)).toBe("—");
    expect(formatValue(Number.NaN)).toBe("—");
  });
});

describe("the method line", () => {
  const withMethod = [
    "```claim tcnet-online",
    "dataset: mi-decoders-2025",
    "metric: accuracy_pct",
    "subject: EEG-TCNet",
    "object: four-class-motor-imagery",
    "method: online",
    "value: 70.0 %",
    "tolerance: 2%",
    "```",
  ].join("\n");

  it("parses a method when one is given", () => {
    const { claims } = parseBody(withMethod);
    expect(claims[0].method).toBe("online");
  });

  it("leaves method null when the line is absent", () => {
    // Emphatically not "all". An absent analysis is absent; the resolver
    // decides what that means, and for a multi-analysis cell it means broken.
    const { claims } = parseBody(withMethod.replace("method: online\n", ""));
    expect(claims[0].method).toBeNull();
  });

  it("trims but does not lowercase the method name", () => {
    // Matching is case-insensitive at resolution time; the name is preserved
    // as written so an error message can quote the author back to themselves.
    const { claims } = parseBody(
      withMethod.replace("method: online", "method:   Online  "),
    );
    expect(claims[0].method).toBe("Online");
  });

  it("accepts method_spread as a select", () => {
    const { claims, errors } = parseBody(
      withMethod
        .replace("method: online\n", "")
        .replace("value: 70.0 %", "select: method_spread\nvalue: 1.18x"),
    );
    // The fixture is a bare block with no prose, so the only complaint is the
    // unreferenced key — nothing about the select itself.
    expect(errors.map((error) => error.message)).toEqual([
      'Claim "tcnet-online" is defined but never referenced in the prose.',
    ]);
    expect(claims[0].select).toBe("method_spread");
    // A ratio, so the fold parsing applies: no unit, notation dropped.
    expect(claims[0].expectedValue).toBeCloseTo(1.18, 6);
    expect(claims[0].expectedUnit).toBeNull();
  });

  it("rejects a non-positive method spread, like the other ratios", () => {
    const { claims } = parseBody(
      withMethod
        .replace("method: online\n", "")
        .replace("value: 70.0 %", "select: method_spread\nvalue: -2x"),
    );
    expect(claims[0].expectedValue).toBeNull();
  });
});
