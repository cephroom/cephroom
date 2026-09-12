import { describe, expect, it } from "vitest";

import { linkifyNote } from "./linkify";

describe("a dataset note's source becomes a reachable link", () => {
  it("links an http(s) URL in a note", () => {
    const segs = linkifyNote("Source: https://archive.ics.uci.edu/dataset/1");
    expect(segs).toEqual([
      { kind: "text", text: "Source: " },
      {
        kind: "link",
        text: "https://archive.ics.uci.edu/dataset/1",
        href: "https://archive.ics.uci.edu/dataset/1",
      },
    ]);
  });

  it("leaves surrounding prose as text", () => {
    const segs = linkifyNote("Derived from https://ex.org/d and normalised.");
    expect(segs.map((s) => s.kind)).toEqual(["text", "link", "text"]);
    expect(segs[2]).toEqual({ kind: "text", text: " and normalised." });
  });

  it("does not carry a trailing full stop into the link", () => {
    const segs = linkifyNote("See https://ex.org/x.");
    const link = segs.find((s) => s.kind === "link");
    expect(link).toEqual({ kind: "link", text: "https://ex.org/x", href: "https://ex.org/x" });
    expect(segs[segs.length - 1]).toEqual({ kind: "text", text: "." });
  });

  it("refuses a javascript: pseudo-URL, leaving it as text", () => {
    const segs = linkifyNote("Source: javascript:alert(1)");
    expect(segs.every((s) => s.kind === "text")).toBe(true);
  });

  it("does not linkify a bare word that is not a URL", () => {
    const segs = linkifyNote("Ki only. No imputation.");
    expect(segs).toEqual([{ kind: "text", text: "Ki only. No imputation." }]);
  });

  it("handles two URLs in one note", () => {
    const segs = linkifyNote("a https://x.org b https://y.org c");
    expect(segs.filter((s) => s.kind === "link").map((s) => s.text)).toEqual([
      "https://x.org",
      "https://y.org",
    ]);
  });

  it("reconstructs the original text exactly", () => {
    const note = "Compare https://a.org/1 with https://b.org/2, then stop.";
    expect(linkifyNote(note).map((s) => s.text).join("")).toBe(note);
  });
});
