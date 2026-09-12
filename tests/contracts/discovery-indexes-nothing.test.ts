import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsAndStrings, stripCommentsOnly, walk } from "./scan";

/**
 * The platform sells the map. It does not keep the territory.
 *
 * Discovery is the one thing the platform genuinely owns — content lives on
 * other people's machines, but finding it is ours — so it is what a consumer
 * subscription buys. The obvious way to make search "deeper" is to build an
 * index, and that is exactly what Contract 2 forbids: an index of everything
 * is a copy of everything, held here, surviving the contributor who stopped
 * serving.
 *
 * So "deeper" cannot mean "we looked inside". It means reach:
 *
 *   - The platform searches **presence only** — the id, title, summary and
 *     tags a node announced, held in memory for the length of a lease and
 *     gone when it lapses. That is not an index at rest; it is the listing,
 *     and it disappears with the node.
 *   - Searching *inside* content is done by the consumer's own client, which
 *     fetches from nodes directly. The platform never has the bytes and
 *     cannot search them even if it wanted to.
 *   - What a plan buys is how much of the map you get: results per query, and
 *     how many node endpoints you are handed to crawl at once. The index that
 *     results is built in the consumer's machine, from the nodes, and belongs
 *     to them.
 *
 * The honest consequence, which the copy has to carry: a column that went
 * offline is not findable here, however deep your plan. That is the same
 * "discovery is presence" the free tier gets, at a larger scale.
 */

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
    // Named rather than inferred: these are the things somebody reaches for
    // when asked to make search better, and each one is a copy of what other
    // people are serving.
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
    // The one search function in the platform reads live presence. If it ever
    // read from anywhere durable, that source would be the index.
    const registry = stripCommentsOnly(
      readFileSync(join(ROOT, "src", "lib", "signaling", "registry.ts"), "utf8"),
    );
    const search = registry.slice(registry.indexOf("search(query)"));
    expect(search).toContain("registry.list()");
    expect(search).not.toMatch(/readFile|fetch\s*\(|db|redis|cache/i);
  });

  it("searches only what a node chose to announce", async () => {
    // Title, summary, tags, byline. Not body text — the platform has never
    // had any, and a search that matched on it would mean it did.
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
    // Nothing from inside the column, because nothing from inside it is here.
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
    // The property that makes this not an index: it is gone, not archived.
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
    // The address is the product. A client crawls it; we do not.
    expect(live).toContain("address");
    expect(live).toContain("fetch:");
  });

  it("makes no request to a node while answering a query", () => {
    // The tempting implementation of "deeper search": fetch each node and
    // grep it server-side. That would put the platform in the content path
    // and give it, however briefly, a copy of everything.
    const live = stripCommentsAndStrings(
      readFileSync(
        join(ROOT, "src", "app", "api", "v1", "live", "route.ts"),
        "utf8",
      ),
    );
    expect(live).not.toMatch(/\bfetch\s*\(/);
  });

  it("sells reach as a number, not as a different kind of answer", async () => {
    // Every plan runs the same query against the same presence. A paid plan
    // returns more of it and clears the client to fetch more nodes at once.
    // There is no query a paying consumer can run that a free one cannot.
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
    // Discovery is the platform's product, so the temptation is to cripple
    // the free one. A network with fewer than fifty live items — which is
    // where this starts — must be fully visible without paying.
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
