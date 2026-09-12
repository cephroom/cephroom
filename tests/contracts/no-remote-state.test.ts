import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, describeHits, scan, stripCommentsOnly, walk } from "./scan";
import { REMOTE_STORE_RULE } from "./rules";


function isClientModule(source: string): boolean {
  return /^\s*["']use client["']/m.test(source);
}

interface Module {
  rel: string;
  code: string;
  client: boolean;
}

function platformModules(): Module[] {
  return walk(join(ROOT, "src"))
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .filter((file) => !file.includes(".test."))
    .map((file) => {
      const source = readFileSync(file, "utf8");
      return {
        rel: relative(ROOT, file).split(sep).join("/"),
        code: stripCommentsOnly(source),
        client: isClientModule(source),
      };
    });
}

const NETWORK_CALL =
  /\bfetch\s*\(|\bfetchImpl\s*\(|\bXMLHttpRequest\b|\baxios\b|\bgot\s*\(|\bundici\b|\b(https?)\.request\s*\(|\bnavigator\.sendBeacon\b|\bnew\s+Stripe\s*\(/;

/**
 * The three server modules permitted to reach the network, and the party each
 * talks to.
 *
 * A server-side request is how both a hosted store and a content proxy get in,
 * and neither looks like a contract violation while you are writing it - one is
 * "just caching", the other is "just fixing CORS". Naming the counterparty in
 * the entry forces the question the diff would otherwise skip: who is at the
 * other end, and why may they be stateful?
 *
 * Stripe is here because contract 3 makes it the one party permitted to
 * remember a person. The other two fetch public material on fixed URLs about
 * nobody.
 *
 * Like PERMITTED_GLOBAL_STATE, this is checked in both directions: a module
 * that stops reaching the network has to leave the list, so a standing
 * permission cannot outlive its use.
 */
const SERVER_NETWORK_ALLOWED: Record<string, string> = {
  "src/app/api/auth/callback/[provider]/route.ts":
    "Exchanges an OAuth code and reads the profile, both at the provider's own published endpoints. The profile is turned into a subject and dropped.",
  "src/lib/zk/jwks.ts":
    "Fetches the identity provider's published signing keys. Public material, on a fixed URL, about nobody.",
  "src/lib/stripe/live.ts":
    "Talks to Stripe, the one party permitted to remember a person.",
};

describe("Contract 1 and 2: durable state cannot arrive over HTTP either", () => {
  it("names no hosted database or key-value store anywhere in the platform", () => {
    const hits = scan(["src"], [REMOTE_STORE_RULE]);
    expect(
      hits.length,
      `A hosted store is a database that happens to be reached by fetch. It is still the thing both contracts forbid.\n${describeHits(hits)}\n`,
    ).toBe(0);
  });

  it("reaches the network from the server only in the named modules", () => {
    const offenders = platformModules()
      .filter((module) => !module.client)
      .filter((module) => NETWORK_CALL.test(module.code))
      .map((module) => module.rel)
      .filter((rel) => !(rel in SERVER_NETWORK_ALLOWED));

    expect(
      offenders,
      `These server modules reach the network and are not named in SERVER_NETWORK_ALLOWED.\nA server-side request is how both a hosted store and a content proxy get in, and neither looks like a contract violation while you are writing it.\nIf this is deliberate, add the module with the party it talks to and why that party may be stateful.\n\n${offenders.join("\n")}\n`,
    ).toEqual([]);
  });

  it("keeps the allowlist honest about what is still there", () => {
    const reaching = new Set(
      platformModules()
        .filter((module) => !module.client)
        .filter((module) => NETWORK_CALL.test(module.code))
        .map((module) => module.rel),
    );
    const stale = Object.keys(SERVER_NETWORK_ALLOWED).filter(
      (rel) => !reaching.has(rel),
    );
    expect(
      stale,
      `These modules are permitted to reach the network but no longer do. Remove them rather than leaving a standing permission nobody is using.\n${stale.join("\n")}\n`,
    ).toEqual([]);
  });
});

describe("Contract 2: the platform is never in the request for content", () => {
  it("never makes a network call from a module that knows a node's address", () => {
    const offenders = platformModules()
      .filter((module) => !module.client)
      .filter((module) => /\bregistry\s*\(|presence\.address|\.address\b/.test(module.code))
      .filter((module) => NETWORK_CALL.test(module.code))
      .map((module) => module.rel);

    expect(
      offenders,
      `These modules both resolve a node address and make requests. Readers fetch nodes from the browser; the platform hands out an address and stays out of it.\n${offenders.join("\n")}\n`,
    ).toEqual([]);
  });

  it("fetches nodes only from the browser, and only through the timeout wrapper", () => {
    const offenders = platformModules()
      .filter((module) => /\/(column|dataset|manifest|proposals)\//.test(module.code))
      .filter((module) => /\bfetch\s*\(/.test(module.code))
      .map((module) => module.rel);

    expect(
      offenders,
      `These reach a node with a bare fetch. Use fetchWithTimeout — a node that hangs is the common case, not the edge one.\n${offenders.join("\n")}\n`,
    ).toEqual([]);
  });

  it("serves no route that returns column or dataset bytes", () => {
    const routes = walk(join(ROOT, "src", "app", "api"))
      .filter((file) => file.endsWith(".ts"))
      .map((file) => ({
        rel: relative(ROOT, file).split(sep).join("/"),
        code: stripCommentsOnly(readFileSync(file, "utf8")),
      }));

    for (const route of routes) {
      expect(
        /new Response\s*\(\s*(response|upstream|body)\b|\.body\s*\)/.test(route.code),
        `${route.rel} looks like it relays a body it fetched.`,
      ).toBe(false);
    }
  });
});
