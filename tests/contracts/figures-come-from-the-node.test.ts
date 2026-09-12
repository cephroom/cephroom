import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly, walk } from "./scan";

/**
 * Figures follow the same rule as datasets: they come from the node that served
 * the column - contract 2 and contract 4.
 *
 * An <img> is the one element in untrusted column content that makes the
 * reader's browser fetch an author-chosen URL on open. Off-node, that is a
 * tracking pixel leaking the reader's IP; it also breaks provenance. So the
 * reader resolves a figure through nodeAssetUrl and renders only same-node
 * media, and the node serves media through its own /asset/ route.
 */
const reader = stripCommentsOnly(
  readFileSync(join(ROOT, "src", "components", "column-reader.tsx"), "utf8"),
);

describe("the reader loads figures only from the serving node", () => {
  it("routes every image through the same-node resolver", () => {
    expect(reader).toContain("nodeAssetUrl");
    expect(
      reader,
      "The markdown img handler must pass its src through nodeAssetUrl, not render it directly.",
    ).toMatch(/img:\s*\(/);
  });

  it("never hands a raw markdown src straight to an img element", () => {
    // Any <img emitted by the reader must take its src from the resolver's
    // output (a url variable), never from the markdown node's own src.
    const imgTags = [...reader.matchAll(/<img[^>]*src=\{([^}]+)\}/g)].map((m) =>
      m[1].trim(),
    );
    for (const expr of imgTags) {
      expect(expr, `an <img> takes src={${expr}} directly`).not.toMatch(/^src$/);
    }
    expect(imgTags.length).toBeGreaterThan(0);
  });
});

describe("no figure is optimised through the platform", () => {
  it("uses no next/image anywhere in the platform", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      if (!file.endsWith(".tsx") && !file.endsWith(".ts")) continue;
      if (file.includes(".test.")) continue;
      const code = stripCommentsOnly(readFileSync(file, "utf8"));
      if (/from ["']next\/image["']/.test(code)) {
        offenders.push(relative(ROOT, file).split(sep).join("/"));
      }
    }
    expect(
      offenders,
      [
        "next/image routes the fetch through the platform's /_next/image",
        "optimiser, which would make the platform fetch a contributor's bytes -",
        "a content proxy, forbidden by contracts 2 and 4. Figures load straight",
        "from the node into the reader's browser with a plain <img>.",
        "",
        ...offenders,
      ].join("\n"),
    ).toEqual([]);
  });
});

describe("the node serves media, and only media, from its own directory", () => {
  const server = stripCommentsOnly(
    readFileSync(join(ROOT, "node", "server.ts"), "utf8"),
  );

  it("has an asset route", () => {
    expect(server).toMatch(/\/asset\//);
    expect(server).toContain("resolveAsset");
  });

  it("keeps the asset route no-store, like all served content", () => {
    const around = server.slice(server.indexOf("/asset/"), server.indexOf("/asset/") + 700);
    expect(around).toMatch(/no-store/);
  });
});

describe("a figure that does not load degrades to a note", () => {
  it("handles a load failure rather than leaving a broken-image glyph", () => {
    // No jsdom in this project's test environment, so the graceful path is
    // verified in the browser; this guards that the handler cannot be dropped
    // silently - a same-node figure that 404s must fall back, not show the
    // browser's broken-image icon.
    expect(reader).toMatch(/onError=\{/);
    expect(reader).toMatch(/could not be loaded/i);
  });
});
