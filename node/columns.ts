/**
 * Reading a column off a contributor's disk.
 *
 * Extracted from the server so it can be tested without binding a port, and
 * so that the shape of a column is stated in one place now that it has lost a
 * field.
 *
 * The field it lost is `access`. A column used to declare itself public,
 * member or lab, and the node withheld most of it from readers whose key did
 * not measure up. That sold a consumer "contributors will treat you better"
 * while the contributor received nothing for it — a promise somebody else had
 * to honour, which a contributor noticing it would rationally ignore or
 * invert. A column now has one form: the whole thing, to whoever asks.
 *
 * What a contributor charges for is theirs to arrange, directly, through the
 * `--pay-to` string the platform relays and knows nothing about.
 */

export interface Column {
  id: string;
  title: string;
  subtitle: string;
  tags: string[];
  repo?: string;
  commit?: string;
  body: string;
}

/** Parses one Markdown file with front matter into a column. */
export function readColumnFile(raw: string, filename: string): Column {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`${filename} has no front matter.`);

  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    meta[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }

  return {
    id: meta.slug,
    title: meta.title,
    subtitle: meta.subtitle ?? "",
    tags: (meta.tags ?? "")
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean),
    repo: meta.repo,
    commit: meta.commit,
    body: match[2].trim(),
  };
}
