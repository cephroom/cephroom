import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly, walk } from "./scan";

const COLUMN_FETCH = /\$\{([A-Za-z_$][\w$.]*)\}\/column\//g;
const DATASET_FETCH = /\$\{([A-Za-z_$][\w$.]*)\}\/dataset\//g;

interface Reader {
  rel: string;
  code: string;
}

function readers(): Reader[] {
  return [...walk(join(ROOT, "src")), ...walk(join(ROOT, "scripts"))]
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .filter((file) => !file.includes(".test."))
    .map((file) => ({
      rel: relative(ROOT, file).split(sep).join("/"),
      code: stripCommentsOnly(readFileSync(file, "utf8")),
    }))
    .filter((file) => DATASET_FETCH.test(file.code) || COLUMN_FETCH.test(file.code));
}

function bases(code: string, pattern: RegExp): string[] {
  return [...code.matchAll(new RegExp(pattern.source, "g"))].map((m) => m[1]);
}

const WHY = [
  "A claim is checked against a dataset. If the dataset can come from a node",
  "other than the one that served the claim, anyone serving that slug can",
  "substitute the numbers the claim is judged against — and a green badge then",
  "means nothing, which is the entire mechanism this platform exists to",
  "provide.",
  "",
  "An author vouches for the data they serve. Resolve it from them.",
  "",
  "/api/v1/read states this rule in its response body. Until this test existed",
  "nothing held it.",
].join("\n");

describe("a claim's dataset is resolved from the node that served the claim", () => {
  it("finds the readers, so this guard is not scanning an empty set", () => {
    const found = readers().map((reader) => reader.rel);
    expect(found).toContain("src/components/column-reader.tsx");
    expect(found).toContain("scripts/cephroom.ts");
    expect(found.length).toBeGreaterThanOrEqual(2);
  });

  it("fetches a dataset from the same binding it fetched the column from", () => {
    const offenders: string[] = [];

    for (const { rel, code } of readers()) {
      const columnBases = new Set(bases(code, COLUMN_FETCH));
      const datasetBases = new Set(bases(code, DATASET_FETCH));
      if (columnBases.size === 0 || datasetBases.size === 0) continue;

      for (const base of datasetBases) {
        if (!columnBases.has(base)) {
          offenders.push(
            `${rel}: column from \${${[...columnBases].join("|")}}, dataset from \${${base}}`,
          );
        }
      }
    }

    expect(offenders, `${WHY}\n\n${offenders.join("\n")}\n`).toEqual([]);
  });

  it("resolves a dataset from exactly one base per reader, never a choice of node", () => {
    const offenders: string[] = [];

    for (const { rel, code } of readers()) {
      const datasetBases = new Set(bases(code, DATASET_FETCH));
      if (datasetBases.size > 1) {
        offenders.push(`${rel}: ${[...datasetBases].join(", ")}`);
      }
    }

    expect(
      offenders,
      `A reader that can pick between bases can pick the wrong one.\n${offenders.join("\n")}\n`,
    ).toEqual([]);
  });

  // A fourth assertion was tried here and removed: "no /api/v1/{live,read}
  // call near a dataset fetch". It flagged scripts/cephroom.ts, and it was
  // wrong to. Using the locator to find THE node serving a column is discovery
  // working — the CLI then fetches both the column and its datasets from that
  // one address, which is the property wanted. Proximity in the source is not
  // evidence of a second lookup, and a guard that fires on correct code gets
  // silenced rather than heeded. The binding test above is the precise form of
  // the same question and it holds.

  it("says so in the response the API hands a client", () => {
    const locator = stripCommentsOnly(
      readFileSync(
        join(ROOT, "src", "app", "api", "v1", "read", "[sub]", "[id]", "route.ts"),
        "utf8",
      ),
    );
    expect(locator).toContain("datasetsComeFromTheSameNode");
    expect(locator).toMatch(/substitute the numbers/i);
  });
});

describe("the guard notices a reader that goes elsewhere for a dataset", () => {
  it("flags a mismatched base", () => {
    const smuggled = [
      "const column = await fetch(`${address}/column/${id}`);",
      "const data = await fetch(`${otherNode}/dataset/${slug}`);",
    ].join("\n");

    const columnBases = new Set(bases(smuggled, COLUMN_FETCH));
    const datasetBases = new Set(bases(smuggled, DATASET_FETCH));

    expect(columnBases.has("address")).toBe(true);
    expect(datasetBases.has("otherNode")).toBe(true);
    expect([...datasetBases].every((base) => columnBases.has(base))).toBe(false);
  });

  it("does not flag the readers this platform actually ships", () => {
    for (const { rel, code } of readers()) {
      const columnBases = new Set(bases(code, COLUMN_FETCH));
      const datasetBases = new Set(bases(code, DATASET_FETCH));
      if (columnBases.size === 0 || datasetBases.size === 0) continue;
      expect(
        [...datasetBases].every((base) => columnBases.has(base)),
        rel,
      ).toBe(true);
    }
  });
});
