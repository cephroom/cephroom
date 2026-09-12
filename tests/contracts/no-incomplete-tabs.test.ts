import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly, walk } from "./scan";

/**
 * An ARIA pattern half-implemented is worse than none - it announces a contract
 * to assistive tech that the keyboard then breaks.
 *
 * role="tab" promises the whole tabs pattern: a tablist, tabpanels, a single
 * tab stop via roving tabindex, and arrow-key movement between tabs. A reader
 * on a keyboard who hears "tab" and presses the arrow keys, and nothing moves,
 * has been misled. The citation panel's format switcher was exactly this - two
 * role="tab" buttons with none of the rest - and it was introduced in this
 * session, so this guard is aimed first at my own work.
 *
 * The rule: either implement the pattern fully, or do not claim it. A binary
 * format switch is a pair of toggle buttons (aria-pressed), which real <button>
 * elements support with no extra keyboard code.
 */
function components(): { rel: string; code: string }[] {
  return walk(join(ROOT, "src"))
    .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
    .map((f) => ({
      rel: relative(ROOT, f).split(sep).join("/"),
      code: stripCommentsOnly(readFileSync(f, "utf8")),
    }));
}

describe("no half-built tabs pattern", () => {
  it("uses role=tab only alongside the rest of the contract", () => {
    const offenders: string[] = [];
    for (const { rel, code } of components()) {
      if (!/role="tab"/.test(code)) continue;
      const hasTabList = /role="tablist"/.test(code);
      const hasTabPanel = /role="tabpanel"/.test(code);
      const hasRoving = /tabIndex=\{/.test(code);
      const hasArrows = /Arrow(Left|Right|Up|Down)/.test(code);
      if (!(hasTabList && hasTabPanel && hasRoving && hasArrows)) {
        const missing = [
          !hasTabList && "tablist",
          !hasTabPanel && "tabpanel",
          !hasRoving && "roving tabindex",
          !hasArrows && "arrow-key handling",
        ].filter(Boolean);
        offenders.push(`${rel} claims role="tab" but is missing: ${missing.join(", ")}`);
      }
    }
    expect(
      offenders,
      [
        "A role=tab that a keyboard cannot drive with arrow keys is a broken",
        "promise. Use aria-pressed toggle buttons for a simple switch, or build",
        "the whole tabs pattern.",
        "",
        ...offenders,
      ].join("\n"),
    ).toEqual([]);
  });

  it("does not use aria-selected outside a real tablist", () => {
    const offenders: string[] = [];
    for (const { rel, code } of components()) {
      if (/aria-selected/.test(code) && !/role="tablist"/.test(code)) {
        offenders.push(rel);
      }
    }
    expect(
      offenders,
      `aria-selected belongs to the tabs/listbox family. On a plain button it means nothing.\n${offenders.join("\n")}\n`,
    ).toEqual([]);
  });
});

describe("the citation format switch is a toggle-button group", () => {
  const raw = readFileSync(
    join(ROOT, "src", "components", "cite-reading.tsx"),
    "utf8",
  );

  it("marks the active format with aria-pressed", () => {
    expect(raw).toMatch(/aria-pressed/);
  });

  it("groups the toggles with an accessible name", () => {
    expect(raw).toMatch(/role="group"/);
    expect(raw).toMatch(/aria-label/);
  });
});
