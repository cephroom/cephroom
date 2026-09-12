import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT } from "./contracts/scan";

/**
 * WCAG AA, recomputed from the stylesheet on every run.
 *
 * A palette is verified once when it is designed and then quietly broken by
 * the next person who nudges a hex to taste. This test reads the real token
 * values out of `globals.css` and recalculates every text-on-background pair
 * the components can actually produce, in both themes.
 *
 * It is not decoration. The previous palette rendered `text-white` on a bright
 * dark-mode accent at 2.3:1 — every primary button on the site, failing AA by
 * a factor of two — and nothing caught it, because nothing was looking.
 *
 * Thresholds: 4.5:1 for body text, 3:1 for large text and non-text graphics
 * (WCAG 2.1 SC 1.4.3 / 1.4.11).
 */

const AA_TEXT = 4.5;
const AA_LARGE = 3;

/* ------------------------------------------------------------------ *
 * Relative luminance, per WCAG 2.1
 * ------------------------------------------------------------------ */

function channels(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/* ------------------------------------------------------------------ *
 * Reading the tokens out of the real stylesheet
 * ------------------------------------------------------------------ */

const CSS = readFileSync(join(ROOT, "src", "app", "globals.css"), "utf8");

/**
 * Pulls one theme's tokens out of a block.
 *
 * `:root` is the light theme. The dark theme is written twice on purpose —
 * once under `prefers-color-scheme` and once under `[data-theme="dark"]` — so
 * both are read and asserted identical, which is the property that makes the
 * toggle and the system preference agree.
 */
function tokensIn(blockStart: string): Record<string, string> {
  const start = CSS.indexOf(blockStart);
  if (start === -1) throw new Error(`No block matching ${blockStart}`);
  const open = CSS.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < CSS.length; i += 1) {
    if (CSS[i] === "{") depth += 1;
    if (CSS[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = CSS.slice(open, end);
  const out: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(
    /--([a-z-]+):\s*(#[0-9a-fA-F]{3,8});/g,
  )) {
    out[name] = value.toLowerCase();
  }
  return out;
}

const LIGHT = tokensIn(":root {");
const DARK_SYSTEM = tokensIn(':root:not([data-theme="light"])');
const DARK_EXPLICIT = tokensIn(':root[data-theme="dark"]');

const SURFACES = ["paper", "paper-raised", "paper-sunken"] as const;

/** Foregrounds that carry body-sized text, and must clear 4.5:1. */
const BODY_TEXT = [
  "ink",
  "ink-muted",
  "ink-faint",
  "accent",
  "accent-hover",
  "counter",
  "counter-hover",
  "verified",
  "drifted",
  "broken",
  "stale",
] as const;

/** Foreground / its own wash: the chip pattern, `text-x bg-x-wash`. */
const WASHED = [
  "accent",
  "counter",
  "verified",
  "drifted",
  "broken",
  "stale",
] as const;

/** A fill and the ink that sits on it. Buttons, badges, pills. */
const FILLS = [
  ["accent", "accent-ink"],
  ["accent-hover", "accent-ink"],
  ["counter", "counter-ink"],
] as const;

const THEMES = [
  ["light", LIGHT],
  ["dark", DARK_SYSTEM],
] as const;

describe("the two dark-theme blocks cannot drift apart", () => {
  it("defines identical tokens under the media query and the attribute", () => {
    expect(DARK_EXPLICIT).toEqual(DARK_SYSTEM);
  });

  it("defines every light token in dark too, so no colour falls back", () => {
    // A token defined only on :root keeps its light value in dark mode, which
    // is how a palette ends up with one stranded colour nobody notices.
    expect(Object.keys(DARK_SYSTEM).sort()).toEqual(
      Object.keys(LIGHT)
        .filter((name) => !LIGHT[name].startsWith("var"))
        .sort(),
    );
  });
});

describe.each(THEMES)("WCAG AA in %s", (theme, tokens) => {
  it("has every token it needs", () => {
    for (const name of [...SURFACES, ...BODY_TEXT]) {
      expect(tokens[name], `${theme}: --${name} is missing`).toBeDefined();
    }
  });

  it.each(BODY_TEXT)("%s clears 4.5:1 on every surface", (foreground) => {
    for (const surface of SURFACES) {
      const ratio = contrast(tokens[foreground], tokens[surface]);
      expect(
        Math.round(ratio * 100) / 100,
        `${theme}: --${foreground} on --${surface}`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it.each(WASHED)("%s clears 4.5:1 on its own wash", (name) => {
    const ratio = contrast(tokens[name], tokens[`${name}-wash`]);
    expect(
      Math.round(ratio * 100) / 100,
      `${theme}: --${name} on --${name}-wash`,
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(FILLS)("text on a %s fill clears 4.5:1", (fill, ink) => {
    const ratio = contrast(tokens[ink], tokens[fill]);
    expect(
      Math.round(ratio * 100) / 100,
      `${theme}: --${ink} on --${fill}`,
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  /**
   * WCAG 1.4.11: a graphic that carries meaning, and the visual boundary of
   * an interactive control, both need 3:1. A decorative hairline — a table
   * divider, a blockquote bar — does not, and holding one to 3:1 would make
   * the page shout.
   *
   * `--rule` and `--rule-strong` are the decorative tier and are deliberately
   * not checked here. `--field-border` exists precisely because they were
   * once the same token, and the search box was outlined at 1.6:1.
   */
  it("keeps meaningful graphics above the 3:1 non-text bar", () => {
    for (const name of ["accent-bright", "counter-bright"]) {
      const ratio = contrast(tokens[name], tokens.paper);
      expect(
        Math.round(ratio * 100) / 100,
        `${theme}: --${name} on --paper`,
      ).toBeGreaterThanOrEqual(AA_LARGE);
    }
  });

  it("outlines interactive controls at 3:1 on every surface they sit on", () => {
    for (const surface of ["paper", "paper-raised"] as const) {
      const ratio = contrast(tokens["field-border"], tokens[surface]);
      expect(
        Math.round(ratio * 100) / 100,
        `${theme}: --field-border on --${surface}`,
      ).toBeGreaterThanOrEqual(AA_LARGE);
    }
  });

  it("keeps each wash distinguishable from the page it sits on", () => {
    for (const name of WASHED) {
      const ratio = contrast(tokens[`${name}-wash`], tokens.paper);
      expect(
        ratio,
        `${theme}: --${name}-wash is invisible against --paper`,
      ).toBeGreaterThan(1.05);
    }
  });
});

/**
 * Components must name a role, not a colour.
 *
 * This is the rule the previous palette broke. `text-white` on `bg-accent`
 * looks harmless in light mode and is an AA failure in dark mode, because a
 * literal colour cannot follow the theme. The token set now carries
 * `--accent-ink` for exactly this, so the literal has no remaining excuse.
 */
describe("no raw colour literals in components", () => {
  it("never pairs a literal black or white with a themed fill", async () => {
    const { walk, stripCommentsAndStrings } = await import("./contracts/scan");
    const { relative, sep } = await import("node:path");

    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      if (!file.endsWith(".tsx")) continue;
      const source = readFileSync(file, "utf8");
      // Class strings are stripped by the comment scrubber, so match the raw
      // source here — these are Tailwind utilities inside className literals.
      const hits = [
        ...source.matchAll(/\b(text|bg|border)-(white|black)\b/g),
      ].map((m) => m[0]);
      if (hits.length > 0) {
        offenders.push(
          `${relative(ROOT, file).split(sep).join("/")} → ${[...new Set(hits)].join(", ")}`,
        );
      }
      void stripCommentsAndStrings;
    }

    expect(
      offenders,
      `Use a semantic token instead — --accent-ink, --ink, --paper-raised.\n\n${offenders.join("\n")}\n`,
    ).toEqual([]);
  });

  it("never hardcodes a hex colour in a component", () => {
    const offenders: string[] = [];
    for (const file of walkSync(join(ROOT, "src"))) {
      if (!file.endsWith(".tsx")) continue;
      const source = readFileSync(file, "utf8");
      const hits = [...source.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]);
      if (hits.length > 0) offenders.push(`${file} → ${hits.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });
});

function walkSync(dir: string): string[] {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkSync(full));
    else out.push(full);
  }
  return out;
}
