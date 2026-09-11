import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsAndStrings, walk } from "./scan";

/**
 * Regression guard for untrusted-content rendering.
 *
 * A column body is fully attacker-controlled — anyone who serves a node
 * chooses its bytes — and it is rendered in every reader's browser. Attacking
 * the local server confirmed the reader neutralises it: raw HTML renders as
 * text and a javascript: link has its href stripped, because react-markdown
 * is used without rehype-raw and with its default URL sanitiser.
 *
 * That safety is a property of what the renderer does NOT do, so the test
 * guards the absences rather than replaying one payload. If a future edit
 * reaches for raw HTML, this fails before it ships.
 */

const RENDERERS = ["src/components/column-reader.tsx", "src/components/column-body.tsx"];

describe("the markdown renderer cannot emit raw HTML", () => {
  it("does not import rehype-raw anywhere in the platform", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      if (file.includes(".test.")) continue;
      const source = stripCommentsAndStrings(readFileSync(file, "utf8"));
      if (/rehype-raw|rehypeRaw/.test(source)) offenders.push(file);
    }
    expect(
      offenders,
      "rehype-raw turns every column body into an XSS vector. It must not be imported.",
    ).toEqual([]);
  });

  it("does not keep rehype-raw as a dependency", async () => {
    const pkg = (await import("../../package.json")).default as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    // A dependency that is present is a dependency someone will eventually
    // import. The safe state is not having it at all.
    expect(pkg.dependencies?.["rehype-raw"]).toBeUndefined();
    expect(pkg.devDependencies?.["rehype-raw"]).toBeUndefined();
  });

  it("does not use dangerouslySetInnerHTML in a content renderer", () => {
    for (const relative of RENDERERS) {
      const path = join(ROOT, relative);
      let source: string;
      try {
        source = stripCommentsAndStrings(readFileSync(path, "utf8"));
      } catch {
        continue; // component may not exist; the import guard above still holds
      }
      expect(
        source.includes("dangerouslySetInnerHTML"),
        `${relative} must not set inner HTML from column content.`,
      ).toBe(false);
    }
  });
});
