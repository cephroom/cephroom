import { spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ROOT } from "../contracts/scan";

/**
 * Rejecting a too-large proposal has to produce a refusal, not a dropped call.
 *
 * Found with a hostile consumer posting a 2 MB proposal to another
 * contributor's node. The cap worked — nothing was buffered, nothing was
 * written — but the client saw:
 *
 *   [TypeError: fetch failed]  cause: Error: read ECONNRESET
 *
 * The node destroys the request socket the moment the cap is exceeded, which
 * is right, and then tries to write a 413 into a socket it has just killed.
 * The defence holds and the explanation is lost.
 *
 * That matters beyond tidiness because the person who hits this is almost
 * never an attacker. An attacker does not read the response. It is the
 * contributor who wrote a long, careful proposal and gets a network error
 * with no indication that their work was too big, no size named, and nothing
 * to act on — the same failure as a CLI exiting 127 on a refusal, or a page
 * headed "stopped answering" about a node that answered.
 */

let node: ChildProcess;
let stub: Server;
let dir: string;
let proposeKey: string;

const PORT = 4699;
const STUB_PORT = 4698;
const NODE_SUB = "s_oversized_test_node";
const BASE = `http://127.0.0.1:${PORT}`;

const COLUMN = `---
slug: a-column
title: A column
subtitle: For the oversized-body test
access: public
tags: test
---

A paragraph.
`;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "cephroom-oversized-"));
  writeFileSync(join(dir, "a-column.md"), COLUMN);

  // A stand-in platform, so the node can verify a key with a public key alone
  // — which is the whole point of the asymmetric design and makes this
  // testable without running the real thing.
  const pair = generateKeyPairSync("ed25519");
  process.env.CEPHROOM_SIGNING_KEY = Buffer.from(
    pair.privateKey.export({ type: "pkcs8", format: "pem" }) as string,
  ).toString("base64");
  process.env.CEPHROOM_PUBLIC_KEY = Buffer.from(
    pair.publicKey.export({ type: "spki", format: "pem" }) as string,
  ).toString("base64");
  process.env.AUTH_SUBJECT_SECRET ??= randomBytes(32).toString("hex");

  const tokens = await import("@/lib/keys/tokens");
  proposeKey = await tokens.mintNodeKey({
    sub: "s_a_reader",
    audience: NODE_SUB,
    sessionSecondsLeft: 900,
  });

  stub = createServer((req, res) => {
    if (req.url?.startsWith("/.well-known/cephroom-key")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          issuer: tokens.ISSUER,
          audience: tokens.ACCESS_AUDIENCE,
          alg: "EdDSA",
          publicKey: tokens.publicKeyPem(),
        }),
      );
      return;
    }
    // The node also tries to announce; it does not matter here.
    res.writeHead(404).end("{}");
  });
  await new Promise<void>((r) => stub.listen(STUB_PORT, "127.0.0.1", r));

  node = spawn(
    process.execPath,
    [
      join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
      join(ROOT, "node", "server.ts"),
      "--port", String(PORT),
      "--content", dir,
      "--data", dir,
      // The stub above, so the node can fetch the public key it verifies with.
      "--sub", NODE_SUB,
      "--platform", `http://127.0.0.1:${STUB_PORT}`,
    ],
    { cwd: ROOT, stdio: "ignore" },
  );

  for (let i = 0; i < 80; i += 1) {
    try {
      await fetch(`${BASE}/manifest`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error("node did not start");
}, 60_000);

afterAll(async () => {
  node?.kill();
  await new Promise<void>((r) => stub.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

const post = (body: string) =>
  fetch(`${BASE}/proposals`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${proposeKey}`,
    },
    body,
  });

describe("a proposal larger than the cap is refused, in words", () => {
  it("answers 413 rather than resetting the connection", async () => {
    const payload = JSON.stringify({
      columnId: "a-column",
      title: "too big",
      rationale: "x",
      body: "z".repeat(2_000_000),
    });

    // The assertion is that this resolves at all. Before the fix it threw
    // TypeError: fetch failed, with ECONNRESET underneath.
    const response = await post(payload);
    expect(response.status).toBe(413);
  });

  it("says what went wrong, so the writer knows it was the size", async () => {
    const response = await post(
      JSON.stringify({
        columnId: "a-column",
        title: "too big",
        rationale: "x",
        body: "z".repeat(2_000_000),
      }),
    );
    const json = (await response.json()) as { error?: string };
    expect(json.error).toMatch(/too large|too big/i);
    // And names the limit, so the writer knows what to cut to.
    expect(json.error).toMatch(/\d+\s*KB/i);
  });

  it("cuts off a body several times the cap rather than draining it", async () => {
    // The original defence has to survive the fix. An honest overshoot is
    // drained so the sender can be told why; ten megabytes is nobody's slip,
    // and the node hangs up instead of politely receiving all of it.
    const started = Date.now();
    let outcome: number | string;
    try {
      const response = await post(
        JSON.stringify({
          columnId: "a-column",
          title: "much too big",
          rationale: "x",
          body: "z".repeat(10_000_000),
        }),
      );
      outcome = response.status;
    } catch {
      outcome = "connection closed";
    }
    // Either answer is acceptable; being *slow* is not, and neither is the
    // node accepting ten megabytes.
    expect([413, "connection closed"]).toContain(outcome);
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 30_000);

  it("still serves normally afterwards", async () => {
    // A rejected upload must not leave the node wedged for everyone else.
    const manifest = await (await fetch(`${BASE}/manifest`)).json();
    expect((manifest as { items: unknown[] }).items.length).toBeGreaterThan(0);
  });

  it("accepts a body under the cap", async () => {
    // Proof the 413 is about size and not about everything.
    const response = await post(
      JSON.stringify({
        columnId: "a-column",
        title: "small",
        rationale: "x",
        body: "a paragraph",
      }),
    );
    // Past the body reader entirely: a valid proposal is created.
    expect(response.status).toBe(201);
  });
});
