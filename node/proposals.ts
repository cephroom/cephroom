import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";


export function proposalRootFor(contentDir: string): string {
  return dirname(resolve(contentDir));
}

export const REDACTED_SUB = "n_withdrawn";

export const SUBJECT_RETENTION_DAYS = 90;

export function isNodeScoped(sub: string): boolean {
  return /^n_/.test(sub);
}

export interface ProposalContent {
  columnId: string;
  title: string;
  rationale: string;
  body: string;
  fromSub: string;
}

export function proposalId(content: ProposalContent): string {
  const digest = createHash("sha256")
    .update(
      [
        content.columnId,
        content.title,
        content.rationale,
        content.body,
        content.fromSub,
      ].join("\0"),
      "utf8",
    )
    .digest("hex");
  return `p_${digest.slice(0, 32)}`;
}

export interface Proposal {
  id: string;
  columnId: string;
  title: string;
  rationale: string;
  body: string;
  fromSub: string;
  status: "open" | "merged" | "closed";
  createdAt: string;
  resolvedAt: string | null;
  subjectRedacted?: boolean;
}

export class ProposalStore {
  private readonly dir: string;

  constructor(root: string) {
    this.dir = join(root, "proposals");
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    this.redactExpiredSubjects();
  }

  private files(): string[] {
    return readdirSync(this.dir).filter((file) => file.endsWith(".json"));
  }

  private path(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private readFile(file: string): Proposal | null {
    try {
      return JSON.parse(readFileSync(join(this.dir, file), "utf8")) as Proposal;
    } catch {
      return null;
    }
  }

  private redactExpiredSubjects(now: number = Date.now()): void {
    const cutoff = now - SUBJECT_RETENTION_DAYS * 86_400_000;

    for (const file of this.files()) {
      const proposal = this.readFile(file);
      if (!proposal) continue;
      if (proposal.fromSub === REDACTED_SUB) continue;

      const foreign = !isNodeScoped(proposal.fromSub);
      const settled =
        proposal.status !== "open" &&
        proposal.resolvedAt !== null &&
        Date.parse(proposal.resolvedAt) < cutoff;

      if (!foreign && !settled) continue;

      writeFileSync(
        join(this.dir, file),
        JSON.stringify(
          { ...proposal, fromSub: REDACTED_SUB, subjectRedacted: true },
          null,
          2,
        ),
      );
    }
  }

  private withoutForeignSubject(proposal: Proposal): Proposal {
    return isNodeScoped(proposal.fromSub)
      ? proposal
      : { ...proposal, fromSub: REDACTED_SUB, subjectRedacted: true };
  }

  list(columnId?: string): Proposal[] {
    return this.files()
      .map((file) => this.readFile(file))
      .filter((proposal): proposal is Proposal => proposal !== null)
      .map((proposal) => this.withoutForeignSubject(proposal))
      .filter((proposal) => !columnId || proposal.columnId === columnId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): Proposal | null {
    if (!existsSync(this.path(id))) return null;
    const proposal = JSON.parse(readFileSync(this.path(id), "utf8")) as Proposal;
    return this.withoutForeignSubject(proposal);
  }

  create(input: Omit<Proposal, "id" | "status" | "createdAt" | "resolvedAt">) {
    if (!isNodeScoped(input.fromSub)) {
      throw new Error(
        `A proposal must be attributed to a node-scoped pseudonym (n_…), not to ${input.fromSub.slice(0, 2)}… — a platform-wide subject is the same identifier at every contributor, which is the thing node-scoping exists to prevent.`,
      );
    }

    const id = proposalId(input);

    const existing = this.get(id);
    if (existing) return existing;

    const proposal: Proposal = {
      ...input,
      id,
      status: "open",
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };
    writeFileSync(this.path(proposal.id), JSON.stringify(proposal, null, 2));
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
    writeFileSync(this.path(id), JSON.stringify(updated, null, 2));
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
