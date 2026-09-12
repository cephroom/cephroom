import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveContentPaths } from "../../node/config";
import { ROOT } from "../contracts/scan";

const NODE_DIR = join(ROOT, "node");

describe("a bare node serves nothing", () => {
  it("does not default to the demo content directory", () => {
    const paths = resolveContentPaths([], {}, NODE_DIR, "/some/workdir");
    expect(
      paths.contentDir,
      "A bare node must not point at node/content - the platform launches empty; the demo is opt-in.",
    ).not.toBe(resolve(NODE_DIR, "content"));
    expect(paths.demo).toBe(false);
  });

  it("points a bare node at a working-directory content dir that a fresh checkout lacks", () => {
    const paths = resolveContentPaths([], {}, NODE_DIR, "/some/workdir");
    expect(paths.contentDir).toBe(resolve("/some/workdir", "content"));
  });

  it("serves the demo only when --demo is asked for", () => {
    const paths = resolveContentPaths(["--demo"], {}, NODE_DIR, "/some/workdir");
    expect(paths.contentDir).toBe(resolve(NODE_DIR, "content"));
    expect(paths.dataDir).toBe(resolve(NODE_DIR, "data"));
    expect(paths.demo).toBe(true);
  });

  it("honours an explicit --content over everything", () => {
    const paths = resolveContentPaths(
      ["--content", "/my/columns"],
      {},
      NODE_DIR,
      "/some/workdir",
    );
    expect(paths.contentDir).toBe(resolve("/my/columns"));
    expect(paths.dataDir).toBe(resolve("/my/columns"));
  });

  it("honours CONTENT_DIR from the environment", () => {
    const paths = resolveContentPaths(
      [],
      { CONTENT_DIR: "/env/columns" },
      NODE_DIR,
      "/some/workdir",
    );
    expect(paths.contentDir).toBe(resolve("/env/columns"));
  });
});

describe("no page claims a bare node serves demo content", () => {
  const contribute = readFileSync(
    join(ROOT, "src", "app", "contribute", "page.tsx"),
    "utf8",
  ).replace(/\s+/g, " ");
  const readme = readFileSync(join(ROOT, "README.md"), "utf8").replace(/\s+/g, " ");

  it("contribute does not say a bare node serves the demo", () => {
    expect(
      contribute,
      'The /contribute page must not tell a reader that running the node "with no arguments" serves demo content. A bare node serves nothing.',
    ).not.toMatch(/no arguments it serves the demo|with no arguments.{0,40}demo/i);
  });

  it("contribute states plainly that a bare node serves nothing", () => {
    expect(contribute).toMatch(/serves nothing|empty|nothing until you|bring your own/i);
  });

  it("README shows the demo as an explicit opt-in, not the default", () => {
    expect(readme).not.toMatch(/with no arguments this serves the demo/i);
    expect(readme).toMatch(/--demo/);
  });
});

describe("the demo content still exists for local development", () => {
  it("keeps the demo columns in the repository", () => {
    const columns = readdirSync(join(NODE_DIR, "content")).filter((f) =>
      f.endsWith(".md"),
    );
    expect(
      columns.length,
      "The demo columns stay in the repo for local dev (npm run node:serve -- --demo); they are just not what a bare node serves.",
    ).toBeGreaterThan(0);
  });
});
