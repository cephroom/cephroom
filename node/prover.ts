/**
 * A Cephroom prover node.
 *
 *   npm run prover:serve
 *   npm run prover:serve -- --port 4700 --circuit ./circuit
 *
 * This is the third node type. The platform already depends on nodes it does
 * not run — contributors serve their own columns — and proving is another of
 * them. A reader who wants the platform never to see their Google identity
 * sends their JWT to a prover of their choosing, which returns a
 * zero-knowledge proof the platform can check without learning anything.
 *
 * ## Read this before running somebody else's
 *
 * **A prover sees the JWT you give it.** That is the whole of the trade: this
 * does not remove trust, it moves it from the platform to a party you pick.
 * The only configuration with no trust assumption at all is the one where you
 * run this yourself, on your own machine, which is why the documentation leads
 * with that and why this file exists rather than a hosted service.
 *
 * ## What a prover must not learn
 *
 * A prover is handed a JWT and a challenge. It is deliberately not told, and
 * has no way to find out:
 *
 * - what the user will read afterwards — proving happens at sign-in, the
 *   reading happens later against a contributor's node, and the two are joined
 *   by nothing;
 * - which platform resource the proof will be spent on — the challenge is 32
 *   random bytes with no structure, so it names nothing;
 * - whether the proof was ever used at all.
 *
 * A prover that logged every JWT it saw would learn who signed in to Cephroom
 * and when. That is the exposure, stated plainly. It is strictly less than the
 * platform has today, and it is the user's to place.
 *
 * ## What this process stores
 *
 * Nothing. The JWT is held for the length of one request. There is no queue,
 * no cache, no log of requests — the same discipline as the rest of this
 * repository, for the same reason, and `--log-requests` does not exist.
 */
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const PORT = Number.parseInt(flag("port", "4700"), 10);
const CIRCUIT_DIR = resolve(flag("circuit", "./circuit"));
const SYSTEM = flag("system", "plonk") as "plonk" | "groth16";

/** Largest request body accepted, before anything is parsed. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * The circuit artefacts this prover was pointed at.
 *
 * A prover is useless without them and they are not in this repository: the
 * proving key for the pinned circuit is roughly 3 GB under PLONK, or 0.55 GB
 * under Groth16, and both are build outputs rather than source. `npm run
 * prover:fetch` gets them; docs/PROVER-PROTOCOL.md says where from and how to
 * check what you got.
 */
interface Artefacts {
  wasm: string;
  zkey: string;
  /** SHA-256 of the verification key, to compare against the platform's. */
  verificationKeyHash: string;
}

function loadArtefacts(): Artefacts | null {
  const wasm = join(CIRCUIT_DIR, "circuit.wasm");
  const zkey = join(CIRCUIT_DIR, "circuit.zkey");
  const vk = join(CIRCUIT_DIR, "verification_key.json");
  if (!existsSync(wasm) || !existsSync(zkey) || !existsSync(vk)) return null;

  return {
    wasm,
    zkey,
    verificationKeyHash: createHash("sha256")
      .update(readFileSync(vk))
      .digest("hex"),
  };
}

const artefacts = loadArtefacts();

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-max-age": "600",
};

const server = createServer(async (request, response) => {
  const send = (status: number, body: unknown) => {
    const payload = JSON.stringify(body);
    response.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
      "cache-control": "no-store",
      ...CORS,
    });
    response.end(payload);
  };

  if (request.method === "OPTIONS") {
    response.writeHead(204, CORS);
    return response.end();
  }

  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);

  /**
   * What this prover is and what it can prove.
   *
   * A user's client fetches this before sending anything, and compares
   * `circuit` and `verificationKeyHash` against what the platform publishes.
   * If they differ, this prover cannot produce a proof the platform will
   * accept, and the client says so rather than sending a JWT to find out.
   */
  if (url.pathname === "/prover" && request.method === "GET") {
    return send(200, {
      protocol: "cephroom-prover/1",
      system: SYSTEM,
      circuit: "jwt-tx-validation@27cda6e",
      verificationKeyHash: artefacts?.verificationKeyHash ?? null,
      ready: artefacts !== null,
      // No name, no operator field, no contact. A prover is chosen by its URL
      // and judged by whether its artefacts match; anything else here would be
      // marketing, and marketing is how a default emerges.
      notice:
        "This prover sees the JWT you send it. Run your own if you would rather nobody did.",
    });
  }

  if (url.pathname === "/prove" && request.method === "POST") {
    if (!artefacts) {
      return send(503, {
        error:
          "No circuit artefacts. Point --circuit at a directory holding circuit.wasm, circuit.zkey and verification_key.json.",
      });
    }

    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    for await (const chunk of request) {
      total += (chunk as Buffer).length;
      if (total > MAX_BODY_BYTES) {
        aborted = true;
        break;
      }
      chunks.push(chunk as Buffer);
    }
    if (aborted) return send(413, { error: "Request too large." });

    let body: { jwt?: unknown; challenge?: unknown; salt?: unknown };
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return send(400, { error: "Body must be JSON." });
    }

    if (
      typeof body.jwt !== "string" ||
      typeof body.challenge !== "string" ||
      typeof body.salt !== "string"
    ) {
      return send(400, { error: "Send jwt, challenge and salt." });
    }

    try {
      const { proveJwt } = await import("./prover-witness");
      const result = await proveJwt({
        jwt: body.jwt,
        challenge: body.challenge,
        salt: body.salt,
        system: SYSTEM,
        wasm: artefacts.wasm,
        zkey: artefacts.zkey,
      });
      return send(200, result);
    } catch (error) {
      // The message, never the input. An error that echoed the JWT back would
      // put it somewhere it could be captured — a log aggregator, a proxy, a
      // browser console — which is exactly what this process promises not to
      // do with it.
      return send(400, {
        error: error instanceof Error ? error.message : "Could not prove.",
      });
    }
  }

  send(404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `prover node on http://127.0.0.1:${PORT} — system ${SYSTEM}, circuit ${CIRCUIT_DIR}`,
  );
  if (!artefacts) {
    console.log(
      "no circuit artefacts found; /prove will answer 503 until --circuit points at some",
    );
  } else {
    console.log(`verification key sha256 ${artefacts.verificationKeyHash}`);
  }
  console.log(
    "this process holds each JWT for one request and writes nothing to disk",
  );
});
