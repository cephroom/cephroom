import { describe, expect, it } from "vitest";

import { diffLines, diffStats, toHunks } from "./diff";

const render = (before: string, after: string) =>
  diffLines(before, after).map(
    (line) =>
      `${line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}${line.text}`,
  );

describe("diffLines", () => {
  it("reports nothing for identical text", () => {
    const lines = diffLines("a\nb\nc", "a\nb\nc");
    expect(diffStats(lines)).toEqual({ added: 0, removed: 0, unchanged: 3 });
  });

  it("finds an inserted line", () => {
    expect(render("a\nc", "a\nb\nc")).toEqual([" a", "+b", " c"]);
  });

  it("finds a deleted line", () => {
    expect(render("a\nb\nc", "a\nc")).toEqual([" a", "-b", " c"]);
  });

  it("renders a replacement as a removal then an addition", () => {
    expect(render("a\nb\nc", "a\nB\nc")).toEqual([" a", "-b", "+B", " c"]);
  });

  it("numbers lines on the side they exist", () => {
    const lines = diffLines("a\nb", "a\nB");
    expect(lines.map((l) => [l.kind, l.before, l.after])).toEqual([
      ["context", 1, 1],
      ["removed", 2, null],
      ["added", null, 2],
    ]);
  });

  it("handles an empty original", () => {
    expect(render("", "a")).toEqual(["-", "+a"]);
  });

  it("treats CRLF and LF as the same line break", () => {
    const lines = diffLines("a\r\nb", "a\nb");
    expect(diffStats(lines)).toEqual({ added: 0, removed: 0, unchanged: 2 });
  });

  it("keeps unrelated regions as context", () => {
    const before = ["one", "two", "three", "four", "five"].join("\n");
    const after = ["one", "two", "THREE", "four", "five"].join("\n");
    expect(diffStats(diffLines(before, after))).toEqual({
      added: 1,
      removed: 1,
      unchanged: 4,
    });
  });
});

describe("toHunks", () => {
  it("is empty when nothing changed", () => {
    expect(toHunks(diffLines("a\nb", "a\nb"))).toEqual([]);
  });

  it("wraps a change in context rather than showing the whole file", () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 20", "line twenty");

    const hunks = toHunks(diffLines(before, after), 2);
    expect(hunks).toHaveLength(1);
    // 2 lines of context either side, plus the removal and the addition.
    expect(hunks[0].lines).toHaveLength(6);
    expect(hunks[0].beforeStart).toBe(19);
  });

  it("merges changes that are close together", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 5", "five").replace("line 7", "seven");

    expect(toHunks(diffLines(before, after), 3)).toHaveLength(1);
  });

  it("keeps changes that are far apart separate", () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 2", "two").replace("line 35", "thirty");

    expect(toHunks(diffLines(before, after), 2)).toHaveLength(2);
  });
});
