/**
 * A Cephroom node.
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
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { config } from "dotenv";

import { parseBody } from "../src/lib/claims/syntax";
import { tierAllows, type Access } from "../src/lib/access";
import { gateColumnBody } from "./column-gate";
import { foldForScope } from "./fold-facts";
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

/**
 * Where readers can pay this contributor, if they want to.
 *
 * Announced as a plain string and displayed by the platform verbatim. The
 * platform never handles the money: a reader's subscription buys access to the
 * network, and paying the person who wrote something is a separate act they
 * perform directly, wallet to wallet, which this process is not part of and
 * learns nothing about.
 *
 *   npm run node:serve -- --pay-to "0x… / ko-fi.com/… / please don't"
 */
const PAY_TO = flag("pay-to", process.env.PAY_TO ?? "");
const SUB = flag("sub", process.env.NODE_SUBJECT ?? "s_localnode_marcus");
const ADDRESS = flag("address", `http://127.0.0.1:${PORT}`);

// A contributor points the node at their own work with --content and --data
// (or CONTENT_DIR / DATA_DIR in the env). Absent, it serves the demo content
// that ships with the repo. Relative paths resolve against the directory the
// node runs from, not the repo, so `--content ./my-columns` does what a
// contributor expects.
const CONTENT_DIR = resolve(
  flag("content", process.env.CONTENT_DIR ?? join(import.meta.dirname, "content")),
);

/**
 * Where datasets come from.
 *
 * When `--content` is given and `--data` is not, this follows the content
 * directory rather than falling back to the demo data in the repository.
 *
 * That fallback was the old behaviour and it was wrong in a way only visible
 * from the outside: pointing the node at your own columns still announced the
 * shipped example datasets **under your subject**, so the API listed a
 * contributor as serving work that was not theirs. Found by wiring serving
 * into a script and then asking the API what it thought was live.
 */
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

// Proposal-channel limits. A proposal lands on this contributor's disk, so
// these bound a member's ability to fill it. A column body is Markdown;
// 512 KB is generous. The request cap sits a little above the body cap to
// leave room for the surrounding JSON.
const MAX_BODY_CHARS = 512 * 1024;
const MAX_PROPOSAL_BYTES = 640 * 1024;
const MAX_OPEN_PER_SUBJECT = 20;
const TOO_LARGE = Symbol("payload-too-large");

/* ------------------------------------------------------------------ *
 * What this node serves, read from the contributor's own disk
 * ------------------------------------------------------------------ */

interface Column {
  id: string;
  title: string;
  subtitle: string;
  access: Access;
  /**
   * The contributor's own labels, from the column's front matter.
   *
   * Every column used to be announced as `["pharmacology"]`, hardcoded — which
   * was wrong the moment the subject widened past one receptor family, and
   * stayed invisible until the API listed a motor-imagery decoding column
   * under it. Modality first, following the facets OpenNeuro leads with: what
   * was measured, before what it is about.
   */
  tags: string[];
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
        tags: (meta.tags ?? "")
          .split(",")
          .map((tag) => tag.trim().toLowerCase())
          .filter(Boolean),
        repo: meta.repo,
        commit: meta.commit,
        body: match[2].trim(),
      };
    });
}

/** The cephroom snapshot, as a dataset this node serves. */
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

  // The fold spread of a cell — how far its loosest and tightest measurements
  // disagree — is not in the matrices; it lives per cell in the report. Index
  // it so a fact can carry the agreement signal, not just the median.
  const cellByPair = new Map<string, (typeof report.cells)[number]>();
  for (const cell of report.cells ?? []) {
    cellByPair.set(`${cell.gene_symbol}|${cell.compound}`, cell);
  }

  // The cross-check against an independent database (the PDSP Ki DB): the
  // fold difference between ChEMBL's median and PDSP's, per cell. Indexed the
  // same way, so a fact can carry "does a second source agree with this
  // number" — the strongest reproducibility signal in the report.
  const pdspByPair = new Map<string, number | null>();
  for (const row of report.pdsp_cross_check?.comparison ?? []) {
    // A row with no ChEMBL measurements has nothing to compare, and NaN folds
    // were already nulled at parse. Either way the fold is unusable, so the
    // fact carries null and a pdsp_fold claim on it resolves broken, not 0×.
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
    /** The analysis that produced this number. Null: this cell has one. */
    method: string | null;
    /**
     * The spread the dataset reports around this value, in the value's units.
     *
     * Null where the dataset reports none — never zero, because zero is a
     * claim of perfect precision and "not reported" is not that. The binding
     * matrix reports no dispersion per cell, so its facts carry null; the
     * decoder benchmark reports a standard deviation for every value, and
     * until this field existed the node dropped it on the floor and served
     * the mean alone.
     */
    dispersion: number | null;
    /** What kind of spread `dispersion` is: "sd", "sem", "ci95". */
    dispersionKind: string | null;
    /** How many observations it is over, when the dataset says. */
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
        // The censored count and the total behind it — the raw material for a
        // "this cell is a ceiling" claim. A cell property, so it rides every
        // metric like the fold spread does.
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
        // An empty cell is not a fact. Dropping it means a claim against one
        // fails loudly rather than resolving to "no data".
        if (value === null) return;
        const { foldSpread, foldSpreadIqr } = foldForScope(
          { all: foldAll, iqrAll: foldIqrAll, human: foldHuman },
          scope,
        );
        facts.push({
          ...shared,
          metric,
          scope,
          // A median Ki is computed one way. The ChEMBL matrix genuinely has
          // a single analysis per cell, so its facts say so rather than
          // inventing a method name nobody would type.
          method: null,
          // This matrix reports no per-cell dispersion. Null, not zero.
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

  // The dataset keeps the name of the pipeline that produced it, not the name
  // of the platform serving it. `receptorome` is a separate ChEMBL extraction
  // project; this is its output, and a claim's `dataset:` line is provenance.
  // Renaming it to match the platform would assert authorship the platform
  // does not have — and would break every claim already written against it,
  // on machines this repository cannot reach.
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

/**
 * A benchmark whose cells exist under more than one analysis.
 *
 * Ships alongside the binding matrix to make the point the binding matrix
 * cannot: the same decoder scores 59.45% under one evaluation protocol and
 * 70.00% under another. `method` is the protocol, and a claim that does not
 * name one does not resolve. See src/lib/claims/method.ts.
 *
 * Every number is the paper's, transcribed and cross-checked; none is
 * computed here. The file states its own provenance and its own smallness.
 */
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
      // An absent protocol is absent. The ten offline-only decoders get no
      // `online` fact, so a claim against one fails loudly rather than
      // resolving to a number the paper never reported.
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

  // A reader's browser resolves a claim's dataset by slug against the column's
  // own node. This answers only for the dataset this node actually serves, so
  // a claim referencing a slug this author does not serve resolves to broken
  // rather than silently borrowing a stranger's numbers.
  if (url.pathname.startsWith("/dataset/")) {
    const wanted = decodeURIComponent(url.pathname.slice("/dataset/".length));
    const found = datasets.find((candidate) => candidate.id === wanted);
    if (!found) return send(404, { error: "not served here" });
    return send(200, found);
  }

  // Proposals live here, on the author's disk. The platform never sees them.
  if (url.pathname === "/proposals" && request.method === "GET") {
    const columnId = url.searchParams.get("column") ?? undefined;
    const column = columnId
      ? columns.find((candidate) => candidate.id === columnId)
      : undefined;
    if (!column) return send(404, { error: "not served here" });

    // A proposal's body IS the column's full Markdown source — a proposal is
    // an edit to the source the way a PR is a diff of the file. So listing
    // proposals must require exactly the entitlement /column requires, or
    // this route is a side door around the paywall: an anonymous reader could
    // pull the whole paid article (and every proposer's pseudonymous subject)
    // out of the proposals on any member or lab column.
    const tier = await tierFromRequest(request.headers.authorization);
    if (!tierAllows(tier, column.access)) {
      return send(403, {
        error: "Reading proposals needs the same membership as reading the column.",
      });
    }
    return send(200, { proposals: proposals.list(columnId) });
  }

  if (url.pathname === "/proposals" && request.method === "POST") {
    const key = await keyFromRequest(request.headers.authorization);
    if (!key?.scopes.includes("write:propose")) {
      return send(403, {
        error: "Proposing needs a key with write:propose. Membership grants it.",
      });
    }

    // A proposal is written to the contributor's own disk, so the channel is
    // a disk-fill vector: without caps, any member could POST unbounded bytes
    // or unbounded proposals to fill it. Bound the body at the door, bound
    // each field, and bound how many open proposals one subject may hold on
    // one column.
    const payload = await readJson(request, MAX_PROPOSAL_BYTES);
    if (payload === TOO_LARGE) {
      return send(413, { error: "Proposal too large." });
    }
    const columnId = String(payload?.columnId ?? "");
    const column = columns.find((candidate) => candidate.id === columnId);
    if (!column) return send(404, { error: "not served here" });

    // Proposing an edit means editing the source, which means being entitled
    // to read it. A member cannot propose to a lab column they cannot open.
    if (!tierAllows(key.tier, column.access)) {
      return send(403, {
        error: "Proposing needs the same membership as reading the column.",
      });
    }

    // A proposal lands on the author's disk and they have to decide about it,
    // so it has to be from somebody. An anonymous read key — one minted by
    // redeeming a blind-signed token — has no subject and carries no
    // `write:propose` scope; this is the second of those two checks, here
    // because the node enforces its own door rather than trusting the shape of
    // what arrives.
    const fromSub = key.sub;
    if (!fromSub) {
      return send(403, {
        error:
          "A proposal has to be attributable. Sign in and use your own key rather than an anonymous reading token.",
      });
    }

    const body = String(payload?.body ?? "");
    const title = String(payload?.title ?? "").trim();
    const rationale = String(payload?.rationale ?? "").trim();
    const fromName = String(payload?.fromName ?? "A reader").slice(0, 120);

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
        fromName,
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

    // The node enforces the paywall in one pure function so a test can hold
    // the line: a non-entitled reader gets a preview and never the source.
    const gated = gateColumnBody(column.body, entitled);

    return send(200, {
      id: column.id,
      title: column.title,
      subtitle: column.subtitle,
      access: column.access,
      repo: column.repo ?? null,
      commit: column.commit ?? null,
      author: DISPLAY_NAME,
      ...gated,
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
      access: column.access,
      summary: column.subtitle,
      openProposals: proposals.countOpen(column.id),
    })),
    ...datasets.map((served) => ({
      id: served.id,
      title: served.name,
      kind: "dataset" as const,
      tags: datasetTags(served.id),
      access: "public" as const,
      summary: served.description,
    })),
  ];
}

/**
 * Facets a reader can search on.
 *
 * Modality-first, following OpenNeuro — MRI, PET, EEG, iEEG, MEG, NIRS before
 * task or disease. Now that the subject is the nervous system rather than one
 * receptor family, "how was this measured" is the first question a reader
 * asks. These are the contributor's own labels; the platform never invents or
 * stores them.
 */
function datasetTags(id: string): string[] {
  if (id === "mi-decoders-2025") {
    return ["eeg", "bci", "decoding", "comparative-methods"];
  }
  return ["pharmacology", "receptors", "chembl", "binding"];
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
  maxBytes: number,
): Promise<Record<string, unknown> | null | typeof TOO_LARGE> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    total += (chunk as Buffer).length;
    // Stop reading the moment the cap is exceeded, so an attacker cannot make
    // the node buffer gigabytes before it decides to reject them.
    if (total > maxBytes) {
      request.destroy();
      return TOO_LARGE;
    }
    chunks.push(chunk as Buffer);
  }
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

/**
 * The key the node signs its announcements with.
 *
 * Signaling is authenticated: the platform attributes an announcement to the
 * subject in this key and refuses a heartbeat or withdrawal for a connection
 * owned by a different subject. In production the operator supplies their own
 * capability key as NODE_KEY (they get it by signing in). In this monorepo
 * dev setup the node shares the platform's signing key, so it mints one for
 * its configured subject — a convenience that only works because both
 * processes are on the same machine.
 */
async function serveKey(): Promise<string> {
  if (process.env.NODE_KEY) return process.env.NODE_KEY;
  if (!process.env.CEPHROOM_SIGNING_KEY) {
    throw new Error(
      "No NODE_KEY set and no local signing key to mint one. Sign in on the platform and set NODE_KEY.",
    );
  }
  const { mintServeKey } = await import("../src/lib/keys/tokens");
  // A serve key, not an access key: the node only ever announces to the
  // platform, so this matches what a contributor's pasted NODE_KEY is.
  return mintServeKey({ sub: SUB, tier: "reader", name: DISPLAY_NAME });
}

async function announce() {
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
      { method: "PUT", headers: { authorization: `Bearer ${await serveKey()}` } },
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
    headers: { authorization: `Bearer ${await serveKey()}` },
  }).catch(() => {});
  console.log("withdrawn — the work is no longer visible on the platform");
}

server.listen(PORT, "127.0.0.1", async () => {
  console.log(
    `node serving ${columns.length} columns + ${datasets.length} dataset${datasets.length === 1 ? "" : "s"} on ${ADDRESS}`,
  );
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
