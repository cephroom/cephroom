import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProposalStore } from "../../node/proposals";

/**
 * Regression tests for the proposal-flood limiter.
 *
 * A node writes to its owner's disk, which is the one place in this system
 * where writing is the entire point. A proposal is the one thing a stranger
 * can cause a node to write, which makes it the one disk-fill vector.
 *
 * Attacking the local node showed a member could POST unbounded bytes and
 * unbounded proposals to fill it. The node now caps body size and field
 * lengths at the door and gates on openFromSubject; this covers the count
 * gate the node consults. Content-derived ids close the other half — see
 * tests/contracts/content-derived-ids.test.ts — since resubmitting the same
 * proposal used to be a way past the count.
 */

let dir: string;
let store: ProposalStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cephroom-proposals-"));
  store = new ProposalStore(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Each call makes a *different* proposal.
 *
 * The bodies used to be identical, which stopped being the same thing as
 * "two proposals" once ids became content-derived: the same edit submitted
 * twice is now one edit, deliberately, so that a retry after a dropped
 * connection does not leave a duplicate and so that resubmitting is not a way
 * around the limit this file exists to test. Distinct bodies are also what
 * real proposals have.
 */
let nth = 0;

function make(sub: string, columnId = "col") {
  nth += 1;
  return store.create({
    columnId,
    title: `t${nth}`,
    rationale: "",
    body: `b${nth}`,
    fromSub: sub,
  });
}

describe("openFromSubject", () => {
  it("counts only open proposals from that subject on that column", () => {
    make("s_a");
    make("s_a");
    make("s_b");
    make("s_a", "other-col");

    expect(store.openFromSubject("col", "s_a")).toBe(2);
    expect(store.openFromSubject("col", "s_b")).toBe(1);
    expect(store.openFromSubject("other-col", "s_a")).toBe(1);
    expect(store.openFromSubject("col", "s_nobody")).toBe(0);
  });

  it("stops counting a proposal once it is resolved", () => {
    const p = make("s_a");
    make("s_a");
    expect(store.openFromSubject("col", "s_a")).toBe(2);

    store.resolve(p.id, "closed");
    // A resolved proposal no longer counts against the flood limit — the
    // author working through their queue frees a subject's budget.
    expect(store.openFromSubject("col", "s_a")).toBe(1);
  });
});
