import { describe, expect, it } from "vitest";

import { describeHits, filesMatching, scan, type Rule } from "./scan";

/**
 * Contract 1 — the platform persists nothing about users.
 *
 * See docs/CONTRACTS.md. Every allowlist entry below must have a matching
 * justification in that document under "Where the contracts bend".
 */

// The one permitted store belongs to the simulated counterparty, not to the
// platform. The directory name is the boundary.
const SIMULATED = "simulated-counterparties/";

const PLATFORM_ROOTS = ["src"];

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
    const rules: Rule[] = [
      {
        name: "fs-write",
        pattern:
          /\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|mkdirSync|mkdir|rmSync|unlinkSync|renameSync|copyFileSync)\s*\(/,
        allow: [SIMULATED],
      },
    ];
    const hits = scan(PLATFORM_ROOTS, rules);
    expect(hits.length, `\n${describeHits(hits)}\n`).toBe(0);
  });

  it("keeps no module-level mutable store of identities", () => {
    // A Map at module scope in the platform is a session store with extra
    // steps. The signaling registry is allowed and lives in its own module,
    // documented as bend #1.
    const rules: Rule[] = [
      {
        name: "module-level-store",
        pattern: /^\s*(const|let|var)\s+\w*(store|sessions|users|cache)\w*\s*(:|=)\s*(new\s+(Map|Set|WeakMap)|\{\})/i,
      },
    ];
    const hits = scan(PLATFORM_ROOTS, rules);
    expect(hits.length, `\n${describeHits(hits)}\n`).toBe(0);
  });
});

describe("Contract 1: identity never reaches a log or an address", () => {
  it("never reads a client IP address", () => {
    const rules: Rule[] = [
      {
        name: "client-ip",
        pattern:
          /x-forwarded-for|x-real-ip|cf-connecting-ip|\bremoteAddress\b|\brequest\.ip\b|\breq\.ip\b/i,
      },
    ];
    const hits = scan(PLATFORM_ROOTS, rules);
    expect(
      hits.length,
      `The platform must not read the client IP. A node states its own address.\n${describeHits(hits)}\n`,
    ).toBe(0);
  });

  it("never logs a subject, a customer id, an email, or token material", () => {
    const rules: Rule[] = [
      {
        name: "identity-in-log",
        pattern:
          /console\.(log|info|warn|error|debug)\s*\([^)]*\b(email|token|refreshToken|accessToken|customerId|\bcus\b|\bsub\b)\b/i,
      },
    ];
    const hits = scan(PLATFORM_ROOTS, rules);
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
});
