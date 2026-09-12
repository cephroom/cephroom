import type { Conclusion } from "@/lib/claims/verdict";

/**
 * Everything a citation needs, and all of it is already on the page.
 *
 * A citation is built here, in the reader, from what was fetched and checked -
 * contract 2. Nothing is stored to produce one, because a "citations" table
 * would be a record of who read what. The platform never sees that a citation
 * was made.
 */
export interface Citation {
  title: string;
  author: string;
  address: string;
  readAt: Date;
  conclusion: Conclusion;
  counts: { verified: number; drifted: number; broken: number };
  datasets: { id: string; release: string }[];
  repo?: string | null;
  commit?: string | null;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The honesty of a Cephroom citation is that it dates the check, not the work.
 *
 * A citation to a frozen review says "as published". This says "as verified,
 * when I read it", because that is the only true thing to say about a claim
 * whose dataset keeps moving - the failure mode (content drift) that this whole
 * platform exists to surface. Overstating it as permanent would be the one
 * dishonesty the product cannot afford, so the wording is deliberately "read"
 * and "at the time of reading", never "archived" or "as of".
 */
function verificationClause(c: Citation): string {
  const total = c.counts.verified + c.counts.drifted + c.counts.broken;
  if (total === 0) return "no checkable claims";

  const against =
    c.datasets.length > 0
      ? ` against ${c.datasets.map((d) => `${d.id} @${d.release}`).join(", ")}`
      : "";

  if (c.conclusion === "passing") {
    return `all ${total} claim${total === 1 ? "" : "s"} verified${against} at the time of reading`;
  }
  const parts: string[] = [];
  if (c.counts.verified) parts.push(`${c.counts.verified} verified`);
  if (c.counts.drifted) parts.push(`${c.counts.drifted} drifted`);
  if (c.counts.broken) parts.push(`${c.counts.broken} unresolved`);
  return `${parts.join(", ")}${against} at the time of reading`;
}

export function plainCitation(c: Citation): string {
  const repo = c.repo
    ? ` Source: ${c.repo}${c.commit ? ` @${c.commit}` : ""}.`
    : "";
  return (
    `${c.author}. "${c.title}." Served via Cephroom from ${c.address}, ` +
    `read ${isoDay(c.readAt)} (${verificationClause(c)}).${repo} ` +
    `Not an archive: served only while its author was online.`
  );
}

function bibKey(c: Citation): string {
  const name = c.author.split(/\s+/).pop() ?? "author";
  const word = c.title.split(/\s+/)[0] ?? "untitled";
  const clean = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  return `${clean(name)}${isoDay(c.readAt).slice(0, 4)}${clean(word)}` || "cephroom";
}

/**
 * BibTeX escaping, because a title is a contributor's free text.
 *
 * The fields most likely to contain a brace or a backslash are title and note,
 * and an unescaped brace turns the rest of the entry into a group. This is
 * output, not storage, so it is only about producing a file the reader's own
 * tools will accept - not about trusting the node, which the reader already
 * checked before any of this rendered.
 */
function bibField(value: string): string {
  return value.replace(/[\\{}]/g, "\\$&");
}

export function bibtexCitation(c: Citation): string {
  const lines = [
    `@misc{${bibKey(c)},`,
    `  title = {${bibField(c.title)}},`,
    `  author = {${bibField(c.author)}},`,
    `  howpublished = {Served via Cephroom from ${bibField(c.address)}},`,
    `  note = {${bibField(verificationClause(c))}. Not an archive: served only while its author was online.},`,
    `  urldate = {${isoDay(c.readAt)}},`,
  ];
  if (c.repo) lines.push(`  url = {${bibField(c.repo)}},`);
  lines.push("}");
  return lines.join("\n");
}
