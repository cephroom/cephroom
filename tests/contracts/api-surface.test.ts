import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly as stripComments, walk } from "./scan";

const NEWLINE = String.fromCharCode(10);


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
    expect(live).not.toMatch(/readFile|database|\bdb\b|redis/i);
  });
});

describe("the API relays what the contributor announced", () => {
  it("carries payTo on the read locator", () => {
    const locator = readFileSync(
      join(ROOT, "src", "app", "api", "v1", "read", "[sub]", "[id]", "route.ts"),
      "utf8",
    );
    expect(locator).toContain("payTo");
  });

  it("carries payTo on the liveness listing", () => {
    const live = readFileSync(
      join(ROOT, "src", "app", "api", "v1", "live", "route.ts"),
      "utf8",
    );
    expect(live).toContain("payTo");
  });

  it("passes it through unexamined, exactly as the registry does", () => {
    for (const path of [
      ["src", "app", "api", "v1", "live", "route.ts"],
      ["src", "app", "api", "v1", "read", "[sub]", "[id]", "route.ts"],
    ]) {
      const code = stripComments(readFileSync(join(ROOT, ...path), "utf8"));
      expect(code).not.toMatch(/0x|ethereum|bitcoin|iban|isValidAddress/i);
      const line = code.split(NEWLINE).find((l) => l.includes("payTo"));
      expect(line).toBeDefined();
      expect(line).not.toMatch(/trim\(|toLowerCase\(|slice\(|replace\(/);
    }
  });

  it("omits it entirely when a contributor announced none", async () => {
    const { createRegistry } = await import("@/lib/signaling/registry");
    const registry = createRegistry();
    registry.announce({
      sub: "s_no_payto",
      displayName: "Ines",
      address: "http://127.0.0.1:4601",
      items: [{ id: "c", title: "C", kind: "column", tags: [] }],
    });
    expect(registry.find("s_no_payto", "c")?.presence.payTo).toBeUndefined();
  });
});

describe("the API and the UI can do the same things", () => {
  it("checks claims with the shared module, not a second copy", () => {
    const cli = readFileSync(join(ROOT, "scripts", "cephroom.ts"), "utf8");
    const reader = readFileSync(
      join(ROOT, "src", "components", "column-reader.tsx"),
      "utf8",
    );
    expect(cli).toContain('from "../src/lib/claims/resolve"');
    expect(reader).toContain('from "@/lib/claims/resolve"');
  });

  it("keeps the resolver free of React and Node built-ins", () => {
    const resolver = readFileSync(
      join(ROOT, "src", "lib", "claims", "resolve.ts"),
      "utf8",
    );
    expect(resolver).not.toMatch(/from "react"/);
    expect(resolver).not.toMatch(/from "node:/);
    expect(resolver).not.toContain("use client");
  });
});
