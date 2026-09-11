import { describe, expect, it } from "vitest";

import { gateColumnBody } from "../../node/column-gate";

/**
 * The paywall boundary. A member column is worth money; the node is the only
 * thing standing between a free-tier key and its full text and Markdown
 * source. These tests exist so that boundary cannot regress silently — a
 * refactor that started returning the source to everyone would turn one of
 * them red.
 */

// Ten short paragraphs, so a 28%-preview leaves most of it hidden.
const BODY = Array.from({ length: 10 }, (_, i) => `Paragraph ${i + 1}.`).join(
  "\n\n",
);

const BODY_WITH_CLAIM = `Intro paragraph.

\`\`\`claim hal-d2
dataset: receptorome-ki
metric: median_ki_nm
subject: DRD2
object: haloperidol
value: 1.549 nM
tolerance: 10%
\`\`\`

Body paragraph after the claim.`;

describe("gateColumnBody — the node paywall", () => {
  it("hands an entitled reader the whole thing", () => {
    const gated = gateColumnBody(BODY, true);
    expect(gated.entitled).toBe(true);
    expect(gated.source).toBe(BODY);
    expect(gated.hiddenBlocks).toBe(0);
    // The full prose, every paragraph present.
    expect(gated.prose).toContain("Paragraph 10.");
  });

  it("never releases the source to a non-entitled reader", () => {
    const gated = gateColumnBody(BODY, false);
    expect(gated.entitled).toBe(false);
    // The one line that matters most: no source, ever, for a stranger.
    expect(gated.source).toBeNull();
  });

  it("gives a non-entitled reader only a preview, and reports the gap", () => {
    const gated = gateColumnBody(BODY, false);
    expect(gated.hiddenBlocks).toBeGreaterThan(0);
    // The preview is genuinely shorter than the whole.
    expect(gated.prose.length).toBeLessThan(BODY.length);
    // Later paragraphs are withheld.
    expect(gated.prose).not.toContain("Paragraph 10.");
  });

  it("clamps the preview to at most seven blocks even for a long column", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Para ${i}.`).join("\n\n");
    const gated = gateColumnBody(long, false);
    const shown = gated.prose.split(/\n{2,}/).length;
    expect(shown).toBeLessThanOrEqual(7);
    expect(gated.hiddenBlocks).toBe(40 - shown);
  });

  it("shows at least three blocks of preview for a short column", () => {
    const short = "One.\n\nTwo.\n\nThree.\n\nFour.\n\nFive.";
    const gated = gateColumnBody(short, false);
    const shown = gated.prose.split(/\n{2,}/).length;
    expect(shown).toBeGreaterThanOrEqual(3);
  });

  it("still resolves claim results for a non-entitled reader", () => {
    // The numbers in the preview have to be checkable in the browser, so the
    // parsed claims travel even when the source does not.
    const gated = gateColumnBody(BODY_WITH_CLAIM, false);
    expect(gated.source).toBeNull();
    expect(gated.claims.length).toBe(1);
    expect(gated.claims[0]?.key).toBe("hal-d2");
  });
});
