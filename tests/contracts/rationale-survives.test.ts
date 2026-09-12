import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, scan, stripCommentsAndStrings, walk } from "./scan";
import { MUTABLE_GLOBAL_RULE } from "./rules";

/**
 * Modules that must carry a rationale, beyond the ones derived below.
 *
 * The derived half covers anything holding process state or hashing, because
 * those are the places a reader would most want to know why. This list is the
 * rest: modules where removing or "simplifying" the code would break a contract
 * and nothing in the immediate vicinity would say so.
 *
 * The reason this test exists at all: about 2,400 lines of rationale were
 * stripped from this codebase in a single pass, and the suite stayed green.
 * Every rule was still enforced and not one of them was still explained, which
 * is the state in which somebody argues a contract away because the argument
 * for it is no longer anywhere they will look.
 */
const ALSO_REQUIRED = [
  "src/lib/signaling/fair-share.ts",
  "src/lib/signaling/serving.ts",
  "src/lib/signaling/announcement.ts",
  "src/lib/claims/resolve.ts",
  "src/lib/stripe/plans.ts",
  "src/lib/tokens/wallet.ts",
  "src/lib/api/shape.ts",
  "src/lib/zk/params.ts",
  "node/proposals.ts",
  "node/verify.ts",
  "node/presence.ts",
];

const HASHES = /\bcreateHmac\b|\bcreateHash\b|crypto\.subtle\.digest/;

const CONTRACT_CITATION = /contract\s+\d+/i;

const MIN_LINES = 3;

interface Block {
  lines: number;
  text: string;
}

function docBlocks(source: string): Block[] {
  const out: Block[] = [];
  for (const match of source.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
    out.push({ lines: match[0].split("\n").length, text: match[0] });
  }
  return out;
}

function rel(file: string): string {
  return relative(ROOT, file).split(sep).join("/");
}

/**
 * Derived rather than listed, so the requirement cannot be dodged by adding a
 * module and forgetting to add it here.
 *
 * Anything caught by the mutable-global scan holds process state, which under
 * contract 2 needs a written reason whether or not anybody remembers to ask for
 * one. Anything that hashes is minting a new name for something, which under
 * the same contract needs saying out loud.
 */
function derivedModules(): string[] {
  const stateful = [
    ...new Set(scan(["src"], [MUTABLE_GLOBAL_RULE]).map((hit) => hit.file)),
  ];

  const hashing = walk(join(ROOT, "src"))
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .filter((file) => !file.includes(".test."))
    .filter((file) => HASHES.test(stripCommentsAndStrings(readFileSync(file, "utf8"))))
    .map(rel);

  return [...new Set([...stateful, ...hashing])].sort();
}

function required(): string[] {
  return [...new Set([...derivedModules(), ...ALSO_REQUIRED])].sort();
}

describe("the reasoning survives a refactor", () => {
  it("requires a rationale from every module that holds state or hashes", () => {
    const missing: string[] = [];

    for (const path of required()) {
      const full = join(ROOT, ...path.split("/"));
      if (!existsSync(full)) continue;

      const blocks = docBlocks(readFileSync(full, "utf8"));
      if (!blocks.some((block) => block.lines >= MIN_LINES)) {
        missing.push(`${path} — no rationale block`);
      }
    }

    expect(
      missing,
      [
        "These modules hold process state, mint a name, or sit where a change",
        "would break a contract silently — and carry no rationale.",
        "",
        "Write why the code is the way it is, not what it does. The audience is",
        "whoever is about to make a change that looks harmless.",
        "",
        ...missing,
      ].join("\n"),
    ).toEqual([]);
  });

  it("requires that rationale to cite the contract it serves", () => {
    const uncited: string[] = [];

    for (const path of required()) {
      const full = join(ROOT, ...path.split("/"));
      if (!existsSync(full)) continue;

      const blocks = docBlocks(readFileSync(full, "utf8"));
      const substantive = blocks.filter((block) => block.lines >= MIN_LINES);
      if (substantive.length === 0) continue;

      if (!substantive.some((block) => CONTRACT_CITATION.test(block.text))) {
        uncited.push(path);
      }
    }

    expect(
      uncited,
      [
        "These carry a rationale that names no contract.",
        "",
        "A citation is asserted rather than a length because length is trivially",
        "satisfied by prose written to satisfy a test. A contract number is",
        "falsifiable: it either matches something in docs/CONTRACTS.md or it does",
        "not, and it tells a reader where the full statement lives.",
        "",
        ...uncited,
      ].join("\n"),
    ).toEqual([]);
  });

  it("cites only contracts that exist", () => {
    const contracts = readFileSync(join(ROOT, "docs", "CONTRACTS.md"), "utf8");
    const numbered = new Set(
      [...contracts.matchAll(/^\*\*(\d+)\.\*\*/gm)].map((m) => Number(m[1])),
    );

    expect(
      numbered.size,
      "docs/CONTRACTS.md no longer lists numbered contracts in the form this test reads.",
    ).toBeGreaterThanOrEqual(11);

    const bogus: string[] = [];
    for (const path of required()) {
      const full = join(ROOT, ...path.split("/"));
      if (!existsSync(full)) continue;

      for (const block of docBlocks(readFileSync(full, "utf8"))) {
        for (const cite of block.text.matchAll(/contract\s+(\d+)/gi)) {
          if (!numbered.has(Number(cite[1]))) {
            bogus.push(`${path} → contract ${cite[1]}`);
          }
        }
      }
    }

    expect(
      bogus,
      `These cite a contract number that docs/CONTRACTS.md does not define.\n${bogus.join("\n")}\n`,
    ).toEqual([]);
  });

  it("names no module in the extra list that has gone", () => {
    const gone = ALSO_REQUIRED.filter(
      (path) => !existsSync(join(ROOT, ...path.split("/"))),
    );

    expect(
      gone,
      [
        "These are required to carry a rationale but no longer exist.",
        "",
        "Checked in the same both-directions way as every other list here: a",
        "stale entry makes the requirement look broader than it is, and the next",
        "person reads a list of files that are not there and stops trusting it.",
        "",
        ...gone,
      ].join("\n"),
    ).toEqual([]);
  });

  it("keeps the extra list free of anything the derived half already covers", () => {
    const derived = new Set(derivedModules());
    const redundant = ALSO_REQUIRED.filter((path) => derived.has(path));

    expect(
      redundant,
      [
        "These are listed explicitly but are already derived from holding state",
        "or hashing. Listing them twice means a future change that stops them",
        "being derived leaves them silently covered by the manual list, which",
        "hides the change.",
        "",
        ...redundant,
      ].join("\n"),
    ).toEqual([]);
  });
});

describe("the guard is checking something", () => {
  it("is scanning a set worth scanning", () => {
    expect(required().length).toBeGreaterThanOrEqual(15);
    expect(derivedModules().length).toBeGreaterThanOrEqual(6);
  });

  it("does not accept a one-line restatement of the signature", () => {
    const thin = docBlocks("/** Returns the registry. */\nexport function x() {}");
    expect(thin).toHaveLength(1);
    expect(thin[0].lines >= MIN_LINES).toBe(false);
  });

  it("does not accept prose that names no contract", () => {
    const vague = [
      "/**",
      " * This module is important and should not be changed lightly.",
      " * It has been carefully designed.",
      " */",
    ].join("\n");
    const blocks = docBlocks(vague);
    expect(blocks[0].lines >= MIN_LINES).toBe(true);
    expect(CONTRACT_CITATION.test(blocks[0].text)).toBe(false);
  });

  it("accepts a rationale that cites one", () => {
    const good = [
      "/**",
      " * Holds presence for fifteen seconds and then forgets it, because",
      " * contract 4 means a listing must not outlive the machine serving it.",
      " */",
    ].join("\n");
    const blocks = docBlocks(good);
    expect(blocks[0].lines >= MIN_LINES).toBe(true);
    expect(CONTRACT_CITATION.test(blocks[0].text)).toBe(true);
  });
});
