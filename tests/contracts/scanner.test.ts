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


let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "cephroom-scanner-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function scanSource(source: string, rules: Rule[]): string[] {
  const dir = join(scratch, "src");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "suspect.ts"), source);
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
    expect(stripCommentsOnly(source)).toContain("const b = 2;");
    expect(stripCommentsAndStrings(source)).toContain("const b = 2;");
  });
});

describe("a literal rule catches every spelling of reading a client IP", () => {
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
    expect(scanSource(source, [rule])).toEqual([]);
  });

  it("spares a frozen lookup table", () => {
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
    const hits = scan([root], [{ ...rule, allow: [`${root}/exempt/`] }]);

    expect(hits.map((hit) => hit.file.split("/").pop())).toEqual(["b.ts"]);
  });
});
