import { spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ROOT } from "../contracts/scan";


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
    expect(json.error).toMatch(/\d+\s*KB/i);
  });

  it("cuts off a body several times the cap rather than draining it", async () => {
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
    expect([413, "connection closed"]).toContain(outcome);
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 30_000);

  it("still serves normally afterwards", async () => {
    const manifest = await (await fetch(`${BASE}/manifest`)).json();
    expect((manifest as { items: unknown[] }).items.length).toBeGreaterThan(0);
  });

  it("accepts a body under the cap", async () => {
    const response = await post(
      JSON.stringify({
        columnId: "a-column",
        title: "small",
        rationale: "x",
        body: "a paragraph",
      }),
    );
    expect(response.status).toBe(201);
  });
});
