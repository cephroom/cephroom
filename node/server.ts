/**
 * A Receptorome node.
 *
 * This is the thing Contract 2 is about. A contributor runs it on their own
 * machine; it reads their columns and datasets off their own disk, announces
 * to the platform that it is serving them, and answers readers directly.
 *
 * The platform never receives a byte of this content. It is told an id, a
 * title and an address, in memory, for as long as this process keeps its
 * lease alive. Stop it and the work is gone from the site — not because
 * anything was deleted, but because the announcement was the only reason it
 * was visible.
 *
 *   npm run node:serve
 *   npm run node:serve -- --port 4600 --name "Marcus Oyelaran"
 */
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { config } from "dotenv";

import { parseBody } from "../src/lib/claims/syntax";
import { tierAllows, type Access } from "../src/lib/access";
import { ProposalStore } from "./proposals";
import { verifyKeyWithPlatform } from "./verify";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const PORT = Number.parseInt(flag("port", "4600"), 10);
const PLATFORM = flag("platform", process.env.AUTH_URL ?? "http://localhost:3000");
const DISPLAY_NAME = flag("name", "Marcus Oyelaran");
const SUB = flag("sub", process.env.NODE_SUBJECT ?? "s_localnode_marcus");
const ADDRESS = flag("address", `http://127.0.0.1:${PORT}`);

const CONTENT_DIR = join(import.meta.dirname, "content");
const DATA_DIR = join(import.meta.dirname, "data");

/* ------------------------------------------------------------------ *
 * What this node serves, read from the contributor's own disk
 * ------------------------------------------------------------------ */

interface Column {
  id: string;
  title: string;
  subtitle: string;
  access: Access;
  repo?: string;
  commit?: string;
  body: string;
}

function readColumns(): Column[] {
  return readdirSync(CONTENT_DIR)
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const raw = readFileSync(join(CONTENT_DIR, file), "utf8");
      const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
      if (!match) throw new Error(`${file} has no front matter.`);

      const meta: Record<string, string> = {};
      for (const line of match[1].split(/\r?\n/)) {
        const sep = line.indexOf(":");
        if (sep === -1) continue;
        meta[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
      }

      return {
        id: meta.slug,
        title: meta.title,
        subtitle: meta.subtitle ?? "",
        access: (meta.access as Access) ?? "public",
        repo: meta.repo,
        commit: meta.commit,
        body: match[2].trim(),
      };
    });
}

/** The receptorome snapshot, as a dataset this node serves. */
function readDataset() {
  const matrix = (file: string) => {
    const text = readFileSync(join(DATA_DIR, file), "utf8").trim();
    const [header, ...lines] = text.split(/\r?\n/);
    const columns = header.split(",").slice(1);
    const rows = new Map<string, (number | null)[]>();
    for (const line of lines) {
      const [key, ...values] = line.split(",");
      rows.set(
        key,
        values.map((value) => {
          const parsed = Number.parseFloat(value);
          return Number.isFinite(parsed) ? parsed : null;
        }),
      );
    }
    return { columns, rows };
  };

  const report = JSON.parse(
    readFileSync(join(DATA_DIR, "gap_report.json"), "utf8").replace(
      /(?<=[:[,]\s*)(NaN|-?Infinity)(?=\s*[,\]}])/g,
      "null",
    ),
  ) as {
    chembl_release: string;
    generated_at_utc: string;
    coverage: Record<string, number>;
    measurement_counts: { n_measurements_total: number };
  };

  const kiNm = matrix("matrix_median_ki_nm.csv");
  const pKi = matrix("matrix_median_pki.csv");
  const pKiHuman = matrix("matrix_median_pki_human.csv");
  const nPoint = matrix("matrix_n_point.csv");
  const nDocs = matrix("matrix_n_docs.csv");

  const round4 = (value: number | null) =>
    value === null ? null : Number.parseFloat(value.toPrecision(4));

  const facts: {
    subject: string;
    object: string;
    metric: string;
    scope: string;
    value: number;
    unit: string | null;
    nPoints: number | null;
    nDocs: number | null;
  }[] = [];

  for (const [subject, cells] of kiNm.rows) {
    kiNm.columns.forEach((object, index) => {
      const points = nPoint.rows.get(subject)?.[index] ?? null;
      const docs = nDocs.rows.get(subject)?.[index] ?? null;
      const shared = {
        subject,
        object,
        nPoints: points === null ? null : Math.round(points),
        nDocs: docs === null ? null : Math.round(docs),
      };

      const add = (
        metric: string,
        scope: string,
        value: number | null,
        unit: string | null,
      ) => {
        // An empty cell is not a fact. Dropping it means a claim against one
        // fails loudly rather than resolving to "no data".
        if (value === null) return;
        facts.push({ ...shared, metric, scope, value, unit });
      };

      add("median_ki_nm", "all", round4(cells[index]), "nM");
      add("median_pki", "all", round4(pKi.rows.get(subject)?.[index] ?? null), null);
      add(
        "median_pki",
        "human",
        round4(pKiHuman.rows.get(subject)?.[index] ?? null),
        null,
      );
    });
  }

  return {
    id: "receptorome-ki",
    name: "Receptorome — antipsychotic binding affinities",
    description:
      "Median Ki and pKi for eight antipsychotics across ten aminergic GPCRs, derived from ChEMBL with an explicit coverage ladder and no imputation.",
    source: "ChEMBL",
    release: report.chembl_release,
    generatedAt: report.generated_at_utc,
    coverage: report.coverage,
    notes: [
      "Ki only. IC50 and Kd are landed and normalised for context but never enter the matrix, and are never converted to Ki.",
      "No value is imputed, estimated or interpolated. Cells with no data are omitted, not zero-filled.",
      "Medians are taken in log space over uncensored point estimates.",
      "Censored measurements such as >10000 nM are counted separately and are true negatives, not missing data.",
      `${report.measurement_counts.n_measurements_total} normalised measurements across 80 cells.`,
    ],
    facts,
  };
}

const columns = readColumns();
const dataset = readDataset();
const proposals = new ProposalStore(import.meta.dirname);

/* ------------------------------------------------------------------ *
 * Serving readers directly
 * ------------------------------------------------------------------ */

const CORS = {
  "access-control-allow-origin": PLATFORM,
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-max-age": "600",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);

  const send = (status: number, body: unknown) => {
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      ...CORS,
    });
    response.end(JSON.stringify(body));
  };

  if (request.method === "OPTIONS") {
    response.writeHead(204, CORS);
    response.end();
    return;
  }

  if (url.pathname === "/health") {
    return send(200, { ok: true, name: DISPLAY_NAME, items: manifest().length });
  }

  if (url.pathname === "/manifest") {
    return send(200, { sub: SUB, displayName: DISPLAY_NAME, items: manifest() });
  }

  if (url.pathname === "/dataset") {
    return send(200, dataset);
  }

  // Proposals live here, on the author's disk. The platform never sees them.
  if (url.pathname === "/proposals" && request.method === "GET") {
    const columnId = url.searchParams.get("column") ?? undefined;
    return send(200, { proposals: proposals.list(columnId) });
  }

  if (url.pathname === "/proposals" && request.method === "POST") {
    const key = await keyFromRequest(request.headers.authorization);
    if (!key?.scopes.includes("write:propose")) {
      return send(403, {
        error: "Proposing needs a key with write:propose. Membership grants it.",
      });
    }

    const payload = await readJson(request);
    const columnId = String(payload?.columnId ?? "");
    const column = columns.find((candidate) => candidate.id === columnId);
    if (!column) return send(404, { error: "not served here" });

    const body = String(payload?.body ?? "");
    const title = String(payload?.title ?? "").trim();
    if (!title) return send(400, { error: "Give the proposal a title." });
    if (body.trim() === column.body.trim()) {
      return send(400, { error: "Nothing changed." });
    }

    const parsed = parseBody(body);
    if (parsed.errors.length > 0) {
      return send(400, { error: `Claim problems: ${parsed.errors[0].message}` });
    }

    return send(
      201,
      proposals.create({
        columnId,
        title,
        rationale: String(payload?.rationale ?? "").trim(),
        body,
        fromSub: key.sub,
        fromName: String(payload?.fromName ?? "A reader"),
      }),
    );
  }

  if (url.pathname.startsWith("/column/")) {
    const id = decodeURIComponent(url.pathname.slice("/column/".length));
    const column = columns.find((candidate) => candidate.id === id);
    if (!column) return send(404, { error: "not served here" });

    // The node enforces access itself, using the platform's public key. The
    // platform is not in this request path at all, so it could not enforce
    // anything even if it wanted to.
    const tier = await tierFromRequest(request.headers.authorization);
    const entitled = tierAllows(tier, column.access);

    const parsed = parseBody(column.body);
    const blocks = parsed.prose.split(/\n{2,}/);
    const take = Math.min(Math.max(3, Math.ceil(blocks.length * 0.28)), 7);

    return send(200, {
      id: column.id,
      title: column.title,
      subtitle: column.subtitle,
      access: column.access,
      repo: column.repo ?? null,
      commit: column.commit ?? null,
      author: DISPLAY_NAME,
      entitled,
      prose: entitled ? parsed.prose : blocks.slice(0, take).join("\n\n"),
      // The Markdown source, claim blocks and all, for anyone entitled to the
      // whole thing. A proposal is an edit to the source the way a pull
      // request is a diff of the file — handing over the rendered prose
      // instead strips the claim definitions and makes the round trip lossy.
      source: entitled ? column.body : null,
      hiddenBlocks: entitled ? 0 : Math.max(0, blocks.length - take),
      claims: parsed.claims,
      errors: parsed.errors,
      servedAt: new Date().toISOString(),
    });
  }

  send(404, { error: "not found" });
});

function manifest() {
  return [
    ...columns.map((column) => ({
      id: column.id,
      title: column.title,
      kind: "column" as const,
      tags: ["pharmacology"],
      access: column.access,
      summary: column.subtitle,
      openProposals: proposals.countOpen(column.id),
    })),
    {
      id: dataset.id,
      title: dataset.name,
      kind: "dataset" as const,
      tags: ["chembl", "binding"],
      access: "public" as const,
      summary: dataset.description,
    },
  ];
}

async function keyFromRequest(header: string | undefined) {
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  return verifyKeyWithPlatform(PLATFORM, header.slice(7).trim());
}

async function tierFromRequest(header: string | undefined) {
  return (await keyFromRequest(header))?.tier ?? ("reader" as const);
}

async function readJson(
  request: import("node:http").IncomingMessage,
): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Announcing, and withdrawing
 * ------------------------------------------------------------------ */

let connectionId: string | null = null;
let heartbeat: NodeJS.Timeout | null = null;

async function announce() {
  const response = await fetch(`${PLATFORM}/api/signal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sub: SUB,
      displayName: DISPLAY_NAME,
      address: ADDRESS,
      items: manifest(),
    }),
  });

  if (!response.ok) {
    throw new Error(`announce failed: ${response.status} ${await response.text()}`);
  }

  const json = (await response.json()) as {
    connectionId: string;
    leaseSeconds: number;
  };
  connectionId = json.connectionId;

  heartbeat ??= setInterval(async () => {
    if (!connectionId) return;
    const beat = await fetch(
      `${PLATFORM}/api/signal?connection=${connectionId}`,
      { method: "PUT" },
    ).catch(() => null);
    // A lapsed lease means the platform restarted. Re-announce rather than
    // silently disappearing.
    if (!beat || beat.status === 410) await announce().catch(() => {});
  }, Math.max(2000, (json.leaseSeconds * 1000) / 3));

  console.log(
    `announced ${manifest().length} items to ${PLATFORM} as "${DISPLAY_NAME}"`,
  );
}

async function withdraw() {
  if (heartbeat) clearInterval(heartbeat);
  if (!connectionId) return;
  await fetch(`${PLATFORM}/api/signal?connection=${connectionId}`, {
    method: "DELETE",
  }).catch(() => {});
  console.log("withdrawn — the work is no longer visible on the platform");
}

server.listen(PORT, "127.0.0.1", async () => {
  console.log(`node serving ${columns.length} columns + 1 dataset on ${ADDRESS}`);
  try {
    await announce();
  } catch (error) {
    console.error(
      `could not announce to ${PLATFORM}. The node is still serving; it is just not discoverable.`,
      error instanceof Error ? error.message : error,
    );
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await withdraw();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500);
  });
}
