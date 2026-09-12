import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const ROOT = join(import.meta.dirname, "..", "..");


export interface Hit {
  file: string;
  line: number;
  text: string;
  rule: string;
}

/**
 * Directories skipped by every scan.
 *
 * Build output and dependencies are not this project's code, and scanning them
 * would make every rule fire on somebody else's. The risk is the opposite one:
 * a source directory added here would silently exempt itself from every
 * contract at once, with no allowlist entry and no diff anybody would read as a
 * contract change. Nothing but generated output belongs in this set.
 */
const IGNORED_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "coverage",
  "dist",
]);

export function walk(dir: string, extensions = [".ts", ".tsx"]): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) out.push(...walk(full, extensions));
    else if (extensions.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

/**
 * Two strippers, and choosing the wrong one is how a rule goes quietly inert.
 *
 * This one removes string CONTENTS as well as comments, which is right for
 * rules about identifiers: a banned function name inside a string is not a call
 * to it, and a rule that fired on prose would be silenced rather than heeded.
 *
 * It is wrong for rules about literals - a header name, a hostname, a
 * connection URL - because it erases exactly the thing being looked for. Those
 * rules set raw: true and get stripCommentsOnly instead. Four rules in this
 * repository were inert for a long time because of this distinction, and
 * scanner.test.ts exists to prove each one still bites.
 *
 * Both strippers preserve newlines so reported line numbers stay true.
 */
export function stripCommentsAndStrings(source: string): string {
  let out = "";
  let i = 0;
  let state:
    | "code"
    | "line-comment"
    | "block-comment"
    | "single"
    | "double"
    | "template" = "code";

  while (i < source.length) {
    const two = source.slice(i, i + 2);
    const char = source[i];

    if (state === "code") {
      if (two === "//") {
        state = "line-comment";
        i += 2;
        continue;
      }
      if (two === "/*") {
        state = "block-comment";
        i += 2;
        continue;
      }
      if (char === "'") {
        state = "single";
        out += " ";
        i++;
        continue;
      }
      if (char === '"') {
        state = "double";
        out += " ";
        i++;
        continue;
      }
      if (char === "`") {
        state = "template";
        out += " ";
        i++;
        continue;
      }
      out += char;
      i++;
      continue;
    }

    if (state === "line-comment") {
      if (char === "\n") {
        state = "code";
        out += "\n";
      }
      i++;
      continue;
    }

    if (state === "block-comment") {
      if (two === "*/") {
        state = "code";
        i += 2;
        continue;
      }
      if (char === "\n") out += "\n";
      i++;
      continue;
    }

    const closer = state === "single" ? "'" : state === "double" ? '"' : "`";
    if (char === "\\") {
      i += 2;
      continue;
    }
    if (char === closer) {
      state = "code";
      i++;
      continue;
    }
    if (char === "\n") out += "\n";
    i++;
  }

  return out;
}

export function stripCommentsOnly(source: string): string {
  let out = "";
  let i = 0;
  let state: "code" | "line-comment" | "block-comment" | "single" | "double" | "template" =
    "code";

  while (i < source.length) {
    const two = source.slice(i, i + 2);
    const char = source[i];

    if (state === "code") {
      if (two === "//") {
        state = "line-comment";
        i += 2;
        continue;
      }
      if (two === "/*") {
        state = "block-comment";
        i += 2;
        continue;
      }
      if (char === "'") state = "single";
      else if (char === '"') state = "double";
      else if (char === "`") state = "template";
      out += char;
      i++;
      continue;
    }

    if (state === "line-comment") {
      if (char === "\n") {
        state = "code";
        out += "\n";
      }
      i++;
      continue;
    }

    if (state === "block-comment") {
      if (two === "*/") {
        state = "code";
        i += 2;
        continue;
      }
      if (char === "\n") out += "\n";
      i++;
      continue;
    }

    const closer = state === "single" ? "'" : state === "double" ? '"' : "`";
    if (char === "\\") {
      out += source.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (char === closer) state = "code";
    out += char;
    i++;
  }

  return out;
}

export interface Rule {
  name: string;
  pattern: RegExp;
  allow?: string[];
  raw?: boolean;
}

export function scan(roots: string[], rules: Rule[]): Hit[] {
  const hits: Hit[] = [];

  for (const root of roots) {
    for (const file of walk(join(ROOT, root))) {
      const rel = relative(ROOT, file).split(sep).join("/");
      if (rel.includes(".test.")) continue;

      const source = readFileSync(file, "utf8");
      const strippedLines = stripCommentsAndStrings(source).split("\n");
      const rawLines = stripCommentsOnly(source).split("\n");

      for (const rule of rules) {
        if (rule.allow?.some((prefix) => rel.startsWith(prefix))) continue;
        const lines = rule.raw ? rawLines : strippedLines;

        lines.forEach((text, index) => {
          const pattern = new RegExp(rule.pattern.source, rule.pattern.flags.replace("g", ""));
          if (pattern.test(text)) {
            hits.push({
              file: rel,
              line: index + 1,
              text: text.trim().slice(0, 120),
              rule: rule.name,
            });
          }
        });
      }
    }
  }

  return hits;
}

export function describeHits(hits: Hit[]): string {
  return hits
    .map((hit) => `  ${hit.file}:${hit.line}  [${hit.rule}]  ${hit.text}`)
    .join("\n");
}

export function filesMatching(pattern: RegExp, extensions?: string[]): string[] {
  return walk(ROOT, extensions ?? [""])
    .map((file) => relative(ROOT, file).split(sep).join("/"))
    .filter((rel) => pattern.test(rel));
}
