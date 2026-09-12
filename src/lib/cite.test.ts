import { describe, expect, it } from "vitest";

import { bibtexCitation, plainCitation, type Citation } from "./cite";

const base: Citation = {
  title: "The D2 window is a fact about patients",
  author: "Marcus Oyelaran",
  address: "http://127.0.0.1:4600",
  readAt: new Date("2026-09-12T21:24:34Z"),
  conclusion: "passing",
  counts: { verified: 8, drifted: 0, broken: 0 },
  datasets: [{ id: "receptorome-ki", release: "ChEMBL_37" }],
  repo: "https://example.org/marcus/d2",
  commit: "9f2c1ab",
};

describe("a citation dates the check, not the work", () => {
  it("says read, at the time of reading, never as-of or archived", () => {
    const text = plainCitation(base);
    expect(text).toMatch(/read 2026-09-12/);
    expect(text).toMatch(/at the time of reading/);
    expect(
      text,
      "A citation to a live, unarchived reading must not imply permanence. That overclaim is the one dishonesty this product cannot make, because content drift is the thing it exists to surface.",
    ).not.toMatch(/archived|as of|permanent|snapshot/i);
  });

  it("says plainly that it is not an archive", () => {
    expect(plainCitation(base)).toMatch(/[Nn]ot an archive/);
    expect(bibtexCitation(base)).toMatch(/[Nn]ot an archive/);
  });

  it("records what was verified and against which release", () => {
    expect(plainCitation(base)).toMatch(/all 8 claims verified against receptorome-ki @ChEMBL_37/);
  });

  it("does not claim everything passed when it did not", () => {
    const drifted = plainCitation({
      ...base,
      conclusion: "drifted",
      counts: { verified: 6, drifted: 2, broken: 0 },
    });
    expect(drifted).toMatch(/6 verified, 2 drifted/);
    expect(drifted).not.toMatch(/all \d+ claims verified/);
  });

  it("names unresolved claims as unresolved", () => {
    const broken = plainCitation({
      ...base,
      conclusion: "broken",
      counts: { verified: 5, drifted: 0, broken: 3 },
    });
    expect(broken).toMatch(/3 unresolved/);
  });

  it("handles a reading with no checkable claims without lying about it", () => {
    const none = plainCitation({
      ...base,
      conclusion: "empty",
      counts: { verified: 0, drifted: 0, broken: 0 },
      datasets: [],
    });
    expect(none).toMatch(/no checkable claims/);
    expect(none).not.toMatch(/verified/);
  });
});

describe("the citation carries the node address, because that is where it came from", () => {
  it("names the address in both forms", () => {
    expect(plainCitation(base)).toContain("http://127.0.0.1:4600");
    expect(bibtexCitation(base)).toContain("http://127.0.0.1:4600");
  });

  it("includes the repository when the column declared one", () => {
    expect(plainCitation(base)).toMatch(/Source: https:\/\/example\.org\/marcus\/d2 @9f2c1ab/);
    expect(bibtexCitation(base)).toMatch(/url = \{https:\/\/example\.org\/marcus\/d2\}/);
  });

  it("omits the repository cleanly when there is none", () => {
    const noRepo = plainCitation({ ...base, repo: null, commit: null });
    expect(noRepo).not.toMatch(/Source:/);
    expect(noRepo).not.toMatch(/undefined|null/);
  });
});

describe("BibTeX is valid enough for a reference manager", () => {
  it("escapes a brace in a contributor's title, so the entry does not break", () => {
    const bib = bibtexCitation({
      ...base,
      title: "A title with {braces} and a \\backslash",
    });
    expect(bib).toContain("A title with \\{braces\\} and a \\\\backslash");
  });

  it("produces a key of only safe characters", () => {
    const bib = bibtexCitation({
      ...base,
      author: "Иван Петров",
      title: "Ünïcode & symbols!",
    });
    const key = bib.match(/@misc\{([^,]+),/)?.[1] ?? "";
    expect(key).toMatch(/^[A-Za-z0-9]+$/);
  });

  it("opens and closes the entry", () => {
    const bib = bibtexCitation(base);
    expect(bib.startsWith("@misc{")).toBe(true);
    expect(bib.trimEnd().endsWith("}")).toBe(true);
  });
});
