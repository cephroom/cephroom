import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsAndStrings, walk } from "./scan";


describe("nothing carries a reader's name to a contributor", () => {
  it("has no fromName anywhere in the platform or the node", () => {
    const offenders: string[] = [];
    for (const root of ["src", "node"]) {
      for (const file of walk(join(ROOT, root))) {
        if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
        if (file.includes(".test.")) continue;
        const code = stripCommentsAndStrings(readFileSync(file, "utf8"));
        if (/\bfromName\b/.test(code)) {
          offenders.push(relative(ROOT, file).split(sep).join("/"));
        }
      }
    }
    expect(
      offenders,
      `A proposal is attributed to a subject. A name written to a contributor's disk cannot be withdrawn.\n${offenders.join("\n")}\n`,
    ).toEqual([]);
  });

  it("stores a subject and no other identity field on a proposal", async () => {
    const { ProposalStore } = await import("../../node/proposals");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");

    const dir = mkdtempSync(join(tmpdir(), "cephroom-attribution-"));
    try {
      const store = new ProposalStore(dir);
      const proposal = store.create({
        columnId: "col",
        title: "A title",
        rationale: "A reason",
        body: "A suggestion",
        fromSub: "n_reviewer",
      });

      expect(Object.keys(proposal).sort()).toEqual(
        [
          "body",
          "columnId",
          "createdAt",
          "fromSub",
          "id",
          "rationale",
          "resolvedAt",
          "status",
          "title",
        ].sort(),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still refuses an unattributed proposal", () => {
    const server = readFileSync(join(ROOT, "node", "server.ts"), "utf8");
    expect(server).toMatch(/A proposal has to be attributable/i);
    expect(server).toMatch(/write:propose/);
  });
});

describe("the platform never learns a name to pass on", () => {
  it("reads no display name out of the identity provider", () => {
    const providers = stripCommentsAndStrings(
      readFileSync(join(ROOT, "src", "lib", "auth", "providers.ts"), "utf8"),
    );
    expect(providers).not.toMatch(/\bname\s*:/);
    expect(providers).not.toMatch(/raw\.name|raw\.login/);
  });

  it("sends no name to a node when a reader opens a column", () => {
    const page = stripCommentsAndStrings(
      readFileSync(
        join(ROOT, "src", "app", "read", "[sub]", "[id]", "page.tsx"),
        "utf8",
      ),
    );
    const mint = page.slice(page.indexOf("mintNodeKey"));
    expect(mint.slice(0, 200)).not.toMatch(/\bname\b/);
  });
});

describe("a contributor's own byline is a different thing, and stays", () => {
  it("keeps the self-declared display name on an announcement", async () => {
    const { announcementSchema } = await import("@/lib/signaling/announcement");
    const parsed = announcementSchema.safeParse({
      displayName: "Marcus Oyelaran",
      address: "http://127.0.0.1:4600",
      items: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("takes it from the node's own flag, never from a sign-in", () => {
    const server = readFileSync(join(ROOT, "node", "server.ts"), "utf8");
    expect(server).toMatch(/DISPLAY_NAME = flag\("name"/);
  });
});
