import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, describeHits, scan, stripCommentsOnly, walk } from "./scan";
import { REMOTE_STORE_RULE } from "./rules";

/**
 * The storage contracts, closed on the side they were open.
 *
 * Every other rule in this suite looks for a filesystem call, an import, or a
 * package name. A hosted key-value store needs none of them — it is a `fetch`
 * to a URL and a bearer token, and it would have satisfied the entire
 * contract suite while being, in every way that matters, the user table.
 * There is no "the platform makes no network calls" baseline to fall back on
 * either: it already talks to an identity provider and to Stripe.
 *
 * The same hole swallows Contract 2 from the other direction. A server-side
 * `fetch(presence.address + "/column/" + id)` makes the platform a host — the
 * bytes pass through its memory, it can cache them, and a reader's request is
 * no longer to the contributor's machine. The existing guard against this
 * bans three *names* (`fetchNodeContent`, `proxyNode`, `pipeThrough`), so it
 * catches a proxy somebody labelled as one.
 *
 * So the rule here is not about names. It is: the platform's server code may
 * reach the network only from modules named below, and the module that knows
 * where nodes live is not one of them.
 */

/** A module is client-side if it says so. Everything else runs on the server. */
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

/**
 * What counts as reaching the network.
 *
 * An SDK is included deliberately. `new Stripe(...)` makes requests without
 * the word `fetch` appearing anywhere, so a rule that only knew about `fetch`
 * would report that the platform's one genuinely stateful counterparty is
 * never contacted — and would miss a second module quietly acquiring a client
 * of its own.
 */
const NETWORK_CALL =
  /\bfetch\s*\(|\bfetchImpl\s*\(|\bXMLHttpRequest\b|\baxios\b|\bgot\s*\(|\bundici\b|\b(https?)\.request\s*\(|\bnavigator\.sendBeacon\b|\bnew\s+Stripe\s*\(/;

/**
 * Server modules permitted to reach the network, each for a stated reason.
 *
 * Short on purpose. Every entry is a place the platform talks to a party that
 * is allowed to be stateful — and each is a fixed, compile-time URL, never an
 * address that arrived from a request.
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
    // The structural version of "do not proxy". The registry is the only
    // thing that knows where a contributor's machine is; if the module
    // holding that knowledge could also make requests, the proxy is one line
    // away and it would be named something reasonable.
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
    // Every node fetch is to a stranger's machine over an unknown network. A
    // bare fetch to one that hangs rather than closes never settles, and the
    // reader spins forever.
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
      // A route that both knows an address and streams a body is a host.
      expect(
        /new Response\s*\(\s*(response|upstream|body)\b|\.body\s*\)/.test(route.code),
        `${route.rel} looks like it relays a body it fetched.`,
      ).toBe(false);
    }
  });
});
