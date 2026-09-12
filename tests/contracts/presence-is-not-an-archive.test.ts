import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly, walk } from "./scan";


interface AppFile {
  rel: string;
  code: string;
}

function appFiles(): AppFile[] {
  return walk(join(ROOT, "src", "app"))
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .filter((file) => !file.includes(".test."))
    .map((file) => ({
      rel: relative(ROOT, file).split(sep).join("/"),
      code: stripCommentsOnly(readFileSync(file, "utf8")),
    }));
}

const FORCE_DYNAMIC = /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/;

describe("nothing that reads presence can be prerendered", () => {
  it("marks every page and route that touches the registry force-dynamic", () => {
    const offenders = appFiles()
      .filter((file) => /\bregistry\s*\(/.test(file.code))
      .filter((file) => !FORCE_DYNAMIC.test(file.code))
      .map((file) => file.rel);

    expect(
      offenders,
      `These read the presence registry and may be prerendered.\nA prerendered listing is a build-time snapshot of who was online — an archive, produced by omitting one line.\n${offenders.join("\n")}\n`,
    ).toEqual([]);
  });

  it("marks every page that reads the viewer force-dynamic", () => {
    const offenders = appFiles()
      .filter((file) => /\bgetViewer\s*\(|\bcookies\s*\(/.test(file.code))
      .filter((file) => !FORCE_DYNAMIC.test(file.code))
      .map((file) => file.rel);

    expect(
      offenders,
      `These read the viewer and may be prerendered or shared between readers.\n${offenders.join("\n")}\n`,
    ).toEqual([]);
  });

  it("marks every API route force-dynamic", () => {
    const offenders = appFiles()
      .filter((file) => file.rel.startsWith("src/app/api/"))
      .filter((file) => file.rel.endsWith("/route.ts"))
      .filter((file) => !FORCE_DYNAMIC.test(file.code))
      .map((file) => file.rel);

    expect(offenders, `\n${offenders.join("\n")}\n`).toEqual([]);
  });
});

describe("nothing that reads presence can be cached downstream", () => {
  it("sends no-store from every endpoint that answers about now", () => {
    const offenders = appFiles()
      .filter((file) => file.rel.startsWith("src/app/api/"))
      .filter((file) => file.rel.endsWith("/route.ts"))
      .filter((file) => !file.rel.includes(".well-known"))
      .filter((file) => !/no-store|\bNO_STORE\b|\bnoStore\b|\bHEADERS\b/.test(file.code))
      .map((file) => file.rel);

    expect(
      offenders,
      `These endpoints permit a cache to hold their answer. A cached presence answer is an archive with a short lease.\n${offenders.join("\n")}\n`,
    ).toEqual([]);
  });

  it("wraps every redirect an API route issues", () => {
    const offenders: string[] = [];
    for (const file of appFiles()) {
      if (!file.rel.startsWith("src/app/api/")) continue;
      for (const match of file.code.matchAll(/NextResponse\.redirect\s*\(/g)) {
        const before = file.code.slice(Math.max(0, match.index - 20), match.index);
        if (!/noStore\s*\($/.test(before.trimEnd())) {
          const line = file.code.slice(0, match.index).split("\n").length;
          offenders.push(`${file.rel}:${line}`);
        }
      }
    }
    expect(
      offenders,
      `These redirects are cacheable. Every redirect here carries either a Set-Cookie or a credential in its location, and a shared cache replaying one hands it to the next person.\nWrap it: noStore(NextResponse.redirect(...)).\n${offenders.join("\n")}\n`,
    ).toEqual([]);
  });

  it("asks the framework to cache nothing on its own initiative", () => {
    const offenders: string[] = [];
    for (const file of appFiles()) {
      if (/export\s+const\s+revalidate\s*=|unstable_cache|["']force-cache["']/.test(file.code)) {
        offenders.push(file.rel);
      }
    }
    expect(offenders, `\n${offenders.join("\n")}\n`).toEqual([]);
  });

  it("keeps the offline page unable to say what used to be there", () => {
    const page = readFileSync(
      join(ROOT, "src", "app", "read", "[sub]", "[id]", "page.tsx"),
      "utf8",
    );
    const offline = page.slice(page.indexOf("function Offline"));
    expect(offline).toMatch(/Nobody is serving this right now/i);
    expect(offline).not.toMatch(/lastSeen|previously|was serving|title=|servedBy/);
  });
});
