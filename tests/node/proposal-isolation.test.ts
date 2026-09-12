import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProposalStore, proposalRootFor } from "../../node/proposals";

/**
 * One contributor's inbox is not another's.
 *
 * Found by running two contributors at once. The node rooted its proposal
 * store at `import.meta.dirname` — the *source* directory — so every node
 * started from the same checkout wrote into `node/proposals`, whatever
 * `--content` said. Two contributors on one machine shared an inbox.
 *
 * That is only latent until their item ids collide, and item ids are
 * author-chosen slugs that explicitly are not globally unique — the same fact
 * that produced the discovery hijack in
 * tests/contracts/signal-auth.test.ts. Both test nodes served datasets called
 * `receptorome-ki`, and giving them a column slug in common was enough:
 *
 *   proposed to node A: 201
 *   Ines can read a proposal addressed to Marcus: true
 *     "PRIVATE-TO-MARCUS this edit is for Marcus only"
 *
 * A proposal is a reader's own writing, sent to one named person, and the
 * propose page tells them it "goes straight to their machine". It went to
 * somebody else's as well. Contract 2's bend for the node — "it is the
 * contributor's own machine, that is the entire point" — is the whole
 * justification for a node writing to disk at all, and it assumes one
 * contributor per store.
 *
 * The store is now rooted beside the content it belongs to, so isolation
 * follows from the flag a contributor already has to set.
 */

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "cephroom-isolation-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const proposal = (title: string) => ({
  columnId: "d2-occupancy-window",
  title,
  rationale: "",
  body: `body of ${title}`,
  fromSub: "n_reader",
});

describe("two contributors on one machine keep separate inboxes", () => {
  it("does not show one contributor's proposals to the other", () => {
    const marcus = new ProposalStore(join(scratch, "marcus"));
    const ines = new ProposalStore(join(scratch, "ines"));

    marcus.create(proposal("PRIVATE-TO-MARCUS"));

    // Same column id on purpose: slugs are author-chosen and collide. That is
    // the condition under which a shared store leaks, so it is the condition
    // the test uses.
    expect(marcus.list("d2-occupancy-window")).toHaveLength(1);
    expect(ines.list("d2-occupancy-window")).toHaveLength(0);
  });

  it("does not let one contributor's backlog inflate the other's count", () => {
    // `openProposals` rides on the manifest and into the registry, so a
    // shared store also misreports how much work a contributor has waiting.
    const marcus = new ProposalStore(join(scratch, "marcus"));
    const ines = new ProposalStore(join(scratch, "ines"));

    marcus.create(proposal("one"));
    marcus.create(proposal("two"));

    expect(marcus.countOpen("d2-occupancy-window")).toBe(2);
    expect(ines.countOpen("d2-occupancy-window")).toBe(0);
  });

  it("does not let one contributor's readers exhaust the other's flood limit", () => {
    const marcus = new ProposalStore(join(scratch, "marcus"));
    const ines = new ProposalStore(join(scratch, "ines"));

    for (let i = 0; i < 3; i += 1) marcus.create(proposal(`flood ${i}`));

    expect(marcus.openFromSubject("d2-occupancy-window", "n_reader")).toBe(3);
    expect(ines.openFromSubject("d2-occupancy-window", "n_reader")).toBe(0);
  });

  it("cannot resolve a proposal that belongs to the other", () => {
    const marcus = new ProposalStore(join(scratch, "marcus"));
    const ines = new ProposalStore(join(scratch, "ines"));

    const mine = marcus.create(proposal("PRIVATE-TO-MARCUS"));

    // Closing somebody else's proposal would be a takedown of a reader's
    // writing by a contributor it was never addressed to.
    expect(ines.get(mine.id)).toBeNull();
    expect(ines.resolve(mine.id, "closed")).toBeNull();
    expect(marcus.get(mine.id)?.status).toBe("open");
  });
});

describe("the store is rooted by the content it belongs to", () => {
  it("derives the root from the content directory, not the source tree", () => {
    // The bug in one assertion: the answer must depend on the argument.
    const a = proposalRootFor(join(scratch, "marcus", "content"));
    const b = proposalRootFor(join(scratch, "ines", "content"));
    expect(a).not.toBe(b);
  });

  it("puts the store beside the content rather than inside it", () => {
    // Inside would make proposals look like publishable source to anything
    // that walks the content directory, including the node's own reader.
    const root = proposalRootFor(join(scratch, "marcus", "content"));
    expect(root).toBe(join(scratch, "marcus"));
  });

  it("keeps the default node exactly where it was", () => {
    // A contributor who has been running the default layout must not find
    // their backlog silently relocated by this change. Resolved on both sides
    // because the answer is an absolute path and this repository is developed
    // on Windows and deployed on Linux.
    const nodeDir = resolve(scratch, "cephroom", "node");
    expect(proposalRootFor(join(nodeDir, "content"))).toBe(nodeDir);
  });

  it("returns an absolute path, so it does not move with the process", () => {
    // A relative root would follow `process.cwd()`, which is whatever
    // directory the contributor happened to launch the node from.
    expect(isAbsolute(proposalRootFor(join("content")))).toBe(true);
  });

  it("creates the directory on demand, wherever it is pointed", () => {
    const root = join(scratch, "fresh", "contributor");
    mkdirSync(root, { recursive: true });
    const store = new ProposalStore(root);
    expect(store.list()).toEqual([]);
    store.create(proposal("first"));
    expect(store.list()).toHaveLength(1);
  });
});
