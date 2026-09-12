import { describe, expect, it } from "vitest";

import { isVideoAsset, nodeAssetUrl } from "./node-asset";

const NODE = "http://127.0.0.1:4600";

describe("a figure loads only from the node that served the column", () => {
  it("resolves a relative reference to the node's asset route", () => {
    expect(nodeAssetUrl("figure.png", NODE)).toBe(
      "http://127.0.0.1:4600/asset/figure.png",
    );
    expect(nodeAssetUrl("d2-window.png", NODE)).toBe(
      "http://127.0.0.1:4600/asset/d2-window.png",
    );
  });

  it("allows a same-origin absolute URL under /asset/", () => {
    expect(nodeAssetUrl("http://127.0.0.1:4600/asset/fig.png", NODE)).toBe(
      "http://127.0.0.1:4600/asset/fig.png",
    );
  });

  it("refuses an off-node image - the tracking-pixel case", () => {
    expect(
      nodeAssetUrl("https://tracker.example/pixel.png", NODE),
      "An off-node image URL loaded on open leaks the reader's IP to whoever the author chose.",
    ).toBeNull();
    expect(nodeAssetUrl("https://cdn.example/fig.png", NODE)).toBeNull();
  });

  it("refuses a protocol-relative URL", () => {
    expect(nodeAssetUrl("//evil.example/pixel.png", NODE)).toBeNull();
  });

  it("refuses javascript: and data: URLs", () => {
    expect(nodeAssetUrl("javascript:alert(1)", NODE)).toBeNull();
    expect(nodeAssetUrl("data:image/svg+xml,<svg onload=alert(1)>", NODE)).toBeNull();
  });

  it("refuses a same-origin URL that is not under /asset/", () => {
    expect(
      nodeAssetUrl("http://127.0.0.1:4600/column/secret", NODE),
      "The asset route is the only path a figure may hit; /column returns parsed JSON, not bytes.",
    ).toBeNull();
  });

  it("refuses a relative path that climbs out of /asset/", () => {
    expect(nodeAssetUrl("../column/x", NODE)).toBeNull();
    expect(nodeAssetUrl("../../etc/passwd", NODE)).toBeNull();
  });

  it("returns null for empty or nonsense input rather than throwing", () => {
    expect(nodeAssetUrl("", NODE)).toBeNull();
    expect(nodeAssetUrl("   ", NODE)).toBeNull();
    expect(nodeAssetUrl(null, NODE)).toBeNull();
    expect(nodeAssetUrl(undefined, NODE)).toBeNull();
    expect(nodeAssetUrl("figure.png", "not a url")).toBeNull();
  });

  it("keeps the node's own port, so a same-host different-port node is off-node", () => {
    expect(nodeAssetUrl("http://127.0.0.1:4601/asset/fig.png", NODE)).toBeNull();
  });
});

describe("video assets are recognised so they can be rendered as video", () => {
  it("spots the video extensions", () => {
    expect(isVideoAsset("http://127.0.0.1:4600/asset/clip.mp4")).toBe(true);
    expect(isVideoAsset("http://127.0.0.1:4600/asset/clip.webm")).toBe(true);
  });

  it("does not mistake an image for video", () => {
    expect(isVideoAsset("http://127.0.0.1:4600/asset/fig.png")).toBe(false);
  });
});
