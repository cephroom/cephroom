import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly, walk } from "./scan";

/**
 * Layer 2 was rejected, and the rejection is only honest if it is published.
 *
 * The decision has two halves and the page had one of them. The measurable
 * half — 1.1 million constraints, a ~550MB proving key, half a minute of
 * proving — is a cost that could fall, and a reader could reasonably expect
 * it to. The structural half does not fall: **the platform is the verifier,
 * so any prover the platform runs is the platform.** A zero-knowledge proof
 * that the verifier computed on your behalf, from your token, has no
 * zero-knowledge property left. That is why there is no "we'll do the proving
 * for you" option and never can be, and it is the sentence a reader needs.
 *
 * These assertions also guard the direction nobody checks: that the product
 * does not claim a capability the code lacks. A verifier, a circuit pin and a
 * challenge endpoint shipped after this page was written, and no route ever
 * accepted a proof — so for a while the page said "it is not built" about
 * something partly built, while the thing a reader would actually want was
 * genuinely absent. Both halves of that are worth failing a test over.
 */

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
    // A fallback is an invitation to put the scope back. The address is not
    // something the platform forgets; it is something it never receives.
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
    // And that a promise is what stops it, rather than architecture. This is
    // the one place in the design where that is true, and softening it is how
    // the page would start to overstate the guarantee.
    expect(privacy).toMatch(/a promise is what stops us/i);
  });

  it("states the revocation weakness without dressing it up", () => {
    expect(privacy).toMatch(/cannot revoke/i);
    expect(privacy).toMatch(/blocklist is state/i);
  });

  it("counts the spent-marker set among the places the contracts bend", () => {
    // /how-it-works enumerates the exceptions and said "four places", listing
    // the registry, Stripe, the simulated Stripe file and the node's disk —
    // and omitted the one durable-ish thing the platform itself keeps. The
    // privacy page has always described it at length, so the omission read as
    // an oversight rather than a position, which is the worst of both.
    const howItWorks = readFileSync(
      join(ROOT, "src", "app", "how-it-works", "page.tsx"),
      "utf8",
    ).replace(/\s+/g, " ");

    const bends = howItWorks.slice(howItWorks.indexOf("Where they bend"));
    expect(bends).toMatch(/spent-token markers|spent-marker|spent tokens/i);
    // A reader who counts the list should get the number the page claims.
    expect(bends).toMatch(/Five places/i);
  });

  it("admits that page requests still carry the session", () => {
    // The limit of Layer 1. Tokens cover what a reader fetches from a node;
    // the page around it is still requested with a cookie attached.
    expect(privacy).toMatch(/page requests still carry your session/i);
  });
});

describe("the product does not point readers at things that are not there", () => {
  /**
   * Every in-repository link the site offers, checked against the repository.
   *
   * Deleting the documentation left four live links to files that no longer
   * exist — on /privacy, /how-it-works, /account, and inside the JSON that
   * `/api/zk/params` serves to client authors. Each was correct when written.
   * None of them failed anything, because a dead link is invisible to a test
   * suite that only reads code.
   *
   * It matters more here than on most sites: three of the four were pointing
   * at the place a reader was told to go to verify a privacy claim, which
   * makes a broken link an unverifiable claim.
   */
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

  it("names no deleted document in anything it serves to a client", () => {
    // The same failure in machine-readable form: `/api/zk/params` told client
    // authors to read a protocol document, which is exactly the audience that
    // cannot shrug off a dead reference.
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
  /** Does any route accept a proof? */
  const proofRoutes = walk(join(ROOT, "src", "app", "api"))
    .filter((file) => file.endsWith("route.ts"))
    .map((file) => ({
      rel: relative(ROOT, file).split(sep).join("/"),
      code: stripCommentsOnly(readFileSync(file, "utf8")),
    }))
    .filter((route) => /verifySubmission|publicSignals/.test(route.code));

  it("gives the structural reason, not only the cost", () => {
    // The cost could fall. This cannot.
    expect(privacy).toMatch(/we are the verifier|the verifier is us|any prover we ran would be us/i);
    expect(privacy).toMatch(/run no prover|never operate a prover|we do not run a prover/i);
  });

  it("still gives the measurement, so the cost claim is checkable", () => {
    expect(privacy).toMatch(/1\.1 million constraints/i);
    expect(privacy).toMatch(/550 megabytes/i);
  });

  it("does not offer a sign-in the code cannot perform", () => {
    // If nothing accepts a proof, the page must not suggest a reader can use
    // one today. The published protocol is a real thing to describe; a button
    // that does not exist is not.
    if (proofRoutes.length === 0) {
      expect(
        privacy,
        "No route accepts a proof, so the privacy page has to say the ZK path is published rather than available.",
      ).toMatch(/not something you can use yet|is not wired|no sign-in flow uses/i);
    }
  });

  it("keeps the claim and the code in step in the other direction too", () => {
    // The mirror of the above: once a route does accept a proof, the caveat
    // has to go, or the page understates what the platform offers.
    if (proofRoutes.length > 0) {
      expect(
        privacy,
        `${proofRoutes.map((r) => r.rel).join(", ")} accepts a proof, so the privacy page should no longer say the path is unavailable.`,
      ).not.toMatch(/not something you can use yet|is not wired/i);
    }
  });
});
