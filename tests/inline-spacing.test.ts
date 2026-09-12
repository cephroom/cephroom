import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, walk } from "./contracts/scan";


const INLINE = "strong|em|code|abbr|b|i";

const AFTER = new RegExp(`</(${INLINE})>[ \\t]+(?=[A-Za-z0-9(“"'‘])`, "g");

// Only the after-case is enforced. A symmetric before-case was written here
// and never adopted, because it does not describe a real hazard: a space
// before an opening inline tag is ordinary mid-line prose, which JSX keeps.
// It matched around thirty safe sites and no unsafe ones. What this file
// guards is a space that has to survive a line break next to a tag.

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
