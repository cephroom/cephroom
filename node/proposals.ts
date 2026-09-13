import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";


export function proposalRootFor(contentDir: string): string {
  return dirname(resolve(contentDir));
}

/**
 * What a subject becomes when it should no longer be held.
 *
 * Redaction rather than deletion, because the proposal's title, body and
 * rationale are the contributor's to read and destroying them would be a worse
 * answer than dropping the identifier. It is a constant rather than a
 * per-record value so that two redacted proposals cannot be told apart, which
 * is the point: a unique placeholder would still be a pseudonym.
 */
export const REDACTED_SUB = "n_withdrawn";

/**
 * A pseudonym does not need to outlive the exchange it was for.
 *
 * A node-scoped pseudonym is legitimate while a proposal is open: the
 * contributor needs to reply, and to stop one reader filing twenty without
 * knowing who they are. Once the proposal is merged or closed there is no
 * further exchange to support, and what is left is a durable identifier on
 * somebody's disk with no job.
 *
 * Ninety days is a judgement, not a derivation. Open proposals keep theirs,
 * because the exchange is still live.
 */
export const SUBJECT_RETENTION_DAYS = 90;

/**
 * Why a platform subject must never reach a contributor's disk - contract 2.
 *
 * An s_ subject is the same identifier at every contributor, so two of them
 * comparing proposal files could reconstruct one reader across the network -
 * exactly what node-scoping exists to prevent. An n_ pseudonym is derived per
 * contributor and cannot be joined to anything next door.
 *
 * This shipped the wrong way round: proposals written before node-scoping
 * carried raw platform subjects and the node served them on a public page.
 * Person-linkable data at rest, with no expiry and no deletion path. The store
 * now refuses one on write, redacts one it finds on disk, and redacts again on
 * read so a hand-edited file cannot smuggle one back out.
 *
 * If you write a fixture, write n_. The suite used to use s_ in its own
 * fixtures, which is part of why the leak went unnoticed for so long.
 */
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

/**
 * Rewrites the file rather than filtering on read.
 *
 * Hiding a subject at read time leaves it on disk, where the next tool to open
 * the directory finds it. The migration has to be destructive to be a
 * migration, and it runs on open so a node picks it up by starting rather than
 * by anyone remembering to run something.
 */
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
    // Sweep on read, not only in the constructor: a node process can stay up for
    // months, and a pseudonym that crosses the 90-day line mid-run must be
    // redacted then rather than at the next restart, or it is data at rest past
    // its stated expiry (contract 2). Same lesson as the presence registry:
    // filtering a subject out of the view is not reclaiming it from disk.
    this.redactExpiredSubjects();
    return this.files()
      .map((file) => this.readFile(file))
      .filter((proposal): proposal is Proposal => proposal !== null)
      .map((proposal) => this.withoutForeignSubject(proposal))
      .filter((proposal) => !columnId || proposal.columnId === columnId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): Proposal | null {
    // See list(): the expiry sweep must run on read so a long-uptime node does
    // not serve a pseudonym past its 90-day window.
    this.redactExpiredSubjects();
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
