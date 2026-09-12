import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly, walk } from "./scan";

/**
 * Contract 2, against the framework rather than against the code.
 *
 * Every route and page that touches the registry carries
 * `export const dynamic = "force-dynamic"`, and nothing asserted it. That is
 * the whole of what stands between this platform and an archive: without it
 * Next is free to prerender `/read` at build time and serve a snapshot of
 * whoever happened to be online when the bundle was built — a cached copy of
 * exactly what the contract says is never kept, produced by deleting one line
 * that looks like boilerplate.
 *
 * The same applies to a response without `no-store`. A CDN holding
 * `/api/v1/live` for sixty seconds is a sixty-second archive, and it is the
 * kind of thing added for a good reason by somebody who has not read this
 * file.
 *
 * Prose pages are deliberately not covered. `/privacy` and `/how-it-works`
 * read nothing and may be prerendered; requiring the annotation everywhere
 * would make it noise, and a rule that is mostly noise stops being read.
 */

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
    // A page rendered once and reused would show one reader's tier — and
    // possibly their name — to the next.
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
      // The public key is the one thing here that is genuinely static and
      // genuinely public; it is cacheable and says so.
      .filter((file) => !file.rel.includes(".well-known"))
      // `NO_STORE` and `HEADERS` from @/lib/api/shape both carry the header,
      // and `noStore()` sets it on a response that cannot take a header bag
      // (a redirect). A route spelling it any of those ways is complying.
      .filter((file) => !/no-store|\bNO_STORE\b|\bnoStore\b|\bHEADERS\b/.test(file.code))
      .map((file) => file.rel);

    expect(
      offenders,
      `These endpoints permit a cache to hold their answer. A cached presence answer is an archive with a short lease.\n${offenders.join("\n")}\n`,
    ).toEqual([]);
  });

  it("wraps every redirect an API route issues", () => {
    // The check above is per *file*, which is too coarse: a route with three
    // responses and `noStore` on two of them passes it. This was not
    // hypothetical — `/api/dev-oauth/authorize` sets the header on the HTML
    // consent screen and not on the branch that redirects with an
    // authorization code in the query string, and the file-level assertion
    // saw the header and was satisfied.
    //
    // Every redirect in this codebase either carries a Set-Cookie or a
    // credential in its location, so the rule is simply: all of them.
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
      // `revalidate` turns a page into a periodically-refreshed copy, which
      // is a cache with a nicer name. `unstable_cache` and `force-cache` are
      // explicit about it.
      if (/export\s+const\s+revalidate\s*=|unstable_cache|["']force-cache["']/.test(file.code)) {
        offenders.push(file.rel);
      }
    }
    expect(offenders, `\n${offenders.join("\n")}\n`).toEqual([]);
  });

  it("keeps the offline page unable to say what used to be there", () => {
    // The tombstone test. A helpful "this column was called X, last seen
    // Tuesday" requires the platform to have kept X and Tuesday, so the page
    // that renders when nobody is serving must have nothing but the ids from
    // the URL.
    const page = readFileSync(
      join(ROOT, "src", "app", "read", "[sub]", "[id]", "page.tsx"),
      "utf8",
    );
    const offline = page.slice(page.indexOf("function Offline"));
    expect(offline).toMatch(/Nobody is serving this right now/i);
    // It may render the identifiers it was asked for, and nothing else.
    expect(offline).not.toMatch(/lastSeen|previously|was serving|title=|servedBy/);
  });
});
