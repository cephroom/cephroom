import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly } from "./scan";


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
    expect(verified!.scp).not.toContain("write:propose");
    expect(verified!.scp).toEqual([]);
  });

  it("carries no name, no customer, and nothing else besides", async () => {
    const { mintAnonymousKey } = await import("@/lib/keys/tokens");
    const { decodeJwt } = await import("jose");

    const payload = decodeJwt(await mintAnonymousKey({ discovery: "query" }));
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
    const redeem = wallet.slice(wallet.indexOf("export async function spendToken"));
    expect(redeem).toContain('credentials: "omit"');
  });

  it("sends only the token, and nothing about the wallet it came from", () => {
    const redeem = wallet.slice(wallet.indexOf("export async function spendToken"));
    const body = redeem
      .split("\n")
      .find((line) => line.trimStart().startsWith("body:"));
    expect(body, "spendToken sends no request body").toBeDefined();
    expect(body).toContain("JSON.stringify({ token })");
    expect(body).not.toMatch(/\bepoch\b|\btier\b|\bcount\b/);
  });

  it("keeps the wallet in the reader's browser and nowhere else", () => {
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
    expect(guard).toBeGreaterThan(spend);
    expect(guard).toBeLessThan(mint);
  });

  it("refuses the replay rather than reporting why it failed", () => {
    const refusals = route.match(/error:\s*"[^"]+"/g) ?? [];
    expect(new Set(refusals).size).toBe(1);
  });

  it("mints against the plan the token proves, never one the caller asked for", () => {
    const mintCall = route.slice(route.indexOf("mintAnonymousKey"));
    expect(mintCall).toContain("tier: result.tier");
    expect(route).not.toMatch(/body\??\.tier/);
  });
});
