import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsAndStrings } from "./scan";

/**
 * The provenance popover is a disclosure, and its ARIA must say so.
 *
 * It reveals informational content and a single link when a reader opens a
 * claim. role="dialog" tells assistive technology this is a dialog window,
 * which carries expectations the component does not meet: focus moves into a
 * dialog when it opens and returns to the trigger when it closes. This one
 * leaves focus on the trigger throughout (verified in the browser:
 * focusMovedIntoPanel was false). A screen-reader user is announced a dialog
 * that then behaves like nothing of the kind.
 *
 * The correct pattern for reveal-in-place content is a disclosure: the trigger
 * carries aria-expanded and aria-controls, and the revealed region is a plain
 * labelled group, not a dialog.
 */
const chip = stripCommentsAndStrings(
  readFileSync(join(ROOT, "src", "components", "claim-chip.tsx"), "utf8"),
);
const rawChip = readFileSync(
  join(ROOT, "src", "components", "claim-chip.tsx"),
  "utf8",
);

describe("the provenance popover is announced as what it is", () => {
  it("does not claim to be a dialog", () => {
    expect(
      rawChip,
      "role=dialog promises focus management the popover does not perform. It leaves focus on the trigger, which is correct for a disclosure and wrong for a dialog.",
    ).not.toMatch(/role="dialog"/);
  });

  it("uses the disclosure relationship on the trigger", () => {
    expect(chip).toContain("aria-expanded");
    expect(chip).toContain("aria-controls");
  });

  it("gives the revealed region a role that does not imply focus capture", () => {
    // group or region are the labelled-container roles that carry no dialog
    // focus contract. Either is acceptable; a dialog is not.
    expect(rawChip).toMatch(/role="(group|region)"/);
  });

  it("keeps the region labelled, so it is navigable by assistive tech", () => {
    expect(chip).toContain("aria-label");
  });

  it("still closes on Escape", () => {
    expect(rawChip).toMatch(/key === "Escape"/);
  });

  it("keeps the panel id wired to aria-controls", () => {
    expect(chip).toContain("panelId");
    expect(chip).toMatch(/aria-controls=\{panelId\}/);
    expect(chip).toMatch(/id=\{panelId\}/);
  });
});
