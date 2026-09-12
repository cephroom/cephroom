import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";


/**
 * Where a node keeps the proposals it has been sent.
 *
 * Beside the content, not inside it — inside would make a reader's unmerged
 * edit look like publishable source to anything that walks the content
 * directory, including the node's own column reader.
 *
 * The node used to root this at its *source* directory, so every node started
 * from the same checkout shared one inbox however its `--content` was set.
 * Running two contributors at once showed what that costs: with a column slug
 * in common — and slugs are author-chosen and collide, which is the same fact
 * behind the discovery hijack in tests/contracts/signal-auth.test.ts — one
 * contributor could read, count and close proposals addressed to the other.
 *
 * Deriving it from the content directory means isolation follows from the
 * flag a contributor already sets, and the default layout
 * (`node/content` -> `node/proposals`) is exactly where it has always been.
 */
export function proposalRootFor(contentDir: string): string {
  return dirname(resolve(contentDir));
}

/** The fields that decide what a proposal *is*. */
export interface ProposalContent {
  columnId: string;
  title: string;
  rationale: string;
  body: string;
  fromSub: string;
}

/**
 * A proposal's identifier, derived from the proposal.
 *
 * These were random UUIDs, which named a piece of writing after the moment it
 * was written. In a system that keeps no index anywhere, an accidental name
 * is particularly poor: there is nothing to look it up in afterwards, so the
 * only way to check that an id names what you think it does is to be told.
 * A content address can be recomputed by anyone holding the proposal.
 *
 * `createdAt` and `status` are excluded deliberately — they are what the
 * author *did* about the proposal, not what it says. Including either would
 * make the name change when the author closed it.
 *
 * The separator is a NUL byte, which none of these fields can contain
 * (`parseBody` and the node's own limits reject control characters, and JSON
 * transport would not survive one). Joining with an ordinary character means
 * a title ending in it and a rationale beginning with it produce the same
 * digest as the reverse, which is a real, if unlikely, collision.
 */
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
  /**
   * Who to answer, and nothing more.
   *
   * This sat next to a `fromName` carrying the proposer's Google display
   * name, written here permanently with no expiry and no way to withdraw it.
   * A proposal has to be attributable — an anonymous one lands on somebody's
   * disk with nobody to answer for it — but it has to be attributable to a
   * subject, which is stable and unforgeable and says nothing about a person.
   * Two proposals from the same subject are visibly the same person; who that
   * is stays with them.
   */
  fromSub: string;
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
    const id = proposalId(input);

    // The same edit, proposed twice, is one edit. A retry after a dropped
    // connection used to leave a duplicate behind, and pressing the button
    // again was a way around the per-subject flood limit.
    //
    // Returning the existing record rather than overwriting it matters more
    // than it looks: overwriting would let anyone reopen a proposal the
    // author had already closed, simply by submitting it again.
    const existing = this.get(id);
    if (existing) return existing;

    const proposal: Proposal = {
      ...input,
      id,
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
