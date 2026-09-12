import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, walk } from "./contracts/scan";

/**
 * Words must not fuse across an inline element.
 *
 * Three sentences on this site rendered as "Keys cannot be revoked.Revocation
 * needs a blocklist", "the independentPDSP Ki Database" and "set it as
 * NODE_KEYin the node's environment". In every case the source had a normal
 * space after `</strong>`, `</em>` or `</code>`, on the same line, exactly as
 * a dozen other places that render correctly — and the space was gone from
 * the server-rendered HTML.
 *
 * I could not derive the rule that distinguishes the cases. What is certain is
 * that a literal space adjacent to a JSX element is not reliably a space, and
 * that the failure is invisible in review: the source reads correctly, only
 * the output is wrong. `{" "}` is explicit and survives, so it is what we use.
 *
 * This test does not try to reproduce the compiler's behaviour. It enforces
 * the habit: a space between an inline element and adjacent prose is written
 * as `{" "}`. That is a rule a reviewer can check, and it makes the whole
 * class unshippable rather than making us re-find it each time.
 */

/** Inline elements that sit inside a sentence and need a space around them. */
const INLINE = "strong|em|code|abbr|b|i";

/** `</em> word` — a bare space between a closing inline tag and prose. */
const AFTER = new RegExp(`</(${INLINE})>[ \\t]+(?=[A-Za-z0-9(“"'‘])`, "g");

/** `word <em>` — a bare space between prose and an opening inline tag. */
const BEFORE = new RegExp(
  `(?<=[A-Za-z0-9,.;:)”"’])[ \\t]+<(${INLINE})[ >]`,
  "g",
);

function offendingLines(source: string, pattern: RegExp): number[] {
  const lines: number[] = [];
  for (const match of source.matchAll(pattern)) {
    lines.push(source.slice(0, match.index).split("\n").length);
  }
  return lines;
}

describe("a space beside an inline element is written explicitly", () => {
  it("uses {\" \"} rather than a bare space after an inline element", () => {
    const offenders: string[] = [];

    for (const file of walk(`${ROOT}${sep}src`)) {
      if (!file.endsWith(".tsx")) continue;
      const source = readFileSync(file, "utf8");
      const rel = relative(ROOT, file).split(sep).join("/");

      for (const line of offendingLines(source, AFTER)) {
        offenders.push(`${rel}:${line} — space after a closing inline tag`);
      }
    }

    expect(
      offenders,
      [
        "A bare space next to an inline JSX element is not reliably rendered.",
        'Write it as {" "} on its own, then continue the prose on the next line:',
        "",
        '  <strong>Keys cannot be revoked.</strong>{" "}',
        "  Revocation needs a blocklist…",
        "",
        ...offenders,
        "",
      ].join("\n"),
    ).toEqual([]);
  });
});
