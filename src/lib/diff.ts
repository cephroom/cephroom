
export type DiffKind = "context" | "added" | "removed";

export interface DiffLine {
  kind: DiffKind;
  text: string;
  before: number | null;
  after: number | null;
}

export interface DiffHunk {
  beforeStart: number;
  afterStart: number;
  lines: DiffLine[];
}

export interface DiffStats {
  added: number;
  removed: number;
  unchanged: number;
}

export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);

  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "context", text: a[i], before: i + 1, after: j + 1 });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: "removed", text: a[i], before: i + 1, after: null });
      i++;
    } else {
      out.push({ kind: "added", text: b[j], before: null, after: j + 1 });
      j++;
    }
  }
  while (i < a.length) {
    out.push({ kind: "removed", text: a[i], before: i + 1, after: null });
    i++;
  }
  while (j < b.length) {
    out.push({ kind: "added", text: b[j], before: null, after: j + 1 });
    j++;
  }

  return out;
}

export function diffStats(lines: DiffLine[]): DiffStats {
  return lines.reduce<DiffStats>(
    (stats, line) => {
      if (line.kind === "added") stats.added++;
      else if (line.kind === "removed") stats.removed++;
      else stats.unchanged++;
      return stats;
    },
    { added: 0, removed: 0, unchanged: 0 },
  );
}

export function toHunks(lines: DiffLine[], context = 3): DiffHunk[] {
  const changed = lines
    .map((line, index) => (line.kind === "context" ? -1 : index))
    .filter((index) => index >= 0);
  if (changed.length === 0) return [];

  const ranges: [number, number][] = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(lines.length - 1, index + context);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }

  return ranges.map(([start, end]) => {
    const slice = lines.slice(start, end + 1);
    return {
      beforeStart: slice.find((line) => line.before !== null)?.before ?? 0,
      afterStart: slice.find((line) => line.after !== null)?.after ?? 0,
      lines: slice,
    };
  });
}

function splitLines(text: string): string[] {
  return text.split(/\r\n?|\n/);
}
