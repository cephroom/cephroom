
export interface Column {
  id: string;
  title: string;
  subtitle: string;
  tags: string[];
  repo?: string;
  commit?: string;
  body: string;
}

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
