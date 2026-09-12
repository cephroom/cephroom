import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProposalStore, proposalId } from "../../node/proposals";

/**
 * Identifiers derive from content.
 *
 * This clause of Contract 2 had no implementation anywhere. Proposal ids were
 * `p_${randomUUID()}`, which makes the name of a piece of writing an accident
 * of when it was written — and in a system that deliberately keeps no index,
 * an accidental name is worse than it sounds, because there is nothing to
 * look it up in later. A content-derived id is the only kind that can be
 * recomputed by somebody holding the thing it names.
 *
 * Three properties follow, and each is worth having on its own:
 *
 *   - **Verifiable.** Anyone with the proposal can recompute the id and check
 *     they were given what they asked for. With a random id you are trusting
 *     whoever served it.
 *   - **Idempotent.** Submitting the same edit twice is the same edit. The
 *     retry after a dropped connection stops creating a duplicate, and the
 *     flood limiter stops being defeatable by pressing the button again.
 *   - **Independent of time.** No clock, no counter, no randomness — so two
 *     nodes holding the same proposal agree on its name without talking.
 *
 * Item ids are deliberately *not* changed. A column's slug is a name its
 * author chose and re-serves across edits; deriving it from the body would
 * change the URL on every typo fix. Names and content-addresses answer
 * different questions, and the collision problem a content-address would have
 * solved is already handled by scoping lookup to the announcing subject —
 * see tests/contracts/signal-auth.test.ts.
 */

let dir: string;
let store: ProposalStore;

const proposal = {
  columnId: "d2-window",
  title: "The gap is within the standard error",
  rationale: "2.02 against an SE of 2.99 does not support a direction.",
  body: "The sentence should say the difference is not resolvable.",
  fromSub: "s_reviewer",
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
    // Called twice with no store involved: same input, same name. A UUID
    // fails this, and so does anything that folds in a timestamp.
    expect(proposalId(proposal)).toBe(proposalId(proposal));
  });

  it("changes the id when any part of the proposal changes", () => {
    const base = proposalId(proposal);
    expect(proposalId({ ...proposal, body: "Something else." })).not.toBe(base);
    expect(proposalId({ ...proposal, title: "Another title" })).not.toBe(base);
    expect(proposalId({ ...proposal, rationale: "Another reason" })).not.toBe(base);
    expect(proposalId({ ...proposal, columnId: "another-column" })).not.toBe(base);
    // Two people may independently propose the same edit, and those are two
    // proposals: the author has two people to answer, not one.
    expect(proposalId({ ...proposal, fromSub: "s_other" })).not.toBe(base);
  });

  it("cannot be confused by a field boundary moving", () => {
    // Naive concatenation makes ("ab","c") and ("a","bc") the same proposal.
    // The separator has to be one the fields cannot contain.
    const a = proposalId({ ...proposal, title: "ab", rationale: "c" });
    const b = proposalId({ ...proposal, title: "a", rationale: "bc" });
    expect(a).not.toBe(b);
  });

  it("is recomputable by anyone holding the proposal", () => {
    const created = store.create(proposal);
    // The whole point of a content address: the reader checks the name
    // against the bytes rather than trusting whoever handed them over.
    expect(proposalId(created)).toBe(created.id);
  });

  it("is a safe filename and carries no readable content", () => {
    const id = proposalId(proposal);
    expect(id).toMatch(/^p_[0-9a-f]{32}$/);
    // A hash, not a slug. An id that embedded the title would leak a withheld
    // proposal's subject through a directory listing.
    expect(id).not.toMatch(/gap|window|reviewer/i);
  });
});

describe("submitting the same edit twice is submitting it once", () => {
  it("returns the existing proposal rather than writing a second", () => {
    const first = store.create(proposal);
    const second = store.create(proposal);

    expect(second.id).toBe(first.id);
    expect(store.list("d2-window")).toHaveLength(1);
    // And the original survives intact: a resubmission must not reset the
    // author's timestamps or their decision.
    expect(second.createdAt).toBe(first.createdAt);
  });

  it("does not resurrect a proposal the author has already dealt with", () => {
    // The failure mode of naive idempotence. If a closed proposal were
    // overwritten by a resubmission, anybody could reopen a decision by
    // pressing the button again — and the flood limiter would be a no-op.
    const created = store.create(proposal);
    store.resolve(created.id, "closed");

    const resubmitted = store.create(proposal);
    expect(resubmitted.status).toBe("closed");
    expect(store.openFromSubject("d2-window", "s_reviewer")).toBe(0);
  });

  it("still counts genuinely different proposals separately", () => {
    store.create(proposal);
    store.create({ ...proposal, body: "A different suggestion entirely." });
    expect(store.openFromSubject("d2-window", "s_reviewer")).toBe(2);
  });
});
