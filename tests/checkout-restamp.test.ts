import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("simulated checkout re-stamps the key on completion", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/simulated/checkout/page.tsx"),
    "utf8",
  );

  it("imports restampKey", () => {
    expect(source).toMatch(/import\s*\{[^}]*\brestampKey\b[^}]*\}/);
  });

  it("calls restampKey in the pay path", () => {
    const pay = source.slice(
      source.indexOf("async function pay"),
      source.indexOf("async function decline"),
    );
    expect(pay).toContain("restampKey(");
  });

  it("calls restampKey in the declined-card path too", () => {
    const decline = source.slice(source.indexOf("async function decline"));
    expect(decline).toContain("restampKey(");
  });
});
