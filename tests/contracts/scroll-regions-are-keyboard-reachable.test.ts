import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly, walk } from "./scan";

/**
 * A region that scrolls sideways must be reachable by keyboard - WCAG 2.1.1.
 *
 * The affinity matrix is wider than the viewport by design: eight compounds
 * across ten receptors. A mouse user drags it; a keyboard-only user cannot
 * reach the right-hand columns at all unless the scroll container is focusable.
 * The documented fix is tabindex="0" on the scrollable element, plus a name and
 * a role so assistive tech announces what the focus stop is for.
 *
 * The rule: an element that can scroll horizontally (overflow-x-auto and does
 * not wrap) carries tabIndex. Containers that wrap - break-all, or
 * whitespace-pre-wrap - never scroll sideways and are exempt.
 */
interface OpeningTag {
  text: string;
  line: number;
}

function openingTags(code: string): OpeningTag[] {
  const tags: OpeningTag[] = [];
  const re = /<[A-Za-z][^]*?>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(code)) !== null) {
    tags.push({
      text: match[0],
      line: code.slice(0, match.index).split("\n").length,
    });
  }
  return tags;
}

function offenders(code: string): number[] {
  return openingTags(code)
    .filter((tag) => /overflow-x-auto/.test(tag.text))
    .filter((tag) => !/break-all|whitespace-pre-wrap|whitespace-normal/.test(tag.text))
    .filter((tag) => !/tabIndex=/.test(tag.text))
    .map((tag) => tag.line);
}

describe("horizontally scrollable regions are keyboard-reachable", () => {
  it("every non-wrapping overflow-x container is focusable", () => {
    const bad: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      if (!file.endsWith(".tsx") || file.includes(".test.")) continue;
      const code = stripCommentsOnly(readFileSync(file, "utf8"));
      const lines = offenders(code);
      if (lines.length) {
        bad.push(`${relative(ROOT, file).split(sep).join("/")} at line(s) ${lines.join(", ")}`);
      }
    }
    expect(
      bad,
      [
        "These scroll sideways but a keyboard cannot focus them, so their",
        'off-screen content is unreachable without a mouse - WCAG 2.1.1. Add',
        'tabIndex={0} (and, for a data table, role="region" with an aria-label).',
        "",
        ...bad,
      ].join("\n"),
    ).toEqual([]);
  });

  it("would flag a scroll container that lost its tabIndex", () => {
    expect(offenders('<div className="overflow-x-auto rounded">x</div>')).toEqual([1]);
    expect(offenders('<div className="overflow-x-auto" tabIndex={0}>x</div>')).toEqual([]);
    expect(offenders('<pre className="overflow-x-auto whitespace-pre-wrap">x</pre>')).toEqual([]);
  });
});

describe("the affinity matrix names its scroll region", () => {
  const matrix = readFileSync(
    join(ROOT, "src", "components", "dataset-matrix.tsx"),
    "utf8",
  );

  it("gives the scroll container a region role and a name", () => {
    expect(matrix).toMatch(/role="region"/);
    expect(matrix).toMatch(/aria-label(ledby)?=/);
  });

  it("keeps the table's own accessible markup", () => {
    expect(matrix).toContain("<caption");
    expect(matrix).toMatch(/scope="col"/);
    expect(matrix).toMatch(/scope="row"/);
  });
});
