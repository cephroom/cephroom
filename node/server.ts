import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { config } from "dotenv";

import { parseBody } from "../src/lib/claims/syntax";
import { FREE_SERVING_CAPACITY } from "../src/lib/stripe/plans";
import { readColumnFile, type Column } from "./columns";
import { foldForScope } from "./fold-facts";
import { AnnounceRefused, PresenceLoop } from "./presence";
import { isNodeScoped, ProposalStore, proposalRootFor } from "./proposals";
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

const PAY_TO = flag("pay-to", process.env.PAY_TO ?? "");
const SUB = flag("sub", process.env.NODE_SUBJECT ?? "s_localnode_marcus");
const ADDRESS = flag("address", `http://127.0.0.1:${PORT}`);

const CONTENT_DIR = resolve(
  flag("content", process.env.CONTENT_DIR ?? join(import.meta.dirname, "content")),
);

const contentGiven =
  args.includes("--content") || Boolean(process.env.CONTENT_DIR);
const DATA_DIR = resolve(
  flag(
    "data",
    process.env.DATA_DIR ??
      (contentGiven ? CONTENT_DIR : join(import.meta.dirname, "data")),
  ),
);
const HAS_DATASET = existsSync(join(DATA_DIR, "gap_report.json"));

const MAX_BODY_CHARS = 512 * 1024;
const MAX_PROPOSAL_BYTES = 640 * 1024;
const MAX_OPEN_PER_SUBJECT = 20;

const OVERSHOOT_DRAIN = 4;
const TOO_LARGE = Symbol("payload-too-large");


function readColumns(): Column[] {
  return readdirSync(CONTENT_DIR)
    .filter((file) => file.endsWith(".md"))
    .map((file) =>
      readColumnFile(readFileSync(join(CONTENT_DIR, file), "utf8"), file),
    );
}


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
    cells: {
      gene_symbol: string;
      compound: string;
      fold_spread: number | null;
      fold_spread_iqr: number | null;
      fold_spread_human: number | null;
      n_measurements: number | null;
      n_censored: number | null;
    }[];
    pdsp_cross_check?: {
      comparison?: {
        gene_symbol: string;
        compound: string;
        chembl_n: number | null;
        fold_difference: number | null;
      }[];
    };
  };

  const cellByPair = new Map<string, (typeof report.cells)[number]>();
  for (const cell of report.cells ?? []) {
    cellByPair.set(`${cell.gene_symbol}|${cell.compound}`, cell);
  }

  const pdspByPair = new Map<string, number | null>();
  for (const row of report.pdsp_cross_check?.comparison ?? []) {
    const fold = row.chembl_n ? row.fold_difference : null;
    pdspByPair.set(
      `${row.gene_symbol}|${row.compound}`,
      fold === null ? null : Number.parseFloat(fold.toPrecision(4)),
    );
  }

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
    method: string | null;
    dispersion: number | null;
    dispersionKind: string | null;
    nObservations: number | null;
    value: number;
    unit: string | null;
    nPoints: number | null;
    nDocs: number | null;
    foldSpread: number | null;
    foldSpreadIqr: number | null;
    nMeasurements: number | null;
    nCensored: number | null;
    pdspFold: number | null;
  }[] = [];

  for (const [subject, cells] of kiNm.rows) {
    kiNm.columns.forEach((object, index) => {
      const points = nPoint.rows.get(subject)?.[index] ?? null;
      const docs = nDocs.rows.get(subject)?.[index] ?? null;
      const cell = cellByPair.get(`${subject}|${object}`);
      const foldAll = round4(cell?.fold_spread ?? null);
      const foldIqrAll = round4(cell?.fold_spread_iqr ?? null);
      const foldHuman = round4(cell?.fold_spread_human ?? null);
      const shared = {
        subject,
        object,
        nPoints: points === null ? null : Math.round(points),
        nDocs: docs === null ? null : Math.round(docs),
        nMeasurements: cell?.n_measurements ?? null,
        nCensored: cell?.n_censored ?? null,
        pdspFold: pdspByPair.get(`${subject}|${object}`) ?? null,
      };

      const add = (
        metric: string,
        scope: string,
        value: number | null,
        unit: string | null,
      ) => {
        if (value === null) return;
        const { foldSpread, foldSpreadIqr } = foldForScope(
          { all: foldAll, iqrAll: foldIqrAll, human: foldHuman },
          scope,
        );
        facts.push({
          ...shared,
          metric,
          scope,
          method: null,
          dispersion: null,
          dispersionKind: null,
          nObservations: null,
          value,
          unit,
          foldSpread,
          foldSpreadIqr,
        });
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

function readDecoderBenchmark() {
  const path = join(DATA_DIR, "mi_decoders_2025.json");
  if (!existsSync(path)) return null;

  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    id: string;
    name: string;
    source: string;
    source_url: string;
    release: string;
    generated_at_utc: string;
    provenance: Record<string, string>;
    notes: string[];
    rows: {
      decoder: string;
      offline: number | null;
      offline_sd: number | null;
      online: number | null;
      online_sd: number | null;
    }[];
  };

  const facts = [];
  for (const row of raw.rows) {
    for (const method of ["offline", "online"] as const) {
      const value = row[method];
      if (value === null) continue;
      facts.push({
        subject: row.decoder,
        object: "four-class-motor-imagery",
        metric: "accuracy_pct",
        scope: "all",
        method,
        value,
        unit: "%",
        dispersion: row[`${method}_sd`] ?? null,
        dispersionKind: "sd",
        nObservations: 4,
        nPoints: 4,
        nDocs: 1,
        foldSpread: null,
        foldSpreadIqr: null,
        nMeasurements: null,
        nCensored: null,
        pdspFold: null,
      });
    }
  }

  return {
    id: raw.id,
    name: raw.name,
    description:
      "Ten motor-imagery decoders run under two evaluation protocols, and ten more offline only. The same decoder moves by up to 10.6 points between protocols, which is the number this dataset exists to make checkable.",
    source: raw.source,
    release: raw.release,
    generatedAt: raw.generated_at_utc,
    coverage: null,
    notes: [...raw.notes, `Source: ${raw.source_url}`, raw.provenance.how],
    facts,
  };
}

const columns = readColumns();
const datasets = [
  ...(HAS_DATASET ? [readDataset()] : []),
  ...(readDecoderBenchmark() ? [readDecoderBenchmark()!] : []),
];
const dataset = datasets[0] ?? null;
const PROPOSAL_ROOT = resolve(
  flag("proposals", process.env.PROPOSAL_DIR ?? proposalRootFor(CONTENT_DIR)),
);
const proposals = new ProposalStore(PROPOSAL_ROOT);


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

  const refuseOversized = (message: string) => {
    request.on("error", () => {});
    response.once("finish", () => request.destroy());
    return send(413, { error: message });
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
    return send(200, {
      sub: SUB,
      displayName: DISPLAY_NAME,
      ...(PAY_TO ? { payTo: PAY_TO } : {}),
      items: manifest(),
    });
  }

  if (url.pathname === "/dataset") {
    if (!dataset) return send(404, { error: "no dataset served here" });
    return send(200, dataset);
  }

  if (url.pathname.startsWith("/dataset/")) {
    const wanted = decodeURIComponent(url.pathname.slice("/dataset/".length));
    const found = datasets.find((candidate) => candidate.id === wanted);
    if (!found) return send(404, { error: "not served here" });
    return send(200, { servedBySub: SUB, ...found });
  }

  if (url.pathname === "/proposals" && request.method === "GET") {
    const columnId = url.searchParams.get("column") ?? undefined;
    const column = columnId
      ? columns.find((candidate) => candidate.id === columnId)
      : undefined;
    if (!column) return send(404, { error: "not served here" });

    return send(200, { proposals: proposals.list(columnId) });
  }

  /**
   * Two refusals, and the second one is the contract.
   *
   * A proposal has to be attributable, so an anonymous search token cannot file
   * one - the author needs somebody to answer. And the subject it is attributed
   * to must be scoped to THIS node: a platform-wide subject is the same
   * identifier at every contributor, so writing one here would put a
   * network-wide identifier on a stranger's disk permanently. Refused at the
   * door rather than sanitised on the way out, because a file that was never
   * written needs no migration.
   */
  if (url.pathname === "/proposals" && request.method === "POST") {
    const key = await keyFromRequest(request.headers.authorization);
    if (!key?.scopes.includes("write:propose")) {
      return send(403, {
        error:
          "Proposing needs a signed-in key, so the author has somebody to answer. Signing in is free.",
      });
    }

    const payload = await readJson(request, MAX_PROPOSAL_BYTES);
    if (payload === TOO_LARGE) {
      return refuseOversized(
        `Proposal too large. The limit is ${Math.floor(MAX_PROPOSAL_BYTES / 1024)} KB including the surrounding JSON; the body itself may be up to ${Math.floor(MAX_BODY_CHARS / 1024)} KB.`,
      );
    }
    const columnId = String(payload?.columnId ?? "");
    const column = columns.find((candidate) => candidate.id === columnId);
    if (!column) return send(404, { error: "not served here" });

    const fromSub = key.sub;
    if (!fromSub) {
      return send(403, {
        error:
          "A proposal has to be attributable. Sign in and use your own key rather than an anonymous search token.",
      });
    }

    if (!isNodeScoped(fromSub)) {
      return send(403, {
        error:
          "That key names a platform-wide subject rather than a pseudonym scoped to this node. The same identifier at every contributor is what node-scoping exists to prevent, so it is refused rather than written down.",
      });
    }

    const body = String(payload?.body ?? "");
    const title = String(payload?.title ?? "").trim();
    const rationale = String(payload?.rationale ?? "").trim();

    if (!title) return send(400, { error: "Give the proposal a title." });
    if (title.length > 300 || rationale.length > 4000 || body.length > MAX_BODY_CHARS) {
      return send(400, { error: "A field is too long." });
    }
    if (body.trim() === column.body.trim()) {
      return send(400, { error: "Nothing changed." });
    }
    if (proposals.openFromSubject(columnId, fromSub) >= MAX_OPEN_PER_SUBJECT) {
      return send(429, {
        error: "You have too many open proposals on this column already.",
      });
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
        rationale,
        body,
        fromSub,
      }),
    );
  }

  if (url.pathname.startsWith("/column/")) {
    const id = decodeURIComponent(url.pathname.slice("/column/".length));
    const column = columns.find((candidate) => candidate.id === id);
    if (!column) return send(404, { error: "not served here" });

    const parsed = parseBody(column.body);

    return send(200, {
      id: column.id,
      title: column.title,
      subtitle: column.subtitle,
      repo: column.repo ?? null,
      commit: column.commit ?? null,
      author: DISPLAY_NAME,
      servedBySub: SUB,
      prose: parsed.prose,
      source: column.body,
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
      tags: column.tags,
      summary: column.subtitle,
      openProposals: proposals.countOpen(column.id),
    })),
    ...datasets.map((served) => ({
      id: served.id,
      title: served.name,
      kind: "dataset" as const,
      tags: datasetTags(served.id),
      summary: served.description,
    })),
  ];
}

function datasetTags(id: string): string[] {
  if (id === "mi-decoders-2025") {
    return ["eeg", "bci", "decoding", "comparative-methods"];
  }
  return ["pharmacology", "receptors", "chembl", "binding"];
}

async function keyFromRequest(header: string | undefined) {
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  return verifyKeyWithPlatform(PLATFORM, header.slice(7).trim(), SUB);
}

async function readJson(
  request: import("node:http").IncomingMessage,
  maxBytes: number,
): Promise<Record<string, unknown> | null | typeof TOO_LARGE> {
  const chunks: Buffer[] = [];
  let total = 0;
  let oversized = false;
  for await (const chunk of request) {
    total += (chunk as Buffer).length;
    if (total > maxBytes) {
      if (total > maxBytes * OVERSHOOT_DRAIN) {
        request.destroy();
        return TOO_LARGE;
      }
      oversized = true;
      continue;
    }
    if (oversized) continue;
    chunks.push(chunk as Buffer);
  }
  if (oversized) return TOO_LARGE;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}


let connectionId: string | null = null;

async function serveKey(): Promise<string> {

  if (process.env.NODE_KEY) return process.env.NODE_KEY;
  if (!process.env.CEPHROOM_SIGNING_KEY) {
    throw new Error(
      "No NODE_KEY set and no local signing key to mint one. Sign in on the platform and set NODE_KEY.",
    );
  }
  const { mintServeKey } = await import("../src/lib/keys/tokens");
  return mintServeKey({ sub: SUB, capacity: FREE_SERVING_CAPACITY });
}

async function announceOnce(): Promise<number> {
  const response = await fetch(`${PLATFORM}/api/signal`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await serveKey()}`,
    },
    body: JSON.stringify({
      displayName: DISPLAY_NAME,
      ...(PAY_TO ? { payTo: PAY_TO } : {}),
      address: ADDRESS,
      items: manifest(),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    let detail = body;
    try {
      detail = (JSON.parse(body) as { error?: string }).error ?? body;
    } catch {
      // Not JSON. Whatever the platform said is still better than a guess.
    }
    throw new AnnounceRefused(response.status, detail || response.statusText);
  }

  const json = (await response.json()) as {
    connectionId: string;
    leaseSeconds: number;
  };
  connectionId = json.connectionId;
  return json.leaseSeconds;
}

const presence = new PresenceLoop({
  announce: async () => {
    const leaseSeconds = await announceOnce();
    console.log(
      `announced ${manifest().length} items to ${PLATFORM} as "${DISPLAY_NAME}"`,
    );
    return leaseSeconds;
  },
  onFailure: (detail, permanent) => {
    if (permanent) {
      console.error(
        `
the platform refused this announcement:
  ${detail}

` +
          `This will not clear by waiting. The node is still serving on ` +
          `${ADDRESS} and will keep trying, so fixing the cause brings it ` +
          `back without a restart.
`,
      );
      return;
    }
    console.error(
      `could not announce to ${PLATFORM}: ${detail}
` +
        `Still serving on ${ADDRESS}, and still trying.`,
    );
  },
  beat: async () => {
    if (!connectionId) return null;
    const response = await fetch(
      `${PLATFORM}/api/signal?connection=${connectionId}`,
      { method: "PUT", headers: { authorization: `Bearer ${await serveKey()}` } },
    ).catch(() => null);
    return response?.status ?? null;
  },
});

async function withdraw() {
  presence.stop();
  if (!connectionId) return;
  await fetch(`${PLATFORM}/api/signal?connection=${connectionId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${await serveKey()}` },
  }).catch(() => {});
  console.log("withdrawn — the work is no longer visible on the platform");
}

server.listen(PORT, "127.0.0.1", async () => {
  console.log(
    `node serving ${columns.length} columns + ${datasets.length} dataset${datasets.length === 1 ? "" : "s"} on ${ADDRESS}`,
  );
  await presence.start();
  // Any failure has already been reported by onFailure, in the platform's own
  // words. Saying "could not reach the platform" here as well would reassert
  // the guess this was written to remove.
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await withdraw();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500);
  });
}
