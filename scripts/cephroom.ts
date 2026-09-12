#!/usr/bin/env tsx
/**
 * The Cephroom command line.
 *
 *   npx tsx scripts/cephroom.ts live "motor imagery"
 *   npx tsx scripts/cephroom.ts read s_localnode_marcus which-protocol-produced-that-number
 *
 * This exists because of the rule that an API you cannot do the real work
 * through is decorative — and its mirror, that anything only the API can do is
 * a UI defect. Everything here is a plain HTTP call anybody could make with
 * curl; what the CLI adds is the one step that is genuinely awkward by hand,
 * which is blinding and unblinding anonymous access tokens.
 *
 * **There are no API keys.** An API key is a stable identifier issued to a
 * person and stored by the issuer so it can be checked, which is exactly what
 * Contract 1 forbids. Authentication is the Layer 1 token scheme: a renewal
 * key you paste in once, which mints short access keys, which buy blind-signed
 * tokens, which are spent one per read for a key carrying a tier and no
 * identity. The platform cannot tell which of your reads are yours, and that
 * is as true from a script as from a browser.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { publicVerif, TokenChallenge, TOKEN_TYPES } from "@cloudflare/privacypass-ts";

import { resolveClaims, type Dataset } from "../src/lib/claims/resolve";
import { parseBody } from "../src/lib/claims/syntax";

const { Client, BlindRSAMode } = publicVerif;

const BASE = process.env.CEPHROOM_URL ?? "http://localhost:3000";
const HOME = join(homedir(), ".cephroom");
const CREDENTIALS = join(HOME, "credentials.json");

interface Stored {
  /** The renewal key. On your disk, in your home directory, and nowhere else. */
  renewalKey?: string;
  /** Unspent anonymous tokens, base64. */
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

/* ------------------------------------------------------------------ *
 * Authentication, such as it is
 * ------------------------------------------------------------------ */

/** Turns the renewal key into a short access key, the way a browser does. */
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

/**
 * Tops up the local wallet with blind-signed tokens.
 *
 * The blinding factors are generated here and never leave this process, which
 * is the whole mechanism: the platform signs twelve values it cannot read, and
 * later cannot recognise the one you spend.
 */
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

/**
 * Spends one token for a read key that carries a tier and no identity.
 *
 * Returns null rather than throwing when the wallet is empty: reading public
 * columns needs no key at all, and a script that only reads open work should
 * not be made to subscribe.
 */
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

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

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
    `${count} anonymous tokens. Each buys one read that carries your tier and nothing else.`,
  );
}

async function cmdLive(query?: string): Promise<void> {
  const url = new URL(`${BASE}/api/v1/live`);
  if (query) url.searchParams.set("q", query);

  const body = (await (await fetch(url)).json()) as {
    count: number;
    contributors: number;
    results: {
      sub: string;
      id: string;
      title: string;
      kind: string;
      access: string;
      servedBy: string;
      tags: string[];
    }[];
  };

  console.log(
    `${body.count} item${body.count === 1 ? "" : "s"} from ${body.contributors} contributor${body.contributors === 1 ? "" : "s"}, right now:\n`,
  );
  for (const item of body.results) {
    const gate = item.access === "public" ? "" : ` [${item.access}]`;
    console.log(`  ${item.kind.padEnd(7)} ${item.id}${gate}`);
    console.log(`          ${item.title}`);
    console.log(`          ${item.servedBy} · ${item.sub} · ${item.tags.join(", ")}\n`);
  }
}

/**
 * Fetches a column from its author's node and checks every claim locally.
 *
 * The checking uses the same pure module the website uses. A consumer who does
 * not trust the platform's rendering gets the same verdicts by running the same
 * code over bytes they fetched themselves, which is the point of the claim
 * system being pure and the point of this command existing.
 */
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

  const key = await readKey();
  const headers: Record<string, string> = key
    ? { authorization: `Bearer ${key}` }
    : {};

  const column = (await (
    await fetch(`${address}/column/${encodeURIComponent(item.id)}`, { headers })
  ).json()) as {
    title: string;
    entitled: boolean;
    prose: string;
    claims: Parameters<typeof resolveClaims>[0];
    hiddenBlocks: number;
    withheldClaimCount?: number;
  };

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
  console.log(
    `served from ${address}${key ? " with an anonymous token" : " anonymously, no token"}`,
  );
  console.log(
    `${run.counts.verified} verified · ${run.counts.drifted} drifted · ${run.counts.broken} broken`,
  );
  if (!column.entitled) {
    console.log(
      `preview only — ${column.hiddenBlocks} sections and ${column.withheldClaimCount ?? 0} numbers withheld`,
    );
  }
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

/** Checks a local Markdown column before serving it. No network, no node. */
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

/* ------------------------------------------------------------------ */

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
  process.exit(1);
});
