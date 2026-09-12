import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsAndStrings, walk } from "./scan";

/**
 * A proposal is attributable to a subject, never to a person.
 *
 * Contract 1 forbids the platform holding a display name. It said nothing
 * about a *contributor* holding one, and that is where it ended up: the
 * reader's Google display name rode along in the node key, the propose form
 * posted it as `fromName`, and the node wrote it into a JSON file on its
 * owner's disk with no expiry and no way to remove it.
 *
 * Read plainly, that is the platform arranging for a person's real name to be
 * stored permanently on a stranger's machine as a side effect of disagreeing
 * with an article — the exact outcome both contracts exist to prevent, moved
 * one hop away so that neither's tests were looking at it. "The platform does
 * not store it" was true and beside the point.
 *
 * Attribution is still required: an anonymous proposal lands on somebody's
 * disk with nobody to answer for it, and the node rightly refuses one. But
 * the thing it has to be attributable *to* is the pseudonymous subject, which
 * is stable, unforgeable, and reveals nothing. A contributor can tell two
 * proposers apart and can see that the same person came back. They cannot
 * learn who either of them is.
 */

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
        fromSub: "s_reviewer",
      });

      // Pinned exactly. A proposal is a diff plus who to answer, and the
      // fields are few enough to enumerate — which is the point.
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
    // Pseudonymous is not anonymous. An anonymous reading token deliberately
    // cannot propose: the node has to have somebody to answer, even if it
    // never learns who they are.
    const server = readFileSync(join(ROOT, "node", "server.ts"), "utf8");
    expect(server).toMatch(/A proposal has to be attributable/i);
    expect(server).toMatch(/write:propose/);
  });
});

describe("the platform never learns a name to pass on", () => {
  it("reads no display name out of the identity provider", () => {
    // The profile step used to return `{ accountId, name }`, and the name had
    // nowhere to go except into a key. Not requesting it is stronger than
    // discarding it, for the same reason the email scope was dropped rather
    // than ignored.
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
    // This one is not sign-in data. It is chosen by the contributor with a
    // flag on their own node, it is the byline on their own work, and it is
    // never persisted by the platform. Removing it would be reading the
    // contract as banning attribution rather than banning identity.
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
