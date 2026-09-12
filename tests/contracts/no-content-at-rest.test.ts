import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  describeHits,
  ROOT,
  scan,
  stripCommentsOnly,
  walk,
  type Rule,
} from "./scan";


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

function isColumn(source: string): boolean {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return false;
  return /^slug:/m.test(match[1]) && /^title:/m.test(match[1]);
}

describe("Contract 2: the platform ships no column bodies of its own", () => {
  it("has no column anywhere in the platform tree", () => {
    const strays = walk(join(ROOT, "src"), [".md", ".mdx", ".txt", ".json"])
      .filter((file) => isColumn(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file).split(sep).join("/"));

    expect(
      strays,
      [
        "A column is a Markdown file with front matter naming a slug and a title.",
        "One under src/ is a column the platform is shipping rather than brokering,",
        "which is the same thing as hosting it.",
        "",
        "node/content/ is deliberately NOT scanned here: those files are a",
        "contributor's own disk, served by their own process. That is the",
        "architecture working, not a violation. The platform is src/.",
        "",
        ...strays,
      ].join("\n"),
    ).toEqual([]);
  });

  it("names no content directory it could read one from", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
      if (file.includes(".test.")) continue;
      const code = stripCommentsOnly(readFileSync(file, "utf8"));
      if (/["'`][^"'`]*\bnode\/content\b|CONTENT_DIR|contentDir/.test(code)) {
        offenders.push(relative(ROOT, file).split(sep).join("/"));
      }
    }
    expect(
      offenders,
      `These name a content directory. The platform has no business knowing where a column lives on anybody's disk.\n${offenders.join("\n")}\n`,
    ).toEqual([]);
  });

  it("would notice a column that appeared under src/", () => {
    const scratch = mkdtempSync(join(tmpdir(), "cephroom-column-"));
    try {
      const stray = join(scratch, "smuggled.md");
      writeFileSync(
        stray,
        "---\nslug: smuggled\ntitle: A column the platform is hosting\n---\n\nBody.\n",
      );
      expect(isColumn(readFileSync(stray, "utf8"))).toBe(true);
      expect(isColumn("# Just a heading\n\nNot a column.\n")).toBe(false);
      expect(isColumn("---\nfoo: bar\n---\n\nFront matter, but not a column.\n")).toBe(
        false,
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("confirms the contributor's own columns are still where they belong", () => {
    const columns = walk(join(ROOT, "node", "content"), [".md"]).filter((file) =>
      isColumn(readFileSync(file, "utf8")),
    );
    expect(
      columns.length,
      "node/content/ holds the demo columns a fresh clone serves with no arguments. Empty means `npm run node:serve` now announces nothing, and /contribute says otherwise.",
    ).toBeGreaterThan(0);
  });
});

describe("Contract 2: exercising the platform leaves nothing behind", () => {
  it("writes no files while registering, announcing, and disconnecting", async () => {
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
