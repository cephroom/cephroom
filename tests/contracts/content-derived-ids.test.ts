import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProposalStore, proposalId } from "../../node/proposals";


let dir: string;
let store: ProposalStore;

const proposal = {
  columnId: "d2-window",
  title: "The gap is within the standard error",
  rationale: "2.02 against an SE of 2.99 does not support a direction.",
  body: "The sentence should say the difference is not resolvable.",
  fromSub: "n_reviewer",
  fromName: "A reviewer",
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cephroom-content-ids-"));
  store = new ProposalStore(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("a proposal is named by what it says", () => {
  it("derives the id from the content, not from a clock or a random source", () => {
    expect(proposalId(proposal)).toBe(proposalId(proposal));
  });

  it("changes the id when any part of the proposal changes", () => {
    const base = proposalId(proposal);
    expect(proposalId({ ...proposal, body: "Something else." })).not.toBe(base);
    expect(proposalId({ ...proposal, title: "Another title" })).not.toBe(base);
    expect(proposalId({ ...proposal, rationale: "Another reason" })).not.toBe(base);
    expect(proposalId({ ...proposal, columnId: "another-column" })).not.toBe(base);
    expect(proposalId({ ...proposal, fromSub: "n_other" })).not.toBe(base);
  });

  it("cannot be confused by a field boundary moving", () => {
    const a = proposalId({ ...proposal, title: "ab", rationale: "c" });
    const b = proposalId({ ...proposal, title: "a", rationale: "bc" });
    expect(a).not.toBe(b);
  });

  it("is recomputable by anyone holding the proposal", () => {
    const created = store.create(proposal);
    expect(proposalId(created)).toBe(created.id);
  });

  it("is a safe filename and carries no readable content", () => {
    const id = proposalId(proposal);
    expect(id).toMatch(/^p_[0-9a-f]{32}$/);
    expect(id).not.toMatch(/gap|window|reviewer/i);
  });
});

describe("submitting the same edit twice is submitting it once", () => {
  it("returns the existing proposal rather than writing a second", () => {
    const first = store.create(proposal);
    const second = store.create(proposal);

    expect(second.id).toBe(first.id);
    expect(store.list("d2-window")).toHaveLength(1);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it("does not resurrect a proposal the author has already dealt with", () => {
    const created = store.create(proposal);
    store.resolve(created.id, "closed");

    const resubmitted = store.create(proposal);
    expect(resubmitted.status).toBe("closed");
    expect(store.openFromSubject("d2-window", "n_reviewer")).toBe(0);
  });

  it("still counts genuinely different proposals separately", () => {
    store.create(proposal);
    store.create({ ...proposal, body: "A different suggestion entirely." });
    expect(store.openFromSubject("d2-window", "n_reviewer")).toBe(2);
  });
});
