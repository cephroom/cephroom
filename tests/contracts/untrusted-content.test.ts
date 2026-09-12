import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsAndStrings, stripCommentsOnly, walk } from "./scan";

const RAW_HTML = /dangerouslySetInnerHTML/;
const MARKDOWN_IMPORT = /from\s+["']react-markdown["']/;

interface Renderer {
  rel: string;
  code: string;
  raw: string;
}

function platformComponents(): Renderer[] {
  return walk(join(ROOT, "src"), [".tsx"])
    .filter((file) => !file.includes(".test."))
    .map((file) => {
      const source = readFileSync(file, "utf8");
      return {
        rel: relative(ROOT, file).split(sep).join("/"),
        code: stripCommentsAndStrings(source),
        raw: stripCommentsOnly(source),
      };
    });
}

function markdownRenderers(): Renderer[] {
  return platformComponents().filter((file) => MARKDOWN_IMPORT.test(file.raw));
}

describe("the markdown renderer cannot emit raw HTML", () => {
  it("does not import rehype-raw anywhere in the platform", () => {
    const offenders = platformComponents()
      .concat(
        walk(join(ROOT, "src"), [".ts"])
          .filter((file) => !file.includes(".test."))
          .map((file) => {
            const source = readFileSync(file, "utf8");
            return {
              rel: relative(ROOT, file).split(sep).join("/"),
              code: stripCommentsAndStrings(source),
              raw: stripCommentsOnly(source),
            };
          }),
      )
      .filter((file) => /rehype-raw|rehypeRaw/.test(file.code))
      .map((file) => file.rel);

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
    expect(pkg.dependencies?.["rehype-raw"]).toBeUndefined();
    expect(pkg.devDependencies?.["rehype-raw"]).toBeUndefined();
  });

  it("finds the renderers by what they import rather than by a hand-kept list", () => {
    const found = markdownRenderers().map((file) => file.rel);
    expect(
      found.length,
      "No component imports react-markdown. Either the renderer moved and this guard is now scanning nothing, or the discovery rule is wrong. A guard over an empty set protects nothing.",
    ).toBeGreaterThan(0);
    expect(found).toContain("src/components/column-reader.tsx");
  });

  it("sets no inner HTML in any component that renders a node's markdown", () => {
    const offenders = markdownRenderers()
      .filter((file) => RAW_HTML.test(file.code))
      .map((file) => file.rel);

    expect(
      offenders,
      `A column body is untrusted input from a stranger's machine.\n${offenders.join("\n")}\n`,
    ).toEqual([]);
  });

  it("sets no inner HTML anywhere in the platform, renderer or not", () => {
    const offenders = platformComponents()
      .filter((file) => RAW_HTML.test(file.code))
      .map((file) => file.rel);

    expect(offenders, `\n${offenders.join("\n")}\n`).toEqual([]);
  });
});

describe("the raw-HTML detector fires on the thing it is looking for", () => {
  it("flags a component that sets inner HTML from a column body", () => {
    const scratch = mkdtempSync(join(tmpdir(), "cephroom-xss-"));
    try {
      const suspect = join(scratch, "suspect.tsx");
      writeFileSync(
        suspect,
        [
          `import ReactMarkdown from "react-markdown";`,
          `export function Body({ source }: { source: string }) {`,
          `  return <div dangerouslySetInnerHTML={{ __html: source }} />;`,
          `}`,
        ].join("\n"),
      );

      const source = readFileSync(suspect, "utf8");
      expect(MARKDOWN_IMPORT.test(stripCommentsOnly(source))).toBe(true);
      expect(RAW_HTML.test(stripCommentsAndStrings(source))).toBe(true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("does not flag the renderer this platform actually ships", () => {
    const reader = readFileSync(
      join(ROOT, "src", "components", "column-reader.tsx"),
      "utf8",
    );
    expect(MARKDOWN_IMPORT.test(stripCommentsOnly(reader))).toBe(true);
    expect(RAW_HTML.test(stripCommentsAndStrings(reader))).toBe(false);
  });
});
