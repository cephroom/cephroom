import { describe, expect, it } from "vitest";

import { describeHits, filesMatching, scan, type Rule } from "./scan";
import {
  CLIENT_IP_RULE,
  FS_IMPORT_RULE,
  FS_WRITE_RULE,
  MUTABLE_GLOBAL_RULE,
  NO_LOGGING_RULES,
  REMOTE_STORE_RULE,
  SIMULATED,
  TELEMETRY_RULE,
} from "./rules";

/**
 * Contract 1 — the platform persists nothing about users.
 *
 * The rules themselves live in ./rules, applied here and proven in
 * ./scanner.test.ts. Keeping the rule and the proof-of-rule as one object is
 * deliberate: a rule that has quietly stopped matching anything is
 * indistinguishable, from here, from a rule that is passing.
 */

const PLATFORM_ROOTS = ["src"];

/**
 * Roots scanned for writes.
 *
 * `src` alone is not enough for any rule carrying an allowlist. An allow
 * prefix naming a directory the scan never visits cannot exempt anything, so
 * "permits exactly one exempt path" was comparing a literal to itself while
 * the prefix it named was unreachable. Scanning both roots makes the
 * exemption load-bearing — the simulated counterparty is now genuinely the
 * only thing standing between this rule and a failure.
 */
const WRITE_ROOTS = ["src", "simulated-counterparties"];

describe("Contract 1: no persistence layer exists", () => {
  it("has no database schema", () => {
    const schemas = filesMatching(
      /(^|\/)(schema|migrations?)\.(ts|js|sql)$|^drizzle\/|^prisma\//,
    );
    expect(
      schemas,
      "A schema file means a place to put user rows. There is not supposed to be one.",
    ).toEqual([]);
  });

  it("has no migrations and no checked-in database", () => {
    const dbs = filesMatching(/\.(db|sqlite3?)$|^drizzle\/.*\.sql$/);
    expect(dbs).toEqual([]);
  });

  it("declares no ORM or database driver as a dependency", async () => {
    const pkg = (await import("../../package.json")).default as {
      dependencies?: Record<string, string>;
    };
    const banned = [
      "drizzle-orm",
      "@libsql/client",
      "better-sqlite3",
      "@prisma/client",
      "prisma",
      "mongoose",
      "pg",
      "mysql2",
      "redis",
      "ioredis",
      "@vercel/kv",
      "@upstash/redis",
      "@vercel/postgres",
    ];
    const present = banned.filter((name) => pkg.dependencies?.[name]);
    expect(
      present,
      "A database client in the dependency list is a database waiting to happen.",
    ).toEqual([]);
  });

  it("imports no persistence client anywhere in the platform", () => {
    const rules: Rule[] = [
      {
        name: "orm-or-driver-import",
        pattern:
          /\b(from|require\()\s*.?(drizzle-orm|@libsql\/client|better-sqlite3|@prisma\/client|mongoose|ioredis|@vercel\/kv|@upstash\/redis)/,
      },
      {
        name: "table-declaration",
        pattern: /\b(sqliteTable|pgTable|mysqlTable)\s*\(|CREATE\s+TABLE/i,
      },
    ];
    const hits = scan(PLATFORM_ROOTS, rules);
    expect(hits.length, `\n${describeHits(hits)}\n`).toBe(0);
  });
});

describe("Contract 1: nothing is written as a result of signing in", () => {
  it("performs no filesystem writes in the platform", () => {
    const hits = scan(WRITE_ROOTS, [FS_WRITE_RULE]);
    expect(hits.length, `\n${describeHits(hits)}\n`).toBe(0);
  });

  it("imports no filesystem module at all in the platform", () => {
    // Stronger than banning the call names, and not evadable by reaching a
    // write through a handle those names do not cover.
    const hits = scan(WRITE_ROOTS, [FS_IMPORT_RULE]);
    expect(hits.length, `\n${describeHits(hits)}\n`).toBe(0);
  });
});

/**
 * Every piece of mutable process state in the platform, named.
 *
 * The rule this replaces looked for a declaration whose identifier contained
 * "store", "sessions", "users" or "cache". It caught `const userStore` and
 * missed `const userTable`, `export const accounts: Map<string, User>`, and —
 * most of the point — every global in this repository, all six of which are
 * written as `globalForX.__y ??= new Map()`. A session store in the house
 * style passed unnoticed.
 *
 * So the assertion is an inventory rather than a denylist. State is
 * enumerated and compared against this list; adding any is a failing test
 * until the module is named here with what it holds and why the platform may
 * hold it. The question in review is no longer "does this look like a session
 * store" — which is a judgement — but "why is there a seventh", which is not.
 */
const PERMITTED_GLOBAL_STATE: Record<string, string> = {
  "src/lib/signaling/registry.ts":
    "Presence. Fifteen-second leases, dropped on withdraw or expiry. An address and a manifest, never a person.",
  "src/lib/tokens/issuer.ts":
    "Per-epoch blind-signing keypairs. Two epochs live; retiring the older key is what makes forgetting a spend safe.",
  "src/lib/tokens/nullifiers.ts":
    "The bounded exception: spent nullifiers, opaque, two epochs, a Set with no room for a payload.",
  "src/lib/zk/jwks.ts":
    "The identity provider's published moduli on a 14-day rolling window. Public keys, nothing of the user's.",
  "src/lib/tokens/issuance-gate.ts":
    "A single integer: how many signing batches are in flight. Counts work, never people — a per-subscriber limit would be an activity record.",
  "src/lib/zk/verify.ts":
    "Outstanding sign-in challenges. Random bytes and an epoch, capped, spent on use.",
};

describe("Contract 1: process state is enumerated, not merely unnoticed", () => {
  it("holds mutable global state in exactly the named modules", () => {
    const found = [
      ...new Set(scan(PLATFORM_ROOTS, [MUTABLE_GLOBAL_RULE]).map((hit) => hit.file)),
    ].sort();
    const permitted = Object.keys(PERMITTED_GLOBAL_STATE).sort();

    const unexpected = found.filter((file) => !permitted.includes(file));
    expect(
      unexpected,
      `These modules hold process state and are not named in PERMITTED_GLOBAL_STATE.\nIf that is deliberate, add each with what it holds and why the platform may hold it.\n${unexpected.join("\n")}\n`,
    ).toEqual([]);

    const gone = permitted.filter((file) => !found.includes(file));
    expect(
      gone,
      `These modules are named as holding state but no longer do. Remove them rather than leaving a stale exemption behind.\n${gone.join("\n")}\n`,
    ).toEqual([]);
  });

  it("makes every one of them forget, rather than merely be small", async () => {
    // Naming the state is half of it. The other half is that each one drops
    // what it holds without being asked: a store that only grows is a store,
    // whatever the module comment says about it.
    const { createRegistry } = await import("@/lib/signaling/registry");
    const { NullifierStore } = await import("@/lib/tokens/nullifiers");

    let clock = 1_000_000;
    const registry = createRegistry(() => clock);
    registry.announce({
      sub: "s_x",
      displayName: "X",
      address: "http://127.0.0.1:4600",
      items: [],
    });
    expect(registry.size()).toBe(1);
    clock += 60_000; // a minute: four lease lengths
    expect(registry.size()).toBe(0);

    const nullifiers = new NullifierStore(2);
    for (let epoch = 0; epoch < 40; epoch += 1) {
      nullifiers.spend(epoch, epoch.toString(16).padStart(64, "0"));
    }
    expect(nullifiers.size()).toBe(2);
  });

  it("bounds the development identity provider too", async () => {
    // The local Google stand-in lives under simulated-counterparties/ and so
    // is outside the inventory above — but it runs inside the platform
    // process and it holds personas, so an unbounded map of issued tokens to
    // personas would still be a user table that nobody had named one.
    const devOAuth = await import("@simulated/google/provider");
    const persona = devOAuth.DEV_PERSONAS[0];

    const token = devOAuth.issueToken(persona, 1_000);
    expect(devOAuth.personaForToken(token, 1_000)).toEqual(persona);

    // Expired, and gone rather than merely rejected.
    expect(devOAuth.personaForToken(token, 1_000 + devOAuth.DEV_TOKEN_TTL_MS + 1)).toBeNull();
    expect(devOAuth.issuedTokenCount()).toBe(0);
  });
});

describe("Contract 1: identity never reaches a log or an address", () => {
  it("never reads a client IP address", () => {
    const hits = scan(PLATFORM_ROOTS, [CLIENT_IP_RULE]);
    expect(
      hits.length,
      `The platform must not read the client IP. A node states its own address.\n${describeHits(hits)}\n`,
    ).toBe(0);
  });

  it("never logs anything at all from the platform", () => {
    const hits = scan(PLATFORM_ROOTS, NO_LOGGING_RULES);
    expect(
      hits.length,
      `The platform writes no logs. Everything it could log is about a person.\n${describeHits(hits)}\n`,
    ).toBe(0);
  });

  it("sends nothing to a telemetry collector or a hosted store", () => {
    const hits = scan(PLATFORM_ROOTS, [TELEMETRY_RULE, REMOTE_STORE_RULE]);
    expect(hits.length, `\n${describeHits(hits)}\n`).toBe(0);
  });

  it("configures no analytics or error reporter", async () => {
    const pkg = (await import("../../package.json")).default as {
      dependencies?: Record<string, string>;
    };
    const banned = [
      "@sentry/nextjs",
      "@sentry/node",
      "posthog-js",
      "posthog-node",
      "@vercel/analytics",
      "mixpanel",
      "@datadog/browser-rum",
      "logrocket",
    ];
    expect(banned.filter((name) => pkg.dependencies?.[name])).toEqual([]);
  });
});

describe("Contract 1: the allowlist has not grown", () => {
  it("permits exactly one exempt path, and it is the simulated counterparty", () => {
    // Written out so that widening an allowlist is a visible diff on a test
    // rather than a quiet addition to an array.
    expect([SIMULATED]).toEqual(["simulated-counterparties/"]);
  });

  it("exempts a path the scan actually reaches", () => {
    // The assertion above compares a literal to itself, which is a fine diff
    // tripwire and a worthless check. This is the half that was missing: the
    // exempt prefix has to name something inside a scanned root, or it is
    // exempting nothing and the rule is unguarded in a way nobody would see.
    expect(
      WRITE_ROOTS.some(
        (root) => SIMULATED.startsWith(`${root}/`) || SIMULATED === `${root}/`,
      ),
      `The fs-write allowlist exempts "${SIMULATED}", but the scan visits only ${WRITE_ROOTS.join(", ")}. An allowlist over a directory that is never scanned hides nothing and protects nothing.`,
    ).toBe(true);
  });

  it("still catches a write outside the exempt path", () => {
    // Proof the rule can fail. The simulated counterparty does write a file,
    // so without the allowlist this fires — which is what makes its silence
    // with the allowlist in place mean something.
    const hits = scan(WRITE_ROOTS, [{ ...FS_WRITE_RULE, allow: [] }]);
    expect(
      hits.map((hit) => hit.file),
      "Without the allowlist the simulated counterparty should be the only thing caught. Empty means the rule has stopped working; anything under src/ means the platform has started writing.",
    ).toEqual(["simulated-counterparties/stripe/store.ts"]);
  });
});
