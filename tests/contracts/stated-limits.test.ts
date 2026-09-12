import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly, walk } from "./scan";


const privacy = readFileSync(
  join(ROOT, "src", "app", "privacy", "page.tsx"),
  "utf8",
).replace(/\s+/g, " ");

const providers = readFileSync(
  join(ROOT, "src", "lib", "auth", "providers.ts"),
  "utf8",
);

describe("the platform asks the identity provider for as little as it can", () => {
  it("requests no email scope from any provider", () => {
    const scopes = [...providers.matchAll(/scope:\s*"([^"]*)"/g)].map((m) => m[1]);
    expect(scopes.length).toBeGreaterThan(0);
    for (const scope of scopes) {
      expect(scope, `a provider requests "${scope}"`).not.toMatch(/\bemail\b/);
    }
  });

  it("has no branch that would use an email if one arrived", () => {
    const code = stripCommentsOnly(providers);
    expect(code).not.toMatch(/raw\.email|\.email\b/);
  });

  it("says so on the privacy page, where the claim can be checked", () => {
    expect(privacy).toMatch(/no longer ask Google for your email/i);
  });
});

describe("what sign-in still reveals is stated rather than implied", () => {
  it("says the account id is seen, and for how long", () => {
    expect(privacy).toMatch(/we still see your Google account id at sign-in/i);
    expect(privacy).toMatch(/as long as one request takes/i);
    expect(privacy).toMatch(/a promise is what stops us/i);
  });

  it("states the revocation weakness without dressing it up", () => {
    expect(privacy).toMatch(/cannot revoke/i);
    expect(privacy).toMatch(/blocklist is state/i);
  });

  it("counts the spent-marker set among the places the contracts bend", () => {
    const howItWorks = readFileSync(
      join(ROOT, "src", "app", "how-it-works", "page.tsx"),
      "utf8",
    ).replace(/\s+/g, " ");

    const bends = howItWorks.slice(howItWorks.indexOf("Where they bend"));
    expect(bends).toMatch(/spent-token markers|spent-marker|spent tokens/i);
    expect(bends).toMatch(/Five places/i);
  });

  it("admits that page requests still carry the session", () => {
    expect(privacy).toMatch(/page requests still carry your session/i);
  });
});

describe("the product does not point readers at things that are not there", () => {
  const REPO_LINK = /github\.com\/cephroom\/cephroom\/blob\/main\/([^\s"'`)]+)/g;

  it("links to no repository path that does not exist", () => {
    const dangling: string[] = [];

    for (const file of walk(join(ROOT, "src"))) {
      if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
      if (file.includes(".test.")) continue;
      const source = readFileSync(file, "utf8");
      const rel = relative(ROOT, file).split(sep).join("/");

      for (const match of source.matchAll(REPO_LINK)) {
        const target = match[1];
        if (!existsSync(join(ROOT, ...target.split("/")))) {
          dangling.push(`${rel} → ${target}`);
        }
      }
    }

    expect(
      dangling,
      `These link to repository paths that do not exist.\nA reader following one to check a claim finds a 404, which is worse than not having offered the link.\n\n${dangling.join("\n")}\n`,
    ).toEqual([]);
  });

  it("names no document that does not exist, in code or in configuration", () => {
    const DOC_REFERENCE = /\bdocs\/[A-Za-z0-9_-]+\.md\b/g;

    const scanned: { rel: string; text: string }[] = [];

    for (const file of walk(join(ROOT, "src"))) {
      if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
      if (file.includes(".test.")) continue;
      scanned.push({
        rel: relative(ROOT, file).split(sep).join("/"),
        text: readFileSync(file, "utf8"),
      });
    }

      // Configuration is scanned as well as source. The rule existed and
      // looked only at src/app/, which is exactly why it missed a pointer to a
      // document that had never existed sitting in .env.example - the first
      // file a deployment owner opens. A dangling reference in configuration
      // costs more than one in code, because the person following it has no
      // way to tell it was stale.
    for (const rel of [".env.example", "package.json", "README.md"]) {
      const path = join(ROOT, rel);
      if (!existsSync(path)) continue;
      scanned.push({ rel, text: readFileSync(path, "utf8") });
    }

    const dangling: string[] = [];
    for (const { rel, text } of scanned) {
      for (const match of text.matchAll(DOC_REFERENCE)) {
        if (!existsSync(join(ROOT, ...match[0].split("/")))) {
          dangling.push(`${rel} → ${match[0]}`);
        }
      }
    }

    expect(
      dangling,
      [
        "These point at a document that does not exist.",
        "A reader who follows one to check a claim finds nothing, which is worse",
        "than not having offered the pointer. Configuration counts: .env.example",
        "is the first file a deployment owner opens.",
        "",
        ...dangling,
      ].join("\n"),
    ).toEqual([]);
  });

  it("documents only environment variables the code actually reads", () => {
    const example = readFileSync(join(ROOT, ".env.example"), "utf8");
    const documented = [
      ...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]{3,})=/gm),
    ].map((match) => match[1]);

    expect(documented.length).toBeGreaterThan(0);

    const sources = [
      ...walk(join(ROOT, "src")),
      ...walk(join(ROOT, "node")),
      ...walk(join(ROOT, "scripts")),
      ...walk(join(ROOT, "simulated-counterparties")),
    ]
      .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    const unread = documented.filter(
      (name) => !new RegExp(`\\b${name}\\b`).test(sources),
    );

    expect(
      unread,
      [
        "These are documented in .env.example but no code reads them.",
        "A deployment owner who sets one gets silence, and the variable the code",
        "does read stays unset. This is how a rename half-lands.",
        "",
        ...unread,
      ].join("\n"),
    ).toEqual([]);
  });

  it("names no deleted document in anything it serves to a client", () => {
    const served: string[] = [];
    for (const file of walk(join(ROOT, "src", "app"))) {
      if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
      const source = stripCommentsOnly(readFileSync(file, "utf8"));
      const rel = relative(ROOT, file).split(sep).join("/");
      for (const match of source.matchAll(/\bdocs\/[A-Z-]+\.md\b/g)) {
        if (!existsSync(join(ROOT, "docs", match[0].slice(5)))) {
          served.push(`${rel} → ${match[0]}`);
        }
      }
    }
    expect(served, `\n${served.join("\n")}\n`).toEqual([]);
  });
});

describe("the zero-knowledge path is described as what it actually is", () => {
  const proofRoutes = walk(join(ROOT, "src", "app", "api"))
    .filter((file) => file.endsWith("route.ts"))
    .map((file) => ({
      rel: relative(ROOT, file).split(sep).join("/"),
      code: stripCommentsOnly(readFileSync(file, "utf8")),
    }))
    .filter((route) => /verifySubmission|publicSignals/.test(route.code));

  it("gives the structural reason, not only the cost", () => {
    expect(privacy).toMatch(/we are the verifier|the verifier is us|any prover we ran would be us/i);
    expect(privacy).toMatch(/run no prover|never operate a prover|we do not run a prover/i);
  });

  it("still gives the measurement, so the cost claim is checkable", () => {
    expect(privacy).toMatch(/1\.1 million constraints/i);
    expect(privacy).toMatch(/550 megabytes/i);
  });

  it("does not offer a sign-in the code cannot perform", () => {
    if (proofRoutes.length === 0) {
      expect(
        privacy,
        "No route accepts a proof, so the privacy page has to say the ZK path is published rather than available.",
      ).toMatch(/not something you can use yet|is not wired|no sign-in flow uses/i);
    }
  });

  it("keeps the claim and the code in step in the other direction too", () => {
    if (proofRoutes.length > 0) {
      expect(
        privacy,
        `${proofRoutes.map((r) => r.rel).join(", ")} accepts a proof, so the privacy page should no longer say the path is unavailable.`,
      ).not.toMatch(/not something you can use yet|is not wired/i);
    }
  });
});

describe("the plan catalogue and the records that reference it agree", () => {
  it("resolves every price id the simulated counterparty has on file", async () => {
    const store = join(ROOT, ".stripe-simulated.json");
    if (!existsSync(store)) return;

    const { planForPrice } = await import("@/lib/stripe/plans");
    const records = JSON.parse(readFileSync(store, "utf8")) as {
      subscriptions?: Record<string, { priceId?: string }>;
    };

    const unresolvable = [
      ...new Set(
        Object.values(records.subscriptions ?? {})
          .map((subscription) => subscription.priceId ?? "")
          .filter((priceId) => priceId.length > 0)
          .filter((priceId) => planForPrice(priceId) === null),
      ),
    ];

    expect(
      unresolvable,
      [
        "These price ids are on file but the plan catalogue no longer knows them.",
        "A subscription carrying one resolves to null and is silently dropped, so",
        "the subscriber appears to have no plan and nothing says why. This is what",
        "a half-finished rename looks like from the outside.",
        "",
        ...unresolvable,
      ].join("\n"),
    ).toEqual([]);
  });
});
