import {
  parseBody,
  referencedKeys,
  type ParsedBody,
} from "../src/lib/claims/syntax";

/**
 * The paywall itself.
 *
 * Given a column's Markdown body and whether the reader is entitled to the
 * whole thing, decide what actually leaves the node. This is the money
 * boundary, and it lives in one pure function on purpose: the node handler
 * calls it, and a test pins it, so a refactor cannot quietly start handing
 * `source` to a stranger.
 *
 * A non-entitled reader gets a short preview of the prose and never the
 * Markdown source — the source carries the claim definitions and is what a
 * proposal edits, so releasing it would be releasing the paid article.
 *
 * The claims need more care than that, and an earlier version of this file
 * got it wrong in a way worth recording. Its rule was "the claim *results*
 * travel either way: the numbers a reader sees in the preview still have to
 * be checkable in their browser." That reasoning is right and the scope was
 * not: it returned *every* claim, including the ones defining the numbers in
 * the blocks the preview had just withheld. On a platform whose columns are
 * made of numbers, that is not metadata leaking, it is the article leaking —
 * attacking the local node with an unauthenticated `curl` returned all eight
 * H1 affinities, and their queries, from a Lab column.
 *
 * So the rule is scoped to what it was always meant to mean: a non-entitled
 * reader gets exactly the claims the prose they actually received references,
 * and never a claim's own Markdown block, because that block is Markdown
 * source and this function's promise is that source does not leave.
 */

/** Fraction of a column shown as a free preview, clamped to [3, 7] blocks. */
const PREVIEW_FRACTION = 0.28;
const PREVIEW_MIN_BLOCKS = 3;
const PREVIEW_MAX_BLOCKS = 7;

/**
 * How many numbers a free preview may resolve.
 *
 * Blocks are the wrong unit on their own. A Markdown table is one block, and
 * a column whose argument *is* a ranking puts the whole argument in it — so
 * the H1 sedation column reported `hiddenBlocks: 7` while having already
 * handed over all eight affinities it exists to report.
 *
 * Three is enough to show the mechanism working — a reader can watch a claim
 * resolve and check it — and not enough to be the dataset.
 */
const PREVIEW_MAX_CLAIMS = 3;

export interface GatedColumn {
  entitled: boolean;
  prose: string;
  /** The Markdown source, or null for anyone not entitled to it. */
  source: string | null;
  hiddenBlocks: number;
  claims: ParsedBody["claims"];
  /**
   * Keys the preview prose references but whose values were withheld.
   *
   * Named rather than silently dropped: the reader has to render those as
   * locked, not as broken. A paywalled number and a number whose query no
   * longer resolves are different facts about the world and must not look
   * alike.
   */
  withheldClaims: string[];
  /**
   * How many claims in the whole column the reader cannot currently see.
   *
   * A count, not the claims. The paywall advertises what is behind it, and
   * advertising "7 more sections" while silently miscounting the numbers was
   * the state before cycle 3: it reported the claims already *released*, so a
   * column with five locked values in plain view offered to unlock "3".
   */
  withheldClaimCount: number;
  errors: ParsedBody["errors"];
}

export function gateColumnBody(body: string, entitled: boolean): GatedColumn {
  const parsed = parseBody(body);
  const blocks = parsed.prose.split(/\n{2,}/);
  const take = Math.min(
    Math.max(PREVIEW_MIN_BLOCKS, Math.ceil(blocks.length * PREVIEW_FRACTION)),
    PREVIEW_MAX_BLOCKS,
  );

  if (entitled) {
    return {
      entitled,
      prose: parsed.prose,
      source: body,
      hiddenBlocks: 0,
      claims: parsed.claims,
      withheldClaims: [],
      withheldClaimCount: 0,
      errors: parsed.errors,
    };
  }

  const prose = blocks.slice(0, take).join("\n\n");
  // Only what the preview actually names, and then only the first few.
  // Derived from the preview prose rather than from the whole body, so
  // lengthening the preview extends the claims with it and nothing else can.
  // Document order, so which numbers are free is a property of the column
  // rather than of the order the parser happened to emit.
  const referenced = referencedKeys(prose);
  const released = new Set(referenced.slice(0, PREVIEW_MAX_CLAIMS));
  const withheldClaims = referenced.filter((key) => !released.has(key));

  return {
    entitled,
    prose,
    source: null,
    hiddenBlocks: Math.max(0, blocks.length - take),
    claims: parsed.claims
      .filter((claim) => released.has(claim.key))
      // The block is Markdown source. Blanked rather than dropped, so a claim
      // has the same shape either way and no caller has to branch on tier.
      .map((claim) => ({ ...claim, source: "" })),
    withheldClaims,
    withheldClaimCount: Math.max(
      0,
      referencedKeys(parsed.prose).length - released.size,
    ),
    errors: parsed.errors,
  };
}
