import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProposalStore } from "../../node/proposals";

/**
 * Regression tests for the proposal-flood limiter (see docs/CONTRACTS.md,
 * Contract 3 / node hardening).
 *
 * A proposal is written to the contributor's own disk. Attacking the local
 * node showed a member could POST unbounded bytes and unbounded proposals to
 * fill it. The node now caps body size and field lengths at the door and
 * gates on openFromSubject; this covers the count gate the node consults.
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

function make(sub: string, columnId = "col") {
  return store.create({
    columnId,
    title: "t",
    rationale: "",
    body: "b",
    fromSub: sub,
    fromName: "n",
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
