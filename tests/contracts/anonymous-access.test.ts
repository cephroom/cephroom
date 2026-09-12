import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly } from "./scan";

/**
 * Layer 1, at the point where it stops being cryptography and starts being
 * three lines of wiring.
 *
 * `unlinkability.test.ts` proves the hard part: the issuer cannot recognise a
 * token it signed. But a blind signature scheme wired to a key that still
 * carries a subject severs nothing, and the assertions stopped at the library
 * boundary. Three things on the request path had no test at all:
 *
 *   1. `mintAnonymousKey` — the only mint in the codebase with no
 *      `.setSubject()`. It is the thing that actually makes the reader
 *      anonymous to the node, and it was covered by nothing.
 *   2. The redemption route spending the nullifier *before* minting, so a
 *      replayed token buys nothing.
 *   3. `credentials: "omit"` on the redemption request, which is what keeps
 *      the session cookie off the one request that must not carry it. A
 *      default `fetch` would attach it — same-site — and hand the platform
 *      exactly the link the whole design exists to remove.
 *
 * Each is one edit away from silently undoing Layer 1, and none of them would
 * fail a test or look wrong in review.
 */

beforeAll(async () => {
  const { generateKeyPair, exportPKCS8, exportSPKI } = await import("jose");
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    extractable: true,
  });
  process.env.CEPHROOM_SIGNING_KEY = Buffer.from(
    await exportPKCS8(privateKey),
  ).toString("base64");
  process.env.CEPHROOM_PUBLIC_KEY = Buffer.from(
    await exportSPKI(publicKey),
  ).toString("base64");
  process.env.AUTH_SUBJECT_SECRET ??= "anonymous-access-test-secret";
});

describe("the anonymous key carries a discovery plan and no person", () => {
  it("has no subject claim at all", async () => {
    const { mintAnonymousKey } = await import("@/lib/keys/tokens");
    const { decodeJwt } = await import("jose");

    const key = await mintAnonymousKey({ discovery: "query" });
    const payload = decodeJwt(key);

    // Not "a subject that looks anonymous" — no `sub` claim in the token.
    // Anything else leaves a stable handle for a node to cluster on.
    expect(payload.sub).toBeUndefined();
    expect(Object.keys(payload)).not.toContain("sub");
    expect(payload.anon).toBe(true);
  });

  it("verifies, and yields a null subject rather than being rejected", async () => {
    const { mintAnonymousKey, verifyAccessKey } = await import("@/lib/keys/tokens");

    const verified = await verifyAccessKey(await mintAnonymousKey({ discovery: "query" }));
    expect(verified).not.toBeNull();
    expect(verified!.sub).toBeNull();
    expect(verified!.discovery).toBe("query");
  });

  it("cannot propose, because a proposal has to be attributable", async () => {
    const { mintAnonymousKey, verifyAccessKey } = await import("@/lib/keys/tokens");

    const verified = await verifyAccessKey(
      await mintAnonymousKey({ discovery: "query" }),
    );
    // Search anonymously; sign what you write. An anonymous proposal would
    // land on a contributor's disk with nobody attached to it.
    expect(verified!.scp).not.toContain("write:propose");
    expect(verified!.scp).toEqual([]);
  });

  it("carries no name, no customer, and nothing else besides", async () => {
    const { mintAnonymousKey } = await import("@/lib/keys/tokens");
    const { decodeJwt } = await import("jose");

    const payload = decodeJwt(await mintAnonymousKey({ discovery: "query" }));
    // Asserted exhaustively: a field added here is a field a node can use to
    // tell two anonymous reads apart, which is the whole property.
    expect(Object.keys(payload).sort()).toEqual([
      "anon",
      "aud",
      "discovery",
      "exp",
      "iat",
      "iss",
      "scp",
    ]);
  });

  it("expires in minutes, not the session's fifteen", async () => {
    const { mintAnonymousKey, NODE_KEY_TTL_SECONDS, ACCESS_TTL_SECONDS } =
      await import("@/lib/keys/tokens");
    const { decodeJwt } = await import("jose");

    const payload = decodeJwt(await mintAnonymousKey({ discovery: "query" }));
    const life = payload.exp! - payload.iat!;
    expect(life).toBe(NODE_KEY_TTL_SECONDS);
    expect(life).toBeLessThan(ACCESS_TTL_SECONDS);
  });

  it("is rejected if it claims neither a subject nor anonymity", async () => {
    // A key with no `sub` and no `anon` marker is malformed, not anonymous.
    // Accepting it would mean a truncated or hand-built token silently became
    // a valid anonymous reader.
    const { SignJWT } = await import("jose");
    const tokens = await import("@/lib/keys/tokens");
    const { importPKCS8 } = await import("jose");

    const pem = Buffer.from(
      process.env.CEPHROOM_SIGNING_KEY!,
      "base64",
    ).toString("utf8");

    const neither = await new SignJWT({ discovery: "sweep", scp: [] })
      .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
      .setIssuer(tokens.ISSUER)
      .setAudience(tokens.ACCESS_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(await importPKCS8(pem, "EdDSA"));

    expect(await tokens.verifyAccessKey(neither)).toBeNull();
  });
});

describe("the redemption request carries nothing that identifies the reader", () => {
  const wallet = stripCommentsOnly(
    readFileSync(join(ROOT, "src", "lib", "tokens", "wallet.ts"), "utf8"),
  );

  it("omits credentials when redeeming", () => {
    // `omit`, not the default. The cookie would be sent same-site otherwise,
    // and the endpoint ignoring it is not the same as it not arriving — an
    // access log, a proxy, or a future edit all see what was sent.
    const redeem = wallet.slice(wallet.indexOf("export async function spendToken"));
    expect(redeem).toContain('credentials: "omit"');
  });

  it("sends only the token, and nothing about the wallet it came from", () => {
    const redeem = wallet.slice(wallet.indexOf("export async function spendToken"));
    const body = redeem
      .split("\n")
      .find((line) => line.trimStart().startsWith("body:"));
    // Not the epoch, not the plan, not how many are left — each would narrow
    // the anonymity set for no gain, since the token already proves all of it.
    expect(body, "spendToken sends no request body").toBeDefined();
    expect(body).toContain("JSON.stringify({ token })");
    expect(body).not.toMatch(/\bepoch\b|\btier\b|\bcount\b/);
  });

  it("keeps the wallet in the reader's browser and nowhere else", () => {
    // History lives in the client. If this ever round-trips to the platform,
    // the platform is holding a list of what somebody has left to read.
    expect(wallet).toContain("window.localStorage");
    expect(wallet).not.toMatch(/\/api\/tokens\/wallet|saveWallet|syncWallet/);
  });
});

describe("a redeemed token cannot be redeemed again", () => {
  const route = stripCommentsOnly(
    readFileSync(
      join(ROOT, "src", "app", "api", "tokens", "redeem", "route.ts"),
      "utf8",
    ),
  );

  it("spends the nullifier before minting the key", () => {
    // Ordering, asserted positionally within the handler — measuring from the
    // top of the file would compare against the import, which always sorts
    // first and would make this pass no matter what the handler does.
    //
    // Minting first and spending afterwards still "works" in every test that
    // redeems a token once, and hands out a free key per replay under any
    // concurrency at all.
    const handler = route.slice(route.indexOf("export async function POST"));
    const spend = handler.indexOf("spend(");
    const mint = handler.indexOf("mintAnonymousKey");
    expect(spend, "the handler never spends the nullifier").toBeGreaterThan(-1);
    expect(mint, "the handler never mints a key").toBeGreaterThan(-1);
    expect(spend).toBeLessThan(mint);
  });

  it("refuses when the spend is not fresh, rather than carrying on", () => {
    const handler = route.slice(route.indexOf("export async function POST"));
    const spend = handler.indexOf("spend(");
    const guard = handler.indexOf("fresh", spend);
    const mint = handler.indexOf("mintAnonymousKey");
    // The spend has to be *checked*, not merely performed. Recording a
    // nullifier and ignoring the answer is the same as not recording it.
    expect(guard).toBeGreaterThan(spend);
    expect(guard).toBeLessThan(mint);
  });

  it("refuses the replay rather than reporting why it failed", () => {
    // One message for every failure mode. "Already spent" versus "bad
    // signature" is an oracle, and a cheap one to avoid offering.
    const refusals = route.match(/error:\s*"[^"]+"/g) ?? [];
    expect(new Set(refusals).size).toBe(1);
  });

  it("mints against the plan the token proves, never one the caller asked for", () => {
    // The request body is a token and nothing else; the tier comes from which
    // key verified it. A tier taken from the body would let a member ask for
    // lab access with a valid member token.
    const mintCall = route.slice(route.indexOf("mintAnonymousKey"));
    expect(mintCall).toContain("tier: result.tier");
    expect(route).not.toMatch(/body\??\.tier/);
  });
});
