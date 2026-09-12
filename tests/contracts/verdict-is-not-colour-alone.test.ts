import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly } from "./scan";
import { VERDICT_GLYPH } from "@/lib/claims/verdict";

/**
 * WCAG 1.4.1, on the one feature that is the whole product.
 *
 * A Cephroom column's value is that "verified" is legible at a glance. If the
 * only thing separating a verified number from a drifted one, inline in the
 * prose, is a red-or-green dot of identical shape, then for the 8% of men with
 * red-green colour deficiency the glance says nothing - on exactly the sentence
 * they came to check.
 *
 * The screen-reader path is already covered by an sr-only label. This is about
 * the sighted colour-blind reader, for whom that label is invisible and the
 * shape has to carry the meaning.
 */
describe("a verdict is distinguishable without colour", () => {
  it("gives each of the three verdicts a distinct glyph", () => {
    const g = ["verified", "drifted", "broken"].map(
      (k) => VERDICT_GLYPH[k as keyof typeof VERDICT_GLYPH],
    );
    expect(new Set(g).size).toBe(3);
  });

  it("gives each of the four conclusions a distinct glyph, except that passing reads as verified", () => {
    const g = ["passing", "drifted", "broken", "empty"].map(
      (k) => VERDICT_GLYPH[k as keyof typeof VERDICT_GLYPH],
    );
    expect(new Set(g).size).toBe(4);
    expect(VERDICT_GLYPH.passing).toBe(VERDICT_GLYPH.verified);
  });

  it("covers every verdict and conclusion", () => {
    for (const key of ["verified", "drifted", "broken", "empty"]) {
      expect(VERDICT_GLYPH[key as keyof typeof VERDICT_GLYPH]).toBeTruthy();
    }
  });

  it("uses shapes that survive a greyscale render", () => {
    // The glyphs must differ as characters, not merely as coloured dots. A dot
    // is the failure being fixed, so the same-dot-different-colour shape is
    // explicitly not allowed.
    for (const glyph of Object.values(VERDICT_GLYPH)) {
      expect(glyph).not.toBe("");
      expect(glyph, "a round dot is shapeless across verdicts").not.toMatch(/^[•●·]$/);
    }
  });
});

describe("the inline claim chip carries the glyph, not only a coloured dot", () => {
  const chip = stripCommentsOnly(
    readFileSync(join(ROOT, "src", "components", "claim-chip.tsx"), "utf8"),
  );

  it("renders the per-verdict glyph", () => {
    expect(
      chip,
      [
        "The chip must show a shape that differs by verdict. It used a",
        "rounded-full dot whose only per-verdict difference was the colour",
        "class, which is invisible to a red-green colour-blind reader.",
      ].join("\n"),
    ).toContain("VERDICT_GLYPH");
  });

  it("no longer distinguishes verdicts by a same-shaped dot alone", () => {
    // The old marker was `rounded-full ${tone.dot}` where tone.dot was only a
    // background colour. If a rounded dot is still the sole in-chip marker, the
    // fix has regressed.
    const hasGlyph = /VERDICT_GLYPH|glyph/.test(chip);
    expect(hasGlyph).toBe(true);
  });

  it("keeps the screen-reader label, so both audiences are served", () => {
    expect(chip).toMatch(/sr-only/);
  });
});

describe("the status badge carries the glyph too", () => {
  const badge = stripCommentsOnly(
    readFileSync(join(ROOT, "src", "components", "check-badge.tsx"), "utf8"),
  );

  it("renders a per-conclusion glyph beside its text", () => {
    expect(badge).toContain("VERDICT_GLYPH");
  });
});
