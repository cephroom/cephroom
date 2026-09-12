import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsAndStrings, walk } from "./scan";
import {
  DISCOVERY_PLANS,
  DISCOVERY_ORDER,
  SERVING_PLANS,
  SERVING_ORDER,
  formatPrice,
} from "@/lib/stripe/plans";


const MONEY_MODULES = ["src/lib/stripe/plans.ts"];

describe("every amount the platform holds is an integer of minor units", () => {
  it("prices every plan and interval in whole minor units", () => {
    const everyPlan = [
      ...DISCOVERY_ORDER.map((id) => DISCOVERY_PLANS[id]),
      ...SERVING_ORDER.map((id) => SERVING_PLANS[id]),
    ];
    for (const plan of everyPlan) {
      const planId = plan.id;
      if (!plan.prices) continue;
      for (const interval of ["month", "year"] as const) {
        const amount = plan.prices[interval].unitAmount;
        expect(Number.isSafeInteger(amount), `${planId}/${interval} is ${amount}`).toBe(
          true,
        );
        expect(amount).toBeGreaterThan(0);
      }
      if (plan.reduced) {
        expect(Number.isSafeInteger(plan.reduced.unitAmount)).toBe(true);
      }
    }
  });

  it("keeps every derived amount an integer too", async () => {
    const { monthlyEquivalent, annualSavingMonths } = await import(
      "@/lib/stripe/plans"
    );
    for (const planId of DISCOVERY_ORDER) {
      expect(typeof monthlyEquivalent(DISCOVERY_PLANS[planId])).toBe("string");
      expect(Number.isSafeInteger(annualSavingMonths(DISCOVERY_PLANS[planId]))).toBe(true);
    }
  });

  it("divides only to render, and returns a string when it does", () => {
    expect(formatPrice(900)).toBe("$9");
    expect(formatPrice(1250)).toBe("$12.50");
    expect(formatPrice(2900)).toBe("$29");
    expect(typeof formatPrice(1)).toBe("string");
  });

  it("renders every whole number of cents without losing one", () => {
    for (let minor = 0; minor <= 5000; minor += 1) {
      const rendered = formatPrice(minor);
      const backToMinor = Math.round(
        Number.parseFloat(rendered.replace("$", "")) * 100,
      );
      expect(backToMinor, `formatPrice(${minor}) rendered ${rendered}`).toBe(minor);
    }
  });

  it("writes no fractional numeric literal in a money module", () => {
    for (const rel of MONEY_MODULES) {
      const code = stripCommentsAndStrings(
        readFileSync(join(ROOT, ...rel.split("/")), "utf8"),
      );
      const decimals = code.match(/\b\d+\.\d+\b/g) ?? [];
      expect(
        decimals,
        `${rel} contains a fractional literal. Money is counted in minor units; a fraction of one is not a thing the platform can hold.`,
      ).toEqual([]);
    }
  });
});

describe("the float-denominated money model cannot come back", () => {
  it("declares none of the constants the old one was built from", () => {
    const banned = [
      "MINOR_PER_UNIT",
      "CONTRIBUTOR_SHARE",
      "PLATFORM_SHARE",
      "unitsForAmount",
      "payoutMinor",
    ];

    for (const file of [
      ...walk(join(ROOT, "src")),
      ...walk(join(ROOT, "node")),
      ...walk(join(ROOT, "simulated-counterparties")),
    ]) {
      if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
      if (file.includes(".test.")) continue;
      const rel = relative(ROOT, file).split(sep).join("/");
      const code = stripCommentsAndStrings(readFileSync(file, "utf8"));
      for (const name of banned) {
        expect(code, `${rel} declares ${name}`).not.toContain(name);
      }
    }
  });

  it("never multiplies an amount by a fraction anywhere in the platform", () => {
    const offenders: string[] = [];
    for (const file of [
      ...walk(join(ROOT, "src")),
      ...walk(join(ROOT, "node")),
      ...walk(join(ROOT, "simulated-counterparties")),
    ]) {
      if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
      if (file.includes(".test.")) continue;
      const code = stripCommentsAndStrings(readFileSync(file, "utf8"));
      if (/\b(amount|price|minor|cents|total|payout|intake)\w*\s*[*/]\s*\d*\.\d+/i.test(code)) {
        offenders.push(relative(ROOT, file).split(sep).join("/"));
      }
    }
    expect(
      offenders,
      `These scale a money value by a fractional literal.\n${offenders.join("\n")}\n`,
    ).toEqual([]);
  });

  it("demonstrates why, so the rule is not mistaken for fussiness", () => {
    const intakeMinor = 2900;

    const asFloat = intakeMinor * 0.7;
    const asInteger = Math.floor((intakeMinor * 7) / 10);

    expect(asInteger).toBe(2030);
    expect(asFloat).not.toBe(2030);
    expect(asFloat).toBeLessThan(2030);
    expect(Number.isSafeInteger(asFloat)).toBe(false);
  });
});
