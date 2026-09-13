import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isNodeScoped,
  ProposalStore,
  REDACTED_SUB,
  SUBJECT_RETENTION_DAYS,
} from "../../node/proposals";

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "cephroom-subjects-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const base = {
  columnId: "d2-occupancy-window",
  title: "A proposal",
  rationale: "why",
  body: "a change",
};

function writeLegacy(root: string, id: string, proposal: Record<string, unknown>) {
  const dir = join(root, "proposals");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(proposal, null, 2));
}

function storedFiles(root: string): Record<string, unknown>[] {
  const dir = join(root, "proposals");
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(join(dir, file), "utf8")));
}

describe("a platform subject never reaches a contributor's disk", () => {
  it("refuses a proposal attributed to a platform-wide subject", () => {
    const store = new ProposalStore(scratch);
    expect(() =>
      store.create({ ...base, fromSub: "s_flY3fwsALmEokLR3qu3PqDxU8Iy" }),
    ).toThrow(/node-scoped/i);
    expect(store.list()).toHaveLength(0);
  });

  it("accepts a node-scoped pseudonym", () => {
    const store = new ProposalStore(scratch);
    const created = store.create({ ...base, fromSub: "n_TpyW52GXGUT3yY3mj" });
    expect(created.fromSub).toBe("n_TpyW52GXGUT3yY3mj");
  });

  it("knows the difference", () => {
    expect(isNodeScoped("n_abc")).toBe(true);
    expect(isNodeScoped("s_abc")).toBe(false);
    expect(isNodeScoped("z_abc")).toBe(false);
    expect(isNodeScoped("")).toBe(false);
    expect(isNodeScoped(REDACTED_SUB)).toBe(true);
  });
});

describe("a proposal written before node-scoping is migrated on open", () => {
  it("redacts a platform subject already on disk", () => {
    writeLegacy(scratch, "p_legacy", {
      id: "p_legacy",
      columnId: "d2-occupancy-window",
      title: "Flag the 65-80% window as class-specific",
      rationale: "reasoning",
      body: "an edit",
      fromSub: "s_flY3fwsALmEokLR3qu3PqDxU8Iy",
      status: "open",
      createdAt: "2026-09-12T09:15:00.000Z",
      resolvedAt: null,
    });

    const store = new ProposalStore(scratch);
    const [proposal] = store.list("d2-occupancy-window");

    expect(proposal.fromSub).toBe(REDACTED_SUB);
    expect(proposal.subjectRedacted).toBe(true);
  });

  it("keeps the proposal itself, which is the contributor's to read", () => {
    writeLegacy(scratch, "p_legacy", {
      id: "p_legacy",
      columnId: "d2-occupancy-window",
      title: "Flag the 65-80% window as class-specific",
      rationale: "reasoning worth keeping",
      body: "an edit worth keeping",
      fromSub: "s_flY3fwsALmEokLR3qu3PqDxU8Iy",
      status: "open",
      createdAt: "2026-09-12T09:15:00.000Z",
      resolvedAt: null,
    });

    const store = new ProposalStore(scratch);
    const [proposal] = store.list("d2-occupancy-window");

    expect(proposal.title).toBe("Flag the 65-80% window as class-specific");
    expect(proposal.body).toBe("an edit worth keeping");
    expect(proposal.rationale).toBe("reasoning worth keeping");
  });

  it("rewrites the file, so the identifier is gone from disk and not merely hidden", () => {
    writeLegacy(scratch, "p_legacy", {
      id: "p_legacy",
      columnId: "c",
      title: "t",
      rationale: "",
      body: "b",
      fromSub: "s_flY3fwsALmEokLR3qu3PqDxU8Iy",
      status: "open",
      createdAt: "2026-09-12T09:15:00.000Z",
      resolvedAt: null,
    });

    new ProposalStore(scratch);

    const raw = readFileSync(
      join(scratch, "proposals", "p_legacy.json"),
      "utf8",
    );
    expect(raw).not.toContain("s_flY3fwsALmEokLR3qu3PqDxU8Iy");
    expect(raw).toContain(REDACTED_SUB);
  });

  it("cannot be reversed to the subject it replaced", () => {
    for (const sub of ["s_one", "s_two", "s_three"]) {
      writeLegacy(scratch, `p_${sub}`, {
        id: `p_${sub}`,
        columnId: "c",
        title: "t",
        rationale: "",
        body: "b",
        fromSub: sub,
        status: "open",
        createdAt: "2026-09-12T09:15:00.000Z",
        resolvedAt: null,
      });
    }

    new ProposalStore(scratch);
    const subjects = storedFiles(scratch).map((p) => p.fromSub);
    expect(new Set(subjects)).toEqual(new Set([REDACTED_SUB]));
  });

  it("leaves a node-scoped pseudonym alone", () => {
    writeLegacy(scratch, "p_scoped", {
      id: "p_scoped",
      columnId: "c",
      title: "t",
      rationale: "",
      body: "b",
      fromSub: "n_TpyW52GXGUT3yY3mj",
      status: "open",
      createdAt: "2026-09-12T17:38:00.000Z",
      resolvedAt: null,
    });

    new ProposalStore(scratch);
    expect(storedFiles(scratch)[0].fromSub).toBe("n_TpyW52GXGUT3yY3mj");
  });
});

describe("a pseudonym does not outlive the exchange it was for", () => {
  it("redacts the subject of a proposal resolved longer ago than the window", () => {
    const longAgo = new Date(
      Date.now() - (SUBJECT_RETENTION_DAYS + 1) * 86_400_000,
    ).toISOString();

    writeLegacy(scratch, "p_old", {
      id: "p_old",
      columnId: "c",
      title: "t",
      rationale: "",
      body: "b",
      fromSub: "n_TpyW52GXGUT3yY3mj",
      status: "merged",
      createdAt: longAgo,
      resolvedAt: longAgo,
    });

    const store = new ProposalStore(scratch);
    expect(store.get("p_old")?.fromSub).toBe(REDACTED_SUB);
  });

  it("keeps the pseudonym on a proposal that is still open", () => {
    const longAgo = new Date(
      Date.now() - (SUBJECT_RETENTION_DAYS + 1) * 86_400_000,
    ).toISOString();

    writeLegacy(scratch, "p_open", {
      id: "p_open",
      columnId: "c",
      title: "t",
      rationale: "",
      body: "b",
      fromSub: "n_TpyW52GXGUT3yY3mj",
      status: "open",
      createdAt: longAgo,
      resolvedAt: null,
    });

    const store = new ProposalStore(scratch);
    expect(store.get("p_open")?.fromSub).toBe("n_TpyW52GXGUT3yY3mj");
  });

  it("keeps the pseudonym on a proposal resolved inside the window", () => {
    const recent = new Date(Date.now() - 86_400_000).toISOString();

    writeLegacy(scratch, "p_recent", {
      id: "p_recent",
      columnId: "c",
      title: "t",
      rationale: "",
      body: "b",
      fromSub: "n_TpyW52GXGUT3yY3mj",
      status: "closed",
      createdAt: recent,
      resolvedAt: recent,
    });

    const store = new ProposalStore(scratch);
    expect(store.get("p_recent")?.fromSub).toBe("n_TpyW52GXGUT3yY3mj");
  });

  it("states a window rather than keeping it forever", () => {
    expect(SUBJECT_RETENTION_DAYS).toBeGreaterThan(0);
    expect(SUBJECT_RETENTION_DAYS).toBeLessThanOrEqual(180);
  });
});

describe("nothing the node serves carries a platform subject", () => {
  it("never lists one, even if a file is edited in by hand afterwards", () => {
    const store = new ProposalStore(scratch);
    store.create({ ...base, fromSub: "n_TpyW52GXGUT3yY3mj" });

    const [file] = readdirSync(join(scratch, "proposals"));
    const path = join(scratch, "proposals", file);
    const smuggled = JSON.parse(readFileSync(path, "utf8"));
    smuggled.fromSub = "s_flY3fwsALmEokLR3qu3PqDxU8Iy";
    writeFileSync(path, JSON.stringify(smuggled));

    for (const proposal of store.list()) {
      expect(isNodeScoped(proposal.fromSub)).toBe(true);
    }
  });
});

describe("a long-running node expires a pseudonym without needing a restart", () => {
  // redactExpiredSubjects ran only in the constructor, so a node whose process
  // stays up for months never redacted a pseudonym that crossed the 90-day mark
  // mid-run: the store was built while the proposal was fresh, and nothing swept
  // it afterwards. The pseudonym sat on disk and was served on reads past its
  // stated expiry - person-linkable data at rest, contract 2.
  function backdateResolved(root: string, id: string, days: number): void {
    const path = join(root, "proposals", `${id}.json`);
    const proposal = JSON.parse(readFileSync(path, "utf8"));
    const when = new Date(Date.now() - days * 86_400_000).toISOString();
    proposal.status = "merged";
    proposal.createdAt = when;
    proposal.resolvedAt = when;
    writeFileSync(path, JSON.stringify(proposal, null, 2));
  }

  it("redacts on read a proposal that expired after the store was built", () => {
    // The store is built while the proposal is well inside the window.
    const store = new ProposalStore(scratch);
    const created = store.create({ ...base, fromSub: "n_TpyW52GXGUT3yY3mj" });
    store.resolve(created.id, "merged");

    // Time passes on a node that never restarts: the same store instance is
    // still live when the proposal crosses the 90-day line.
    backdateResolved(scratch, created.id, SUBJECT_RETENTION_DAYS + 1);

    expect(
      store.get(created.id)?.fromSub,
      "An expired pseudonym was still served by a store that had not been rebuilt.",
    ).toBe(REDACTED_SUB);
    expect(
      store.list().every((p) => p.fromSub !== "n_TpyW52GXGUT3yY3mj"),
    ).toBe(true);
  });

  it("rewrites the file, so the expired pseudonym is gone from disk not just hidden", () => {
    const store = new ProposalStore(scratch);
    const created = store.create({ ...base, fromSub: "n_TpyW52GXGUT3yY3mj" });
    store.resolve(created.id, "merged");
    backdateResolved(scratch, created.id, SUBJECT_RETENTION_DAYS + 1);

    store.get(created.id); // a read happens

    const onDisk = storedFiles(scratch).find(
      (p) => (p as { id: string }).id === created.id,
    ) as { fromSub: string } | undefined;
    expect(
      onDisk?.fromSub,
      "The pseudonym was filtered from the view but left on disk - the registry lesson: hiding is not reclaiming.",
    ).toBe(REDACTED_SUB);
  });
});
