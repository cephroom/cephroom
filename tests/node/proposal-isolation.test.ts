import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProposalStore, proposalRootFor } from "../../node/proposals";


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

    expect(marcus.list("d2-occupancy-window")).toHaveLength(1);
    expect(ines.list("d2-occupancy-window")).toHaveLength(0);
  });

  it("does not let one contributor's backlog inflate the other's count", () => {
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

    expect(ines.get(mine.id)).toBeNull();
    expect(ines.resolve(mine.id, "closed")).toBeNull();
    expect(marcus.get(mine.id)?.status).toBe("open");
  });
});

describe("the store is rooted by the content it belongs to", () => {
  it("derives the root from the content directory, not the source tree", () => {
    const a = proposalRootFor(join(scratch, "marcus", "content"));
    const b = proposalRootFor(join(scratch, "ines", "content"));
    expect(a).not.toBe(b);
  });

  it("puts the store beside the content rather than inside it", () => {
    const root = proposalRootFor(join(scratch, "marcus", "content"));
    expect(root).toBe(join(scratch, "marcus"));
  });

  it("keeps the default node exactly where it was", () => {
    const nodeDir = resolve(scratch, "cephroom", "node");
    expect(proposalRootFor(join(nodeDir, "content"))).toBe(nodeDir);
  });

  it("returns an absolute path, so it does not move with the process", () => {
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
