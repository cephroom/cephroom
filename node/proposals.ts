import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";


export interface Proposal {
  id: string;
  columnId: string;
  title: string;
  rationale: string;
  body: string;
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

  openFromSubject(columnId: string, sub: string): number {
    return this.list(columnId).filter(
      (p) => p.status === "open" && p.fromSub === sub,
    ).length;
  }
}
