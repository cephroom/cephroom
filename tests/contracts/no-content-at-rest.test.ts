import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { describeHits, ROOT, scan, walk, type Rule } from "./scan";

/**
 * Contract 2 — the platform never stores shared content.
 *
 * Two kinds of check. A static one, that no code in the platform can write
 * bytes anywhere. And a behavioural one: exercise the signaling server the
 * way a contributor and a reader would, and assert that nothing appeared on
 * disk as a result.
 */

const PLATFORM_ROOTS = ["src"];

describe("Contract 2: the platform cannot write content", () => {
  it("has no write path to the filesystem", () => {
    const rules: Rule[] = [
      {
        name: "fs-write",
        pattern:
          /\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|mkdirSync)\s*\(/,
        allow: ["simulated-counterparties/"],
      },
    ];
    const hits = scan(PLATFORM_ROOTS, rules);
    expect(hits.length, `\n${describeHits(hits)}\n`).toBe(0);
  });

  it("has no object storage or blob client", () => {
    const rules: Rule[] = [
      {
        name: "blob-store",
        pattern:
          /@vercel\/blob|@aws-sdk\/client-s3|\bS3Client\b|@google-cloud\/storage|cloudinary/i,
      },
    ];
    const hits = scan(PLATFORM_ROOTS, rules);
    expect(hits.length, `\n${describeHits(hits)}\n`).toBe(0);
  });

  it("never proxies a fetch of contributor content through the server", () => {
    // A server-side fetch of a node's content endpoint would put the bytes in
    // the platform's memory and make it a proxy. Readers fetch nodes directly
    // from the browser.
    const rules: Rule[] = [
      {
        name: "server-side-node-fetch",
        pattern: /fetchNodeContent|proxyNode|\bpipeThrough\s*\(/,
      },
    ];
    const hits = scan(PLATFORM_ROOTS, rules);
    expect(hits.length, `\n${describeHits(hits)}\n`).toBe(0);
  });
});

describe("Contract 2: content is not durable in the repository either", () => {
  it("ships no stored column bodies", () => {
    // content/ held the seeded columns when the platform stored them. They
    // belong to a node now, under node/.
    const strays = walk(join(ROOT, "content"), [".md", ".mdx"]).map((file) =>
      relative(ROOT, file).split(sep).join("/"),
    );
    expect(
      strays,
      "Column bodies live in a contributor's node, not in the platform repository.",
    ).toEqual([]);
  });
});

describe("Contract 2: exercising the platform leaves nothing behind", () => {
  it("writes no files while registering, announcing, and disconnecting", async () => {
    // A scratch working directory, so a stray relative-path write lands
    // somewhere observable rather than in the repo.
    const scratch = mkdtempSync(join(tmpdir(), "cephroom-contract-"));
    const before = snapshot(scratch);

    const previousCwd = process.cwd();
    process.chdir(scratch);

    try {
      const { createRegistry } = await import("@/lib/signaling/registry");
      const registry = createRegistry();

      const handle = registry.announce({
        sub: "sub_contract_test",
        displayName: "Contract Test Node",
        address: "http://127.0.0.1:4599",
        items: [
          { id: "a-column", title: "A column", kind: "column", tags: [] },
          { id: "a-dataset", title: "A dataset", kind: "dataset", tags: [] },
        ],
      });

      expect(registry.list()).toHaveLength(1);
      expect(registry.find("sub_contract_test", "a-column")).not.toBeNull();

      handle.close();

      // The whole of Contract 2 in three assertions: the moment the
      // connection ends the content is gone, and nothing was written.
      expect(registry.list()).toHaveLength(0);
      expect(registry.find("sub_contract_test", "a-column")).toBeNull();
    } finally {
      process.chdir(previousCwd);
    }

    expect(
      snapshot(scratch),
      "Something wrote to disk while the registry was exercised.",
    ).toEqual(before);

    rmSync(scratch, { recursive: true, force: true });
  });
});

function snapshot(dir: string): string[] {
  const out: string[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) visit(full);
      else out.push(relative(dir, full).split(sep).join("/"));
    }
  };
  visit(dir);
  return out.sort();
}
