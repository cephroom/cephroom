#!/usr/bin/env tsx
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { publicVerif, TokenChallenge, TOKEN_TYPES } from "@cloudflare/privacypass-ts";

import { resolveClaims, type Dataset } from "../src/lib/claims/resolve";
import { servingMismatch } from "../src/lib/signaling/serving";
import { parseBody } from "../src/lib/claims/syntax";

const { Client, BlindRSAMode } = publicVerif;

const BASE = process.env.CEPHROOM_URL ?? "http://localhost:3000";
const HOME = join(homedir(), ".cephroom");
const CREDENTIALS = join(HOME, "credentials.json");

interface Stored {
  renewalKey?: string;
  tokens?: string[];
}

function load(): Stored {
  try {
    return JSON.parse(readFileSync(CREDENTIALS, "utf8")) as Stored;
  } catch {
    return {};
  }
}

function save(next: Stored): void {
  mkdirSync(HOME, { recursive: true });
  writeFileSync(CREDENTIALS, JSON.stringify(next, null, 2), { mode: 0o600 });
}


async function accessKey(): Promise<string | null> {
  const { renewalKey } = load();
  if (!renewalKey) return null;

  const response = await fetch(`${BASE}/api/auth/refresh`, {
    method: "POST",
    headers: { cookie: `cephroom_renew=${renewalKey}` },
  });
  if (!response.ok) return null;

  // The access key comes back as a Set-Cookie, because the browser is the
  // primary client and this endpoint serves both.
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/cephroom_key=([^;]+)/);
  return match ? match[1] : null;
}

async function stockUp(): Promise<number> {
  const key = await accessKey();
  if (!key) throw new Error("No renewal key. Run `login` first.");

  const directory = (await (await fetch(`${BASE}/api/tokens/keys`)).json()) as {
    keys: { tier: string; epoch: number; publicKey: string }[];
  };
  const newest = [...directory.keys].sort((a, b) => b.epoch - a.epoch);

  for (const published of newest) {
    const publicKeyBytes = Uint8Array.from(
      Buffer.from(published.publicKey, "base64"),
    );
    const challenge = new TokenChallenge(
      TOKEN_TYPES.BLIND_RSA.value,
      "cephroom",
      new Uint8Array(32),
      ["cephroom"],
    );

    const clients: InstanceType<typeof Client>[] = [];
    const requests: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const client = new Client(BlindRSAMode.PSS);
      const request = await client.createTokenRequest(challenge, publicKeyBytes);
      clients.push(client);
      requests.push(Buffer.from(request.serialize()).toString("base64"));
    }

    const issued = await fetch(`${BASE}/api/tokens/issue`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `cephroom_key=${key}` },
      body: JSON.stringify({ requests }),
    });
    if (!issued.ok) {
      if (issued.status === 403) {
        const body = (await issued.json()) as { error?: string };
        throw new Error(body.error ?? "Not a subscriber.");
      }
      continue;
    }

    const { responses, tier } = (await issued.json()) as {
      responses: string[];
      tier: string;
    };
    if (tier !== published.tier) continue;

    const tokens: string[] = [];
    for (let index = 0; index < clients.length; index += 1) {
      const bytes = Uint8Array.from(Buffer.from(responses[index], "base64"));
      const token = await clients[index].finalize(
        publicVerif.TokenResponse.deserialize(bytes),
      );
      tokens.push(Buffer.from(token.serialize()).toString("base64"));
    }

    save({ ...load(), tokens });
    return tokens.length;
  }

  throw new Error("No issuer key would sign for this account.");
}

async function readKey(): Promise<string | null> {
  const stored = load();
  if (!stored.tokens || stored.tokens.length === 0) return null;

  const [token, ...rest] = stored.tokens;
  save({ ...stored, tokens: rest });

  const response = await fetch(`${BASE}/api/tokens/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) return null;
  return ((await response.json()) as { key: string }).key;
}


async function cmdLogin(argument?: string): Promise<void> {
  if (!argument) {
    console.log(
      [
        "Cephroom has no API keys — an API key is a stable identifier issued to",
        "a person, which is the thing this platform refuses to hold.",
        "",
        "Instead, once:",
        `  1. open ${BASE}/account in a browser and sign in`,
        "  2. run this in its console:",
        "",
        "       await fetch('/api/auth/cli-key', {method:'POST'})",
        "         .then(r => r.json()).then(r => console.log(r.key))",
        "",
        "  3. paste it back here:",
        "",
        "       npx tsx scripts/cephroom.ts login <key>",
        "",
        "It lasts seven days, renews your access without another sign-in, and is",
        "stored only in ~/.cephroom/credentials.json on this machine.",
      ].join("\n"),
    );
    return;
  }

  save({ ...load(), renewalKey: argument });
  const key = await accessKey();
  console.log(
    key
      ? "Saved. Access confirmed."
      : "Saved, but that key did not renew. It may have expired — get a fresh one.",
  );
}

async function cmdTokens(): Promise<void> {
  const count = await stockUp();
  console.log(
    `${count} anonymous tokens. Each spends one search at your plan's reach, carrying nothing else.`,
  );
}

async function cmdLive(query?: string): Promise<void> {
  const url = new URL(`${BASE}/api/v1/live`);
  if (query) url.searchParams.set("q", query);

  // Searching is the one thing that happens on the platform's own surface, so
  // it is the one thing worth spending a token on: the query runs at the
  // reach the plan bought, with nothing tying it to the subscription. Without
  // a token it still runs, at the free reach.
  const key = await readKey();
  const body = (await (
    await fetch(url, {
      headers: key ? { authorization: `Bearer ${key}` } : {},
    })
  ).json()) as {
    count: number;
    contributors: number;
    truncated?: boolean;
    matching?: number;
    reach: { plan: string; results: number; concurrentNodes: number };
    results: {
      sub: string;
      id: string;
      title: string;
      kind: string;
      servedBy: string;
      tags: string[];
    }[];
  };

  console.log(
    `${body.count} item${body.count === 1 ? "" : "s"} from ${body.contributors} contributor${body.contributors === 1 ? "" : "s"}, right now:\n`,
  );
  for (const item of body.results) {
    console.log(`  ${item.kind.padEnd(7)} ${item.id}`);
    console.log(`          ${item.title}`);
    console.log(`          ${item.servedBy} · ${item.sub} · ${item.tags.join(", ")}\n`);
  }

  // Said plainly rather than left as a short list somebody reads as a quiet
  // network: this is the plan's reach, not everything being served.
  if (body.truncated) {
    console.log(
      `${body.matching} matched. ${body.reach.plan} returns ${body.reach.results}; crawl up to ${body.reach.concurrentNodes} nodes at once.`,
    );
  }
}

async function cmdRead(sub?: string, id?: string): Promise<void> {
  if (!sub || !id) throw new Error("Usage: read <sub> <id>");

  const located = await fetch(
    `${BASE}/api/v1/read/${encodeURIComponent(sub)}/${encodeURIComponent(id)}`,
  );
  if (!located.ok) {
    const body = (await located.json()) as { detail?: string };
    throw new Error(body.detail ?? "Not served right now.");
  }

  const { address, item } = (await located.json()) as {
    address: string;
    item: { id: string; title: string; kind: string };
  };

  // Nothing is sent to the node. It serves a column to whoever asks and has
  // nothing to check, so a key here would buy nothing and hand a contributor
  // one more thing about the reader than they needed.
  const column = (await (
    await fetch(`${address}/column/${encodeURIComponent(item.id)}`)
  ).json()) as {
    servedBySub?: string;
    title: string;
    prose: string;
    claims: Parameters<typeof resolveClaims>[0];
  };

  // The registry hands out an address that somebody announced, and nothing
  // there ties the address to the subject announcing it — one contributor can
  // list another's node. Checked here, before the datasets are pulled from the
  // same machine, because those are what every claim is checked against.
  const impostor = servingMismatch(sub, column.servedBySub);
  if (impostor) {
    throw new Error(
      `${impostor}
Nothing from ${address} is shown. The platform is not in this request and cannot check it for you.`,
    );
  }

  // Datasets come from the same node, never from whichever node announces the
  // slug — an author vouches for the data they serve.
  const datasets = new Map<string, Dataset>();
  for (const slug of new Set(column.claims.map((claim) => claim.datasetSlug))) {
    const response = await fetch(
      `${address}/dataset/${encodeURIComponent(slug)}`,
    ).catch(() => null);
    if (response?.ok) datasets.set(slug, (await response.json()) as Dataset);
  }

  const run = resolveClaims(
    column.claims,
    datasets,
    sub,
    new Date().toISOString(),
  );

  console.log(`${column.title}\n`);
  console.log(`served from ${address}, which was told nothing about you`);
  console.log(
    `${run.counts.verified} verified · ${run.counts.drifted} drifted · ${run.counts.broken} broken`,
  );
  console.log();

  for (const claim of run.views.values()) {
    const mark =
      claim.verdict === "verified" ? "ok " : claim.verdict === "drifted" ? "~~ " : "!! ";
    console.log(`  ${mark}${claim.key.padEnd(20)} ${claim.display.padStart(12)}`);
    if (claim.note) console.log(`      ${claim.note}`);
  }

  // Exit non-zero when something is wrong, so this composes into CI the way
  // the whole premise of the platform suggests it should.
  if (run.conclusion === "broken" || run.conclusion === "drifted") {
    process.exitCode = 1;
  }
}

async function cmdCheck(path?: string): Promise<void> {
  if (!path) throw new Error("Usage: check <file.md>");
  if (!existsSync(path)) throw new Error(`No such file: ${path}`);

  const raw = readFileSync(path, "utf8");
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const parsed = parseBody(body);

  console.log(`${parsed.claims.length} claims, ${parsed.errors.length} problems\n`);
  for (const error of parsed.errors) console.log(`  !! ${error.message}`);
  for (const claim of parsed.claims) {
    const method = claim.method ? ` method:${claim.method}` : "";
    console.log(
      `  ok ${claim.key.padEnd(20)} ${claim.datasetSlug} ${claim.metric}(${claim.subject} × ${claim.object})${method}`,
    );
  }
  if (parsed.errors.length > 0) process.exitCode = 1;
}


const [command, ...rest] = process.argv.slice(2);

const commands: Record<string, (...args: string[]) => Promise<void>> = {
  login: cmdLogin,
  tokens: cmdTokens,
  live: cmdLive,
  read: cmdRead,
  check: cmdCheck,
};

if (!command || !commands[command]) {
  console.log(
    [
      "cephroom — the command line",
      "",
      "  live [query]            what is being served right now",
      "  read <sub> <id>         fetch a column and check every claim locally",
      "  check <file.md>         check a column's claims before serving it",
      "  login [key]             store a renewal key (no API keys here)",
      "  tokens                  top up anonymous access tokens",
      "",
      `  platform: ${BASE}  (override with CEPHROOM_URL)`,
    ].join("\n"),
  );
  process.exit(command ? 1 : 0);
}

commands[command](...rest).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  // `process.exitCode`, not `process.exit()`. Every error path worth having
  // here runs after a network call, and exiting outright tears the process
  // down while the sockets `fetch` opened are still closing — on Windows
  // libuv aborts, and the code that reaches the caller is 127 rather than 1.
  // A script wrapping this tool could not tell a refusal from a missing
  // binary, and the refusal it could not read was the one protecting a reader
  // from a node that is not who it claimed to be.
  process.exitCode = 1;
});
