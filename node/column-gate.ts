import { parseBody, type ParsedBody } from "../src/lib/claims/syntax";

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
 * proposal edits, so releasing it would be releasing the paid article. The
 * claim *results* (`claims`) travel either way: the numbers a reader sees in
 * the preview still have to be checkable in their browser.
 */

/** Fraction of a column shown as a free preview, clamped to [3, 7] blocks. */
const PREVIEW_FRACTION = 0.28;
const PREVIEW_MIN_BLOCKS = 3;
const PREVIEW_MAX_BLOCKS = 7;

export interface GatedColumn {
  entitled: boolean;
  prose: string;
  /** The Markdown source, or null for anyone not entitled to it. */
  source: string | null;
  hiddenBlocks: number;
  claims: ParsedBody["claims"];
  errors: ParsedBody["errors"];
}

export function gateColumnBody(body: string, entitled: boolean): GatedColumn {
  const parsed = parseBody(body);
  const blocks = parsed.prose.split(/\n{2,}/);
  const take = Math.min(
    Math.max(PREVIEW_MIN_BLOCKS, Math.ceil(blocks.length * PREVIEW_FRACTION)),
    PREVIEW_MAX_BLOCKS,
  );

  return {
    entitled,
    prose: entitled ? parsed.prose : blocks.slice(0, take).join("\n\n"),
    source: entitled ? body : null,
    hiddenBlocks: entitled ? 0 : Math.max(0, blocks.length - take),
    claims: parsed.claims,
    errors: parsed.errors,
  };
}
