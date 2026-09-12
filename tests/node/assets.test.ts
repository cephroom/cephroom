import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assetRoot, resolveAsset, MAX_ASSET_BYTES } from "../../node/assets";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cephroom-assets-"));
  writeFileSync(join(root, "figure.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(root, "clip.mp4"), Buffer.from([0, 0, 0, 1]));
  writeFileSync(join(root, "column.md"), "---\nslug: c\ntitle: T\n---\nbody");
  writeFileSync(join(root, "secret.txt"), "not media");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("a node serves its own figures and nothing else", () => {
  it("serves an image with the right content type", () => {
    const r = resolveAsset(root, "figure.png");
    expect(typeof r).not.toBe("string");
    if (typeof r !== "string") expect(r.contentType).toBe("image/png");
  });

  it("serves video too", () => {
    const r = resolveAsset(root, "clip.mp4");
    expect(typeof r !== "string" && r.contentType).toBe("video/mp4");
  });

  it("refuses to serve a column as bytes", () => {
    expect(
      resolveAsset(root, "column.md"),
      "The asset route must never hand back the markdown itself - a column is served through /column, parsed, not as a raw file.",
    ).toBe("not-media");
  });

  it("refuses a non-media file", () => {
    expect(resolveAsset(root, "secret.txt")).toBe("not-media");
  });

  it("refuses a path that escapes the content root", () => {
    for (const attack of [
      "../server.ts",
      "../../etc/passwd",
      "..\\..\\windows\\system32\\config.png",
      "sub/../../escape.png",
    ]) {
      const r = resolveAsset(root, attack);
      expect(
        r === "escapes-root" || r === "not-media" || r === "not-found",
        `traversal "${attack}" resolved to something servable`,
      ).toBe(true);
      expect(typeof r).toBe("string");
    }
  });

  it("refuses a traversal even when it ends in a media extension", () => {
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "outside.png"), "x");
    expect(resolveAsset(join(root, "sub"), "../outside.png")).toBe("escapes-root");
  });

  it("says not-found for a missing figure rather than throwing", () => {
    expect(resolveAsset(root, "absent.png")).toBe("not-found");
  });

  it("refuses an oversized asset", () => {
    writeFileSync(join(root, "huge.png"), Buffer.alloc(MAX_ASSET_BYTES + 1));
    expect(resolveAsset(root, "huge.png")).toBe("too-large");
  });

  it("serves from an assets/ subdirectory when one exists", () => {
    const withAssets = mkdtempSync(join(tmpdir(), "cephroom-assets2-"));
    mkdirSync(join(withAssets, "assets"));
    writeFileSync(join(withAssets, "assets", "fig.png"), "x");
    expect(assetRoot(withAssets)).toBe(join(withAssets, "assets"));
    rmSync(withAssets, { recursive: true, force: true });
  });

  it("falls back to the content directory when there is no assets/ subdir", () => {
    expect(assetRoot(root)).toBe(root);
  });
});
