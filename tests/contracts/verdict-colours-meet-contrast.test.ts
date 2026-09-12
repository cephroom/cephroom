import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT } from "./scan";

/**
 * WCAG 1.4.3, measured rather than eyeballed.
 *
 * The verdict colours are read as text on their own wash - "1.55 nM" in green
 * on a green tint, a drifted value in amber on amber. If any of those falls
 * below 4.5:1 the number a reader came to check is the hardest thing on the
 * page to read, and for low-vision readers that is on the core feature.
 *
 * Today every pair clears it comfortably in both themes; this locks that in.
 * Contrast is invisible to code review, so a token nudged a shade lighter would
 * regress a WCAG requirement with nothing to catch it - exactly the "a rule
 * that stopped holding looks like one passing" case this suite is built around.
 */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const channel = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const css = readFileSync(join(ROOT, "src", "app", "globals.css"), "utf8");

/** The light palette is the bare :root; the dark one is the [data-theme] block. */
function tokens(scope: "light" | "dark"): Record<string, string> {
  const start =
    scope === "light"
      ? css.indexOf(":root {")
      : css.indexOf('[data-theme="dark"]');
  expect(start, `no ${scope} palette block`).toBeGreaterThan(-1);
  const block = css.slice(start, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

const PAIRS: [string, string][] = [
  ["verified", "verified-wash"],
  ["drifted", "drifted-wash"],
  ["broken", "broken-wash"],
  ["counter", "counter-wash"],
  ["stale", "stale-wash"],
];

const AA_NORMAL = 4.5;

describe.each(["light", "dark"] as const)("verdict colours in the %s theme", (scope) => {
  const t = tokens(scope);

  it.each(PAIRS)("%s text on its wash clears AA for normal text", (fg, bg) => {
    expect(t[fg], `--${fg} missing in ${scope}`).toBeTruthy();
    expect(t[bg], `--${bg} missing in ${scope}`).toBeTruthy();
    const ratio = contrast(t[fg], t[bg]);
    expect(
      ratio,
      `--${fg} on --${bg} is ${ratio.toFixed(2)}:1 in ${scope}, below ${AA_NORMAL}:1. The value a reader came to check must not be the hardest thing to read.`,
    ).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it("body ink on paper clears AA", () => {
    expect(contrast(t.ink, t.paper)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe("the contrast maths is itself correct", () => {
  it("scores black on white at the known 21:1", () => {
    expect(Math.round(contrast("#000000", "#ffffff"))).toBe(21);
  });

  it("scores a colour against itself at 1:1", () => {
    expect(contrast("#0f6b45", "#0f6b45")).toBeCloseTo(1, 5);
  });

  it("would fail a wash-on-wash near-miss", () => {
    // A verdict colour lightened to near its own wash must fall below AA, or
    // the guard is not actually measuring anything.
    expect(contrast("#a9c9b8", "#e2f0e8")).toBeLessThan(AA_NORMAL);
  });
});
