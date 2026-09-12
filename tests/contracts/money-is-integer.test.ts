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

/**
 * Money is an integer count of the smallest currency unit. Always.
 *
 * This rule had no trace in the repository — not in a test, not in a comment,
 * not in any version of the documentation. The only money arithmetic that
 * ever existed here was `src/lib/earnings/units.ts`, and it was float:
 *
 *     export const CONTRIBUTOR_SHARE = 0.7;
 *     export const MINOR_PER_UNIT = 0.1;
 *     export function payoutMinor(units) { return units * MINOR_PER_UNIT; }
 *
 * with an invariant asserted as `payout <= intake` and no tolerance. That
 * module was deleted wholesale when metering was removed, so the rule is
 * currently satisfied by there being almost no money code left — which is not
 * the same as being enforced, and would not survive the next feature that
 * needs to multiply a price by anything.
 *
 * The specific failure worth remembering: an invariant of the form "payout
 * never exceeds intake" is exactly the kind that a float breaks by 2e-14, in
 * the direction of overpaying, on one price point out of five. An invariant
 * that needs a tolerance is not an invariant, and the tolerance is what
 * somebody reaches for when the assertion fails at 15 significant figures.
 */

/** Modules that hold or compute an amount of money. */
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
      // A monthly equivalent is a division, and the one place a fraction could
      // escape into a number that is later treated as money. It is rounded to
      // a whole minor unit before it becomes anything, and it is a string by
      // the time it leaves.
      expect(typeof monthlyEquivalent(DISCOVERY_PLANS[planId])).toBe("string");
      expect(Number.isSafeInteger(annualSavingMonths(DISCOVERY_PLANS[planId]))).toBe(true);
    }
  });

  it("divides only to render, and returns a string when it does", () => {
    // `formatPrice` is the single permitted division: minor units to a
    // display string. Its output is text and can never be multiplied by
    // anything, which is what makes the float it creates harmless.
    expect(formatPrice(900)).toBe("$9");
    expect(formatPrice(1250)).toBe("$12.50");
    expect(formatPrice(2900)).toBe("$29");
    expect(typeof formatPrice(1)).toBe("string");
  });

  it("renders every whole number of cents without losing one", () => {
    // The property rather than three examples. If `/100` ever produced a
    // representation that rounded a cent away, this finds it.
    for (let minor = 0; minor <= 5000; minor += 1) {
      const rendered = formatPrice(minor);
      const backToMinor = Math.round(
        Number.parseFloat(rendered.replace("$", "")) * 100,
      );
      expect(backToMinor, `formatPrice(${minor}) rendered ${rendered}`).toBe(minor);
    }
  });

  it("writes no fractional numeric literal in a money module", () => {
    // `0.7` and `0.1` are how the last one started. A share, a rate or a
    // per-unit price written as a decimal is a float with a currency symbol
    // in front of it.
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
    // Named rather than pattern-matched, because these are the exact
    // identifiers that existed and the exact ones a reimplementation would
    // reach for first.
    const banned = [
      "MINOR_PER_UNIT",
      "CONTRIBUTOR_SHARE",
      "PLATFORM_SHARE",
      "unitsForAmount",
      "payoutMinor",
    ];

    for (const file of [...walk(join(ROOT, "src")), ...walk(join(ROOT, "node"))]) {
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
    // The shape of the bug, not its name: `amount * 0.7` is the line that
    // produced 2029.9999999999998 from an intake of 2900.
    const offenders: string[] = [];
    for (const file of [...walk(join(ROOT, "src")), ...walk(join(ROOT, "node"))]) {
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
    // The concrete failure, kept executable. Both sides are "the same"
    // arithmetic; one of them overpays.
    const intakeMinor = 2900;

    const asFloat = intakeMinor * 0.7;
    const asInteger = Math.floor((intakeMinor * 7) / 10);

    expect(asInteger).toBe(2030);
    // Off by a hair, and on the wrong side of it. Against an invariant
    // written `payout <= intake * share` this is the difference between
    // holding and needing a tolerance.
    expect(asFloat).not.toBe(2030);
    expect(asFloat).toBeLessThan(2030);
    expect(Number.isSafeInteger(asFloat)).toBe(false);
  });
});
