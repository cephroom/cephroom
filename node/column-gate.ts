import {
  parseBody,
  referencedKeys,
  type ParsedBody,
} from "../src/lib/claims/syntax";


const PREVIEW_FRACTION = 0.28;
const PREVIEW_MIN_BLOCKS = 3;
const PREVIEW_MAX_BLOCKS = 7;

const PREVIEW_MAX_CLAIMS = 3;

export interface GatedColumn {
  entitled: boolean;
  prose: string;
  source: string | null;
  hiddenBlocks: number;
  claims: ParsedBody["claims"];
  withheldClaims: string[];
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
