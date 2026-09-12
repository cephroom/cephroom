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

const BODY_WITH_CLAIM = `Intro paragraph naming {{claim:hal-d2}}.

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
    // The numbers in the preview have to be checkable in the browser, so a
    // claim the preview *references* travels even when the source does not.
    // (The fixture's prose names the claim for that reason: since cycle 3 a
    // claim nobody can see is a claim nobody is sent.)
    const gated = gateColumnBody(BODY_WITH_CLAIM, false);
    expect(gated.source).toBeNull();
    expect(gated.claims.length).toBe(1);
    expect(gated.claims[0]?.key).toBe("hal-d2");
  });
});

/**
 * The leak found by attacking the local node in cycle 3.
 *
 * The gate withheld the prose and the Markdown source from a non-entitled
 * reader, and then handed back `claims` in full — every `expectedValue`, and
 * each claim's verbatim `source` block. On this platform that is not metadata,
 * it is the article: a Lab column about the H1 affinity ranking of eight
 * antipsychotics returned all eight numbers, and the queries behind them, to
 * an unauthenticated `curl`.
 *
 * The original reasoning was sound but scoped wrong — "the numbers a reader
 * sees in the preview still have to be checkable in their browser" is true of
 * the claims *in the preview*, and was applied to all of them. So the rule is
 * now: a non-entitled reader gets exactly the claims the prose they received
 * actually references, and never a claim's Markdown block.
 */
const PAID_BODY = `Free opening paragraph.

Second free paragraph mentioning {{claim:free-one}}.

Third free paragraph.

Paid paragraph naming {{claim:paid-one}}.

Another paid paragraph naming {{claim:paid-two}}.

\`\`\`claim free-one
dataset: receptorome-ki
metric: median_ki_nm
subject: HRH1
object: clozapine
value: 1.8 nM
tolerance: 15%
\`\`\`

\`\`\`claim paid-one
dataset: receptorome-ki
metric: median_ki_nm
subject: HRH1
object: olanzapine
value: 2.884 nM
tolerance: 15%
\`\`\`

\`\`\`claim paid-two
dataset: receptorome-ki
metric: median_ki_nm
subject: HRH1
object: quetiapine
value: 8.878 nM
tolerance: 15%
\`\`\`

Final paid paragraph.

Padding one.

Padding two.

Padding three.`;

describe("the paywall does not hand the numbers to a stranger", () => {
  it("withholds claims the preview never referenced", () => {
    const gated = gateColumnBody(PAID_BODY, false);

    const keys = gated.claims.map((claim) => claim.key);
    expect(keys).toContain("free-one");
    expect(keys).not.toContain("paid-one");
    expect(keys).not.toContain("paid-two");
  });

  it("never releases a value the reader has not paid to see", () => {
    const gated = gateColumnBody(PAID_BODY, false);
    const values = gated.claims.map((claim) => claim.expectedValue);

    // The paid medians must not appear anywhere in what left the node.
    expect(values).not.toContain(2.884);
    expect(values).not.toContain(8.878);
    expect(JSON.stringify(gated)).not.toContain("2.884");
    expect(JSON.stringify(gated)).not.toContain("8.878");
  });

  it("never releases a claim's Markdown block to a non-entitled reader", () => {
    const gated = gateColumnBody(PAID_BODY, false);
    // The module's own promise is "never the Markdown source". A claim's
    // `source` field is Markdown source, preview claim or not.
    for (const claim of gated.claims) {
      expect(claim.source).toBe("");
    }
    expect(JSON.stringify(gated)).not.toContain("```claim");
  });

  it("still gives the preview reader what the preview needs to check", () => {
    const gated = gateColumnBody(PAID_BODY, false);
    const free = gated.claims.find((claim) => claim.key === "free-one");

    // The point of the preview is that its numbers are verifiable too, so the
    // query and the authored value for a *visible* claim must survive.
    expect(free).toBeDefined();
    expect(free!.expectedValue).toBe(1.8);
    expect(free!.subject).toBe("HRH1");
    expect(free!.object).toBe("clozapine");
  });

  it("hands an entitled reader every claim, with its block intact", () => {
    const gated = gateColumnBody(PAID_BODY, true);
    expect(gated.claims.map((claim) => claim.key)).toEqual([
      "free-one",
      "paid-one",
      "paid-two",
    ]);
    expect(gated.claims[1].source).toContain("```claim paid-one");
  });
});

/**
 * The second half of the same finding.
 *
 * Scoping claims to the preview closed the Markdown leak but not the value
 * leak, because the preview is cut in *blocks* and a Markdown table is one
 * block. `histamine-h1-and-the-sedation-question` is a Lab column whose entire
 * thesis is a ranking of eight compounds by H1 affinity, written as a table —
 * and that table sits inside the free preview, so an anonymous `curl` still
 * came away with all eight numbers while `hiddenBlocks: 7` reported the
 * article as mostly withheld.
 *
 * "How much prose is hidden" is the wrong measure of how much has been given
 * away on a platform whose articles are made of numbers. The preview is now
 * capped by claims as well as by blocks: the prose keeps its shape, and any
 * claim past the cap is withheld and named in `withheldClaims`, so the reader
 * sees a table with eight locked cells rather than eight free answers.
 */
const TABLE_BODY = `Opening paragraph of the argument.

| Compound | H1 median Ki |
| --- | --- |
| Clozapine | {{claim:c1}} |
| Chlorpromazine | {{claim:c2}} |
| Olanzapine | {{claim:c3}} |
| Quetiapine | {{claim:c4}} |
| Risperidone | {{claim:c5}} |

Closing paragraph.

${["c1", "c2", "c3", "c4", "c5"]
  .map(
    (key, i) => `\`\`\`claim ${key}
dataset: receptorome-ki
metric: median_ki_nm
subject: HRH1
object: compound-${i}
value: ${(i + 1) * 11}.5 nM
tolerance: 15%
\`\`\``,
  )
  .join("\n\n")}

Padding one.

Padding two.

Padding three.

Padding four.`;

describe("a table of claims is not a free preview of the column", () => {
  it("caps how many claims a non-entitled reader can resolve", () => {
    const gated = gateColumnBody(TABLE_BODY, false);
    expect(gated.claims.length).toBeLessThanOrEqual(3);
  });

  it("withholds the surplus values entirely", () => {
    const gated = gateColumnBody(TABLE_BODY, false);
    const serialised = JSON.stringify(gated.claims);
    // The last two compounds' medians must not have left the node at all.
    expect(serialised).not.toContain("44.5");
    expect(serialised).not.toContain("55.5");
  });

  it("names what it withheld, so the reader can be shown a lock", () => {
    const gated = gateColumnBody(TABLE_BODY, false);
    // The prose still references them; the reader must render those cells as
    // paywalled rather than as broken claims.
    expect(gated.withheldClaims).toEqual(["c4", "c5"]);
    expect(gated.prose).toContain("{{claim:c5}}");
  });

  it("leaves an entitled reader untouched", () => {
    const gated = gateColumnBody(TABLE_BODY, true);
    expect(gated.claims.length).toBe(5);
    expect(gated.withheldClaims).toEqual([]);
  });
});
