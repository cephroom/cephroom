import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ROOT, scan, stripCommentsAndStrings, stripCommentsOnly, type Rule } from "./scan";
import {
  CLIENT_IP_RULE,
  FS_WRITE_RULE,
  MUTABLE_GLOBAL_RULE,
  NO_LOGGING_RULES,
  REMOTE_STORE_RULE,
} from "./rules";

/**
 * The contract tests are only as good as the scanner underneath them, and for
 * a long time they were not good at all.
 *
 * `scan()` strips string literals before matching so that a rule naming a
 * forbidden thing does not fire on the comment explaining why it is
 * forbidden. The cost, unnoticed until it was measured, is that any rule
 * whose target is spelled as a *literal* matched nothing, ever:
 *
 *     request.headers.get("x-forwarded-for")   ->   request.headers.get( )
 *
 * The rule against reading a client IP is the most confident assertion in the
 * suite and it could not see the one line it exists to catch. Three other
 * rules had the same shape.
 *
 * So this file tests the scanner rather than the platform: it feeds the
 * scanner source that violates a rule, in the spellings somebody would
 * actually write, and asserts a hit. A rule that cannot fail these cannot
 * enforce anything, and the failure is silent — which is why it needs a test
 * of its own rather than trust.
 */

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "cephroom-scanner-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Writes a source file into the scratch root and scans it. */
function scanSource(source: string, rules: Rule[]): string[] {
  const dir = join(scratch, "src");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "suspect.ts"), source);
  // `scan` resolves roots against ROOT, so hand it a path back to scratch.
  const root = relative(ROOT, join(scratch, "src")).split(sep).join("/");
  return scan([root], rules).map((hit) => hit.rule);
}

describe("the two strippers differ in exactly the way the rules depend on", () => {
  const line = `const ip = request.headers.get("x-forwarded-for");`;

  it("stripCommentsAndStrings removes literal contents", () => {
    expect(stripCommentsAndStrings(line)).not.toContain("x-forwarded-for");
  });

  it("stripCommentsOnly keeps them", () => {
    expect(stripCommentsOnly(line)).toContain("x-forwarded-for");
  });

  it("both still drop comments, which is why stripping exists at all", () => {
    const commented = `// never read x-forwarded-for here\nconst a = 1;`;
    expect(stripCommentsAndStrings(commented)).not.toContain("x-forwarded-for");
    expect(stripCommentsOnly(commented)).not.toContain("x-forwarded-for");
  });

  it("keeps line numbers true through a multi-line comment", () => {
    const source = `const a = 1;\n/* two\n   lines */\nconst b = 2;`;
    expect(stripCommentsOnly(source).split("\n")).toHaveLength(4);
    expect(stripCommentsAndStrings(source).split("\n")).toHaveLength(4);
  });

  it("does not end a string on an escaped quote", () => {
    const source = `const a = "he said \\"no\\" loudly"; const b = 2;`;
    // If the escape were mishandled the tail would be read as a string and
    // `const b` would vanish, which would silently blind every rule after it.
    expect(stripCommentsOnly(source)).toContain("const b = 2;");
    expect(stripCommentsAndStrings(source)).toContain("const b = 2;");
  });
});

describe("a literal rule catches every spelling of reading a client IP", () => {
  // The rule under test is the one that does the work — imported, never
  // re-declared. A copy lets the two drift, and a rule that has silently
  // stopped matching looks from the outside exactly like one that is passing.
  const rule = CLIENT_IP_RULE;

  it.each([
    ['a double-quoted header', `const ip = request.headers.get("x-forwarded-for");`],
    ['a single-quoted header', `const ip = request.headers.get('x-real-ip');`],
    ['a template-literal header', 'const ip = request.headers.get(`cf-connecting-ip`);'],
    ['the header name bound to a variable', `const h = "x-forwarded-for";`],
    ['a bare property read', `const ip = req.ip;`],
    ['a socket read', `const ip = socket.remoteAddress;`],
  ])("catches %s", (_label, source) => {
    expect(scanSource(source, [rule])).toContain("client-ip");
  });

  it("does not fire on a comment saying the platform must not do it", () => {
    expect(
      scanSource(`// The platform never reads x-forwarded-for.\nconst a = 1;`, [rule]),
    ).toEqual([]);
  });
});

describe("a store rule catches the idiom this codebase actually writes", () => {
  // The previous rule keyed on identifiers containing "store", "sessions",
  // "users" or "cache". It missed `const userTable = new Map()` (because
  // "userTable" does not contain "users") and it missed every global in this
  // repository, all of which are declared as `globalForX.__y ??= new Map()`.
  const rule = MUTABLE_GLOBAL_RULE;

  it.each([
    ["a plainly named map", `const userTable = new Map();`],
    ["an annotated map", `export const accounts: Map<string, User> = new Map();`],
    ["this repository's global idiom", `globalForX.__sessions ??= new Map();`],
    ["a globalThis cast", `const g = globalThis as unknown as { x?: Map<string, U> };`],
    ["an innocuously named map", `const live = new Map<string, Presence>();`],
  ])("catches %s", (_label, source) => {
    expect(scanSource(source, [rule])).toContain("mutable-global");
  });

  it.each([
    ["a scratch map inside a function", `  const datasets = new Map<string, Dataset>();`],
    ["a scratch set inside a parser", `    const seen = new Set<string>();`],
  ])("spares %s", (_label, source) => {
    // Indentation is the signal. A collection built and dropped inside a call
    // never outlives the request; one at module scope outlives every request
    // the process serves. Only the second is state.
    expect(scanSource(source, [rule])).toEqual([]);
  });

  it("spares a frozen lookup table", () => {
    // `ReadonlySet` is a constant, not state. This case is here because the
    // exclusion was written as `:\s*(?!Readonly...)` and the optional
    // whitespace backtracked to zero width, so the lookahead tested the space
    // rather than the type and the exclusion spared nothing.
    expect(
      scanSource(
        `export const ENTITLING_STATUSES: ReadonlySet<string> = new Set(["active"]);`,
        [rule],
      ),
    ).toEqual([]);
  });
});

describe("a remote store is caught even though it touches no filesystem", () => {
  it.each([
    ["an Upstash REST call", `await fetch("https://x.upstash.io/set/key", { method: "POST" });`],
    ["a Supabase endpoint", `const url = "https://proj.supabase.co/rest/v1/readers";`],
    ["a bare Postgres URL", `const dsn = "postgresql://user:pw@host/db";`],
    ["a Redis URL", `const dsn = "rediss://cache:6379";`],
  ])("catches %s", (_label, source) => {
    // Every other storage rule looks for a filesystem call, an import, or a
    // package name. A hosted key-value store needs none of the three.
    expect(scanSource(source, [REMOTE_STORE_RULE])).toContain("remote-store");
  });
});

describe("an identity-logging rule catches the natural spellings", () => {
  const rule = NO_LOGGING_RULES[0];

  it.each([
    ["a template literal", "console.log(`signed in ${sub}`);"],
    ["a bare object", `console.log(viewer);`],
    ["a destructured shorthand", `console.info({ sub });`],
    ["an error path", `console.error(err, key);`],
  ])("catches %s", (_label, source) => {
    expect(scanSource(source, [rule])).toContain("console-call");
  });
});

describe("allowlists are load-bearing, not decorative", () => {
  const rule: Rule = { ...FS_WRITE_RULE, allow: ["exempt/"] };

  it("exempts a path under the allowed prefix and catches one outside it", () => {
    mkdirSync(join(scratch, "roots", "exempt"), { recursive: true });
    mkdirSync(join(scratch, "roots", "guarded"), { recursive: true });
    writeFileSync(join(scratch, "roots", "exempt", "a.ts"), `writeFileSync(p, v);`);
    writeFileSync(join(scratch, "roots", "guarded", "b.ts"), `writeFileSync(p, v);`);

    const root = relative(ROOT, join(scratch, "roots")).split(sep).join("/");
    // The allow prefix is relative to the repo root, so build it the same way
    // the real rules do — this is the bug that made the one real allowlist in
    // the suite unreachable: it named a directory the scan never visited.
    const hits = scan([root], [{ ...rule, allow: [`${root}/exempt/`] }]);

    expect(hits.map((hit) => hit.file.split("/").pop())).toEqual(["b.ts"]);
  });
});
