import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, walk } from "./scan";

/**
 * The API, held to the contracts it is easiest to break from.
 *
 * A web page that violated Contract 2 would be noticed — somebody would see
 * the archive appear. An endpoint that does it is invisible: `?since=` looks
 * like a convenience, a proxy route looks like a performance win, and an
 * `X-Api-Key` header looks like what every other API does. Each is one commit
 * and none of them look like a contract violation while you are writing it.
 */

const API_ROOT = join(ROOT, "src", "app", "api");

function apiSources(): { rel: string; code: string }[] {
  return walk(API_ROOT)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => ({
      rel: relative(ROOT, file).split(sep).join("/"),
      code: readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, ""),
    }));
}

describe("no API keys, ever", () => {
  it("reads no API-key header anywhere", () => {
    // An API key is a stable identifier issued to a person and stored by the
    // issuer so it can be checked. The storing is what Contract 1 forbids, and
    // there is no version of an API key that avoids it.
    for (const { rel, code } of apiSources()) {
      for (const header of ["x-api-key", "api_key", "apiKey", "X-API-Key"]) {
        expect(code.toLowerCase(), `${rel} reads ${header}`).not.toContain(
          header.toLowerCase(),
        );
      }
    }
  });

  it("never persists a credential it issued", () => {
    for (const { rel, code } of apiSources()) {
      expect(code, `${rel} writes to disk`).not.toMatch(
        /\bwriteFileSync\b|\bappendFileSync\b|\bcreateWriteStream\b/,
      );
    }
  });
});

describe("the API never becomes a host", () => {
  it("has no endpoint that returns column or dataset bytes", () => {
    // Contract 2: bytes go from the contributor's machine to the reader's and
    // the platform is not in that request. A proxy route would be convenient
    // and would make the platform a host, which is the one thing it is not.
    for (const { rel, code } of apiSources()) {
      if (!rel.startsWith("src/app/api/v1/")) continue;
      expect(code, `${rel} fetches content server-side`).not.toMatch(
        /fetch\([^)]*\/(column|dataset)\//,
      );
    }
  });

  it("points at the node instead, and says so", () => {
    const locator = readFileSync(
      join(ROOT, "src", "app", "api", "v1", "read", "[sub]", "[id]", "route.ts"),
      "utf8",
    );
    // The rule is in the response, not only in a comment, because a client
    // author who does not know it will build the proxy themselves.
    expect(locator).toContain("contentComesFromTheNode");
    expect(locator).toContain("datasetsComeFromTheSameNode");
  });
});

describe("liveness answers about now, and nothing else", () => {
  it("offers no parameter that reaches into the past", () => {
    const live = readFileSync(
      join(ROOT, "src", "app", "api", "v1", "live", "route.ts"),
      "utf8",
    );
    const code = live
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    // There is no history to page into, so there is no cursor, no `since`, and
    // no `all`. Their absence is the feature.
    for (const parameter of ["since", "before", "after", "cursor", "all"]) {
      expect(
        code,
        `/api/v1/live must not accept "${parameter}"`,
      ).not.toContain(`searchParams.get("${parameter}")`);
    }
  });

  it("reads presence and never a store", () => {
    const live = readFileSync(
      join(ROOT, "src", "app", "api", "v1", "live", "route.ts"),
      "utf8",
    );
    expect(live).toContain("registry()");
    // The registry is a Map that dies with the process. If this endpoint ever
    // reads from anywhere else, that is the archive appearing.
    expect(live).not.toMatch(/readFile|database|\bdb\b|redis/i);
  });
});

describe("the API and the UI can do the same things", () => {
  it("checks claims with the shared module, not a second copy", () => {
    // Two implementations of a drift rule eventually disagree silently, which
    // is the exact failure this platform exists to prevent. The reader and the
    // CLI call the same pure function.
    const cli = readFileSync(join(ROOT, "scripts", "cephroom.ts"), "utf8");
    const reader = readFileSync(
      join(ROOT, "src", "components", "column-reader.tsx"),
      "utf8",
    );
    expect(cli).toContain('from "../src/lib/claims/resolve"');
    expect(reader).toContain('from "@/lib/claims/resolve"');
  });

  it("keeps the resolver free of React and Node built-ins", () => {
    // It runs in a browser, in a server route, and in a CLI. Any of the three
    // breaking is a silent divergence in what a claim means.
    const resolver = readFileSync(
      join(ROOT, "src", "lib", "claims", "resolve.ts"),
      "utf8",
    );
    expect(resolver).not.toMatch(/from "react"/);
    expect(resolver).not.toMatch(/from "node:/);
    expect(resolver).not.toContain("use client");
  });
});
