#!/usr/bin/env tsx
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { publicVerif, TokenChallenge, TOKEN_TYPES } from "@cloudflare/privacypass-ts";

import { keyFingerprint } from "../src/lib/tokens/issuer";
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
  issuer?: string;
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

    save({
      ...load(),
      tokens,
      issuer: await keyFingerprint(published.publicKey),
    });
    return tokens.length;
  }

  throw new Error("No issuer key would sign for this account.");
}

type SpendResult =
  | { kind: "spent"; key: string }
  | { kind: "empty" }
  | { kind: "stale" }
  | { kind: "refused" }
  | { kind: "unreachable" };

async function liveIssuerFingerprints(): Promise<Set<string>> {
  const directory = (await (await fetch(`${BASE}/api/tokens/keys`)).json()) as {
    keys: { publicKey: string }[];
  };
  const out = new Set<string>();
  for (const key of directory.keys) out.add(await keyFingerprint(key.publicKey));
  return out;
}

async function readKey(): Promise<SpendResult> {
  const stored = load();
  if (!stored.tokens || stored.tokens.length === 0) return { kind: "empty" };

  try {
    const live = await liveIssuerFingerprints();
    if (!stored.issuer || !live.has(stored.issuer)) {
      save({ ...stored, tokens: [], issuer: undefined });
      return { kind: "stale" };
    }
  } catch {
    return { kind: "unreachable" };
  }

  const [token, ...rest] = stored.tokens;

  let response: Response;
  try {
    response = await fetch(`${BASE}/api/tokens/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
  } catch {
    return { kind: "unreachable" };
  }

  if (!response.ok) {
    save({ ...stored, tokens: rest });
    return { kind: "refused" };
  }

  save({ ...stored, tokens: rest });
  return { kind: "spent", key: ((await response.json()) as { key: string }).key };
}

const SPEND_NOTE: Record<Exclude<SpendResult["kind"], "spent">, string> = {
  empty:
    "no anonymous token spent — this search reached the platform with your ordinary key. Run `tokens` to stock up.",
  stale:
    "the tokens stored here were signed by an issuer key the platform no longer publishes, so they have been discarded. This search WAS attached to your subscription. Run `tokens` for a fresh batch.",
  refused:
    "the token was refused, so this search WAS attached to your subscription. Run `tokens` for a fresh batch.",
  unreachable:
    "the token could not be redeemed just now, so this search WAS attached to your subscription. The token was kept.",
};


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

  const spend = await readKey();
  const body = (await (
    await fetch(url, {
      headers:
        spend.kind === "spent"
          ? { authorization: `Bearer ${spend.key}` }
          : {},
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

  if (body.truncated) {
    console.log(
      `${body.matching} matched. ${body.reach.plan} returns ${body.reach.results}; crawl up to ${body.reach.concurrentNodes} nodes at once.`,
    );
  }

  if (spend.kind !== "spent") {
    console.error(`
note: ${SPEND_NOTE[spend.kind]}`);
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

  const column = (await (
    await fetch(`${address}/column/${encodeURIComponent(item.id)}`)
  ).json()) as {
    servedBySub?: string;
    title: string;
    prose: string;
    claims: Parameters<typeof resolveClaims>[0];
  };

  const impostor = servingMismatch(sub, column.servedBySub);
  if (impostor) {
    throw new Error(
      `${impostor}
Nothing from ${address} is shown. The platform is not in this request and cannot check it for you.`,
    );
  }

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
  process.exitCode = 1;
});
