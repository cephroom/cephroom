import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProposalStore } from "../../node/proposals";


let dir: string;
let store: ProposalStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cephroom-proposals-"));
  store = new ProposalStore(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

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
    make("n_a");
    make("n_a");
    make("n_b");
    make("n_a", "other-col");

    expect(store.openFromSubject("col", "n_a")).toBe(2);
    expect(store.openFromSubject("col", "n_b")).toBe(1);
    expect(store.openFromSubject("other-col", "n_a")).toBe(1);
    expect(store.openFromSubject("col", "n_nobody")).toBe(0);
  });

  it("stops counting a proposal once it is resolved", () => {
    const p = make("n_a");
    make("n_a");
    expect(store.openFromSubject("col", "n_a")).toBe(2);

    store.resolve(p.id, "closed");
    expect(store.openFromSubject("col", "n_a")).toBe(1);
  });
});
