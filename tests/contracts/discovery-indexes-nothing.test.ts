import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsAndStrings, stripCommentsOnly, walk } from "./scan";


function platformSources() {
  return walk(join(ROOT, "src"))
    .filter((f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.includes(".test."))
    .map((file) => ({
      rel: relative(ROOT, file).split(sep).join("/"),
      code: stripCommentsAndStrings(readFileSync(file, "utf8")),
    }));
}

describe("nothing is indexed", () => {
  it("declares no search index, anywhere", () => {
    const banned = [
      "lunr",
      "flexsearch",
      "minisearch",
      "elasticsearch",
      "opensearch",
      "meilisearch",
      "typesense",
      "algolia",
      "invertedIndex",
      "buildIndex",
      "indexDocument",
      "reindex",
      "crawlQueue",
      "embedding",
      "vectorStore",
    ];
    for (const { rel, code } of platformSources()) {
      for (const name of banned) {
        expect(code.toLowerCase(), `${rel} uses ${name}`).not.toContain(
          name.toLowerCase(),
        );
      }
    }
  });

  it("searches the registry and nothing else", async () => {
    const registry = stripCommentsOnly(
      readFileSync(join(ROOT, "src", "lib", "signaling", "registry.ts"), "utf8"),
    );
    const search = registry.slice(registry.indexOf("search(query)"));
    expect(search).toContain("registry.list()");
    expect(search).not.toMatch(/readFile|fetch\s*\(|db|redis|cache/i);
  });

  it("searches only what a node chose to announce", async () => {
    const { createRegistry } = await import("@/lib/signaling/registry");
    const shelf = createRegistry();
    shelf.announce({
      sub: "s_a",
      displayName: "Ada",
      address: "http://127.0.0.1:4600",
      items: [
        {
          id: "c",
          title: "A title",
          kind: "column",
          tags: ["tagged"],
          summary: "A summary",
        },
      ],
    });

    expect(shelf.search("title")).toHaveLength(1);
    expect(shelf.search("summary")).toHaveLength(1);
    expect(shelf.search("tagged")).toHaveLength(1);
    expect(shelf.search("Ada")).toHaveLength(1);
    expect(shelf.search("a phrase from the body")).toHaveLength(0);
  });

  it("forgets everything it could have searched when the lease lapses", async () => {
    const { createRegistry } = await import("@/lib/signaling/registry");
    let clock = 1_000_000;
    const shelf = createRegistry(() => clock);
    shelf.announce({
      sub: "s_a",
      displayName: "Ada",
      address: "http://127.0.0.1:4600",
      items: [{ id: "c", title: "Findable", kind: "column", tags: [] }],
    });

    expect(shelf.search("Findable")).toHaveLength(1);
    clock += 60_000;
    expect(shelf.search("Findable")).toHaveLength(0);
  });
});

describe("deeper discovery happens on the consumer's machine", () => {
  it("hands out endpoints rather than results from inside content", () => {
    const live = stripCommentsOnly(
      readFileSync(
        join(ROOT, "src", "app", "api", "v1", "live", "route.ts"),
        "utf8",
      ),
    );
    expect(live).toContain("address");
    expect(live).toContain("fetch:");
  });

  it("makes no request to a node while answering a query", () => {
    const live = stripCommentsAndStrings(
      readFileSync(
        join(ROOT, "src", "app", "api", "v1", "live", "route.ts"),
        "utf8",
      ),
    );
    expect(live).not.toMatch(/\bfetch\s*\(/);
  });

  it("sells reach as a number, not as a different kind of answer", async () => {
    const { DISCOVERY_REACH, DISCOVERY_CONCURRENCY } = await import(
      "@/lib/stripe/plans"
    );
    expect(DISCOVERY_REACH.browse).toBeLessThan(DISCOVERY_REACH.query);
    expect(DISCOVERY_REACH.query).toBeLessThan(DISCOVERY_REACH.sweep);
    expect(DISCOVERY_CONCURRENCY.browse).toBeLessThan(
      DISCOVERY_CONCURRENCY.sweep,
    );
  });

  it("gives the free plan a real listing, not a teaser", async () => {
    const { DISCOVERY_REACH } = await import("@/lib/stripe/plans");
    expect(DISCOVERY_REACH.browse).toBeGreaterThanOrEqual(50);
  });
});

describe("the honest limit is stated rather than hidden", () => {
  it("says on the pricing page that offline work is not findable at any price", () => {
    const pricing = readFileSync(
      join(ROOT, "src", "app", "pricing", "page.tsx"),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(pricing).toMatch(
      /nothing that is offline|not (?:findable|searchable) .*offline|only what is online|presence/i,
    );
  });

  it("does not promise an archive, a history, or a cache", () => {
    const pricing = stripCommentsAndStrings(
      readFileSync(join(ROOT, "src", "app", "pricing", "page.tsx"), "utf8"),
    ).toLowerCase();
    for (const promise of ["archive", "full-text", "cached copy", "snapshot"]) {
      expect(pricing, `pricing promises "${promise}"`).not.toContain(promise);
    }
  });
});
