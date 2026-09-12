import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly } from "./scan";

/**
 * The CLI is a second copy of the token-spend logic, and it must not degrade
 * silently either - contract 2.
 *
 * tokens-do-not-degrade-silently covers the browser wallet. The CLI in
 * scripts/cephroom.ts reimplements the same flow against the filesystem and
 * fetch, and two copies of a rule drift apart. The bug that copy must not
 * reacquire: spending a token that can no longer be redeemed (the issuer key
 * rotated) and quietly falling back to an identified search with no word to the
 * user. Verified end to end against the live server; this stops the CLI copy
 * regressing without a browser in the loop.
 */
const cli = stripCommentsOnly(
  readFileSync(join(ROOT, "scripts", "cephroom.ts"), "utf8"),
);

function bodyOf(name: string): string {
  const at = cli.indexOf(`function ${name}(`);
  expect(at, `no ${name}`).toBeGreaterThan(-1);
  // Stop at the next TOP-LEVEL declaration (async function / function / const /
  // type), all of which begin at column 0 here. Without the const/type stops,
  // readKey's body would swallow the SPEND_NOTE constant that follows it, and a
  // check for the outcome kinds would pass off that note's text even if readKey
  // stopped returning them - the "rule stopped matching looks like passing" bug.
  const ends = ["\nasync function ", "\nfunction ", "\nconst ", "\ntype "]
    .map((d) => cli.indexOf(d, at + 1))
    .filter((n) => n > at);
  const end = Math.min(...ends.concat([cli.length]));
  return cli.slice(at, end);
}

describe("the CLI checks its batch against the live issuer key", () => {
  it("stores the issuer fingerprint when it stocks up", () => {
    const stock = bodyOf("stockUp");
    expect(stock).toMatch(/issuer:\s*await keyFingerprint/);
  });

  it("discards a batch whose issuer key is no longer published", () => {
    const read = bodyOf("readKey");
    expect(read).toMatch(/keyFingerprint|liveIssuerFingerprints/);
    expect(read).toMatch(/"stale"/);
    // a stale batch is cleared, not spent
    const staleAt = read.indexOf('"stale"');
    const clearAt = read.search(/tokens:\s*\[\]/);
    expect(clearAt).toBeGreaterThan(-1);
    expect(clearAt).toBeLessThan(staleAt);
  });

  it("does not treat a redemption failure as a spent token, silently", () => {
    const read = bodyOf("readKey");
    // every non-spent outcome is a named kind the caller can report
    for (const kind of ["stale", "refused", "unreachable", "empty"]) {
      expect(read, `readKey must distinguish "${kind}"`).toContain(`"${kind}"`);
    }
  });

  it("surfaces a non-spent outcome to the user rather than swallowing it", () => {
    const live = bodyOf("cmdLive");
    expect(live).toMatch(/SPEND_NOTE|spend\.kind/);
  });

  it("has a note for every non-spent outcome", () => {
    const noteBlock = cli.slice(cli.indexOf("SPEND_NOTE"), cli.indexOf("SPEND_NOTE") + 800);
    for (const kind of ["empty", "stale", "refused", "unreachable"]) {
      expect(noteBlock, `SPEND_NOTE missing "${kind}"`).toContain(`${kind}:`);
    }
  });

  it("tells the truth in the stale note - the search was identified", () => {
    const noteBlock = cli.slice(cli.indexOf("SPEND_NOTE"), cli.indexOf("SPEND_NOTE") + 800);
    expect(noteBlock).toMatch(/WAS attached to your subscription/i);
  });
});
