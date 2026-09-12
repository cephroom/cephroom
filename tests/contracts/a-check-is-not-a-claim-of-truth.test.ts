import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsAndStrings } from "./scan";

/**
 * The honesty contract, applied to the badge that is the whole product.
 *
 * A green check means the sentence's number matches the dataset the author
 * serves, from the author's own machine. That is a reproducibility check, not a
 * validity one - the "reproducible but wrong" distinction. Its real value is
 * transparency and drift-detection, and a reader who reads the check as "this
 * number is true" has been told something the platform cannot know.
 *
 * The platform's own stance (from /privacy) is that overclaiming is worse than
 * claiming none, because someone acts on the strength of it. So the reader is
 * told what a check does establish and, in the same breath, what it does not.
 */
function page(...parts: string[]): string {
  return readFileSync(join(ROOT, "src", "app", ...parts), "utf8")
    .replace(/&rsquo;|&#39;|&apos;/g, "'")
    .replace(/&mdash;/g, "-")
    .replace(/\s+/g, " ");
}

describe("the reader is told a check is against the author's own data", () => {
  it("says so where the check result is shown", () => {
    const reader = readFileSync(
      join(ROOT, "src", "components", "column-reader.tsx"),
      "utf8",
    )
      .replace(/&rsquo;|&#39;|&apos;/g, "'")
      .replace(/\s+/g, " ");

    expect(
      reader,
      [
        "The status section says 'checked in your browser'. It must also say what",
        "the check was against: the dataset the author themselves serves. Without",
        "that, 'verified against 104 measurements @ChEMBL_37' reads as an appeal",
        "to an external authority the platform never consulted.",
      ].join("\n"),
    ).toMatch(/author'?s own|the author serves|their own data|the dataset.{0,30}serves/i);
  });

  it("does not call a checked number correct, true, or validated", () => {
    const reader = stripCommentsAndStrings(
      readFileSync(join(ROOT, "src", "components", "column-reader.tsx"), "utf8"),
    );
    const badge = stripCommentsAndStrings(
      readFileSync(join(ROOT, "src", "components", "check-badge.tsx"), "utf8"),
    );
    for (const claimword of [/\bis correct\b/i, /\bis true\b/i, /\bvalidated\b/i, /\bproven\b/i, /\bconfirmed true\b/i]) {
      expect(reader, `reader implies a check means ${claimword}`).not.toMatch(claimword);
      expect(badge, `badge implies a check means ${claimword}`).not.toMatch(claimword);
    }
  });
});

describe("how-it-works states the self-certification limit", () => {
  const full = page("how-it-works", "page.tsx");
  // Scope to the limits section, so a coincidental "their own machine" in the
  // architecture section cannot satisfy a claim about what a check does NOT do.
  const howItWorks = full.slice(full.indexOf("What this does not do"));

  it("still says a green column can draw an unsupported conclusion", () => {
    expect(howItWorks).toMatch(/does not check reasoning/i);
  });

  it("says the dataset is the author's own, so a check is consistency not truth", () => {
    expect(
      howItWorks,
      [
        "The 'what this does not do' section names two limits - reasoning and",
        "data quality - and omits the sharpest: the data checked against is the",
        "author's, served from the author's machine. A check confirms the",
        "sentence is consistent with the data the author stands behind. It is not",
        "an independent verdict on whether either is right.",
      ].join("\n"),
    ).toMatch(/author'?s own data|their own machine|data the author (serves|stands behind)|self-consistent|not an independent/i);
  });

  it("frames the value as catching drift and enabling scrutiny, not as validation", () => {
    expect(howItWorks).toMatch(/silent[- ]rot|drift|transparen|examine|scrutin|see the (data|evidence)/i);
  });
});
