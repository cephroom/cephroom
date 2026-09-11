import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const ROOT = join(import.meta.dirname, "..", "..");

/**
 * Source scanning for the contract tests.
 *
 * These tests exist because the contracts in docs/CONTRACTS.md have to be
 * enforced by something other than the memory of whoever wrote them. They are
 * deliberately crude: a regex over source text catches a reintroduced user
 * table or a stray writeFile, which is exactly the failure mode worth
 * catching. Anything subtler is a design review, not a test.
 */

export interface Hit {
  file: string;
  line: number;
  text: string;
  rule: string;
}

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
 * Removes comments and string literals before matching.
 *
 * Without this every rule fires on docs/CONTRACTS.md quotations, on the
 * explanatory comments that exist precisely to describe what is forbidden,
 * and on error messages that name the thing they are refusing to do.
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

    // Inside a string literal. Keep newlines so line numbers stay true.
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

export interface Rule {
  name: string;
  pattern: RegExp;
  /**
   * Paths (relative, forward-slashed, prefix match) exempt from this rule.
   * Every entry must be justified in docs/CONTRACTS.md under "Where the
   * contracts bend".
   */
  allow?: string[];
}

export function scan(roots: string[], rules: Rule[]): Hit[] {
  const hits: Hit[] = [];

  for (const root of roots) {
    for (const file of walk(join(ROOT, root))) {
      const rel = relative(ROOT, file).split(sep).join("/");
      if (rel.includes(".test.")) continue;

      const source = stripCommentsAndStrings(readFileSync(file, "utf8"));
      const lines = source.split("\n");

      for (const rule of rules) {
        if (rule.allow?.some((prefix) => rel.startsWith(prefix))) continue;

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

/** Files present anywhere under the repo, excluding build and vendor output. */
export function filesMatching(pattern: RegExp, extensions?: string[]): string[] {
  return walk(ROOT, extensions ?? [""])
    .map((file) => relative(ROOT, file).split(sep).join("/"))
    .filter((rel) => pattern.test(rel));
}
