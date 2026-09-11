import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Proposals, stored on the contributor's own disk.
 *
 * The review half of the thesis, rebuilt to fit Contract 2. A reader's
 * browser posts a proposed edit straight to the author's node; the platform
 * is not involved and holds nothing. If the author is offline, the proposal
 * cannot be delivered — which is the same constraint that applies to reading
 * their work, and for the same reason.
 *
 * This writes files. That is allowed: it is the contributor's machine, which
 * is the entire point of the contract rather than an exception to it.
 */

export interface Proposal {
  id: string;
  columnId: string;
  title: string;
  rationale: string;
  body: string;
  /** The proposer's pseudonymous subject. Never an email. */
  fromSub: string;
  fromName: string;
  status: "open" | "merged" | "closed";
  createdAt: string;
  resolvedAt: string | null;
}

export class ProposalStore {
  private readonly dir: string;

  constructor(root: string) {
    this.dir = join(root, "proposals");
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  list(columnId?: string): Proposal[] {
    return readdirSync(this.dir)
      .filter((file) => file.endsWith(".json"))
      .map(
        (file) =>
          JSON.parse(readFileSync(join(this.dir, file), "utf8")) as Proposal,
      )
      .filter((proposal) => !columnId || proposal.columnId === columnId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): Proposal | null {
    const path = join(this.dir, `${id}.json`);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as Proposal;
  }

  create(input: Omit<Proposal, "id" | "status" | "createdAt" | "resolvedAt">) {
    const proposal: Proposal = {
      ...input,
      id: `p_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
      status: "open",
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };
    writeFileSync(
      join(this.dir, `${proposal.id}.json`),
      JSON.stringify(proposal, null, 2),
    );
    return proposal;
  }

  resolve(id: string, status: "merged" | "closed"): Proposal | null {
    const proposal = this.get(id);
    if (!proposal) return null;
    const updated: Proposal = {
      ...proposal,
      status,
      resolvedAt: new Date().toISOString(),
    };
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(updated, null, 2));
    return updated;
  }

  countOpen(columnId: string): number {
    return this.list(columnId).filter((p) => p.status === "open").length;
  }
}
