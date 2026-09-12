import { generateKeyPairSync, randomBytes } from "node:crypto";

import { SignJWT, importPKCS8 } from "jose";
import { beforeAll, describe, expect, it } from "vitest";


const b64 = (pem: string) => Buffer.from(pem).toString("base64");

const platform = generateKeyPairSync("ed25519");
const attacker = generateKeyPairSync("ed25519");

let tokens: typeof import("@/lib/keys/tokens");

beforeAll(async () => {
  process.env.CEPHROOM_SIGNING_KEY = b64(
    platform.privateKey.export({ type: "pkcs8", format: "pem" }) as string,
  );
  process.env.CEPHROOM_PUBLIC_KEY = b64(
    platform.publicKey.export({ type: "spki", format: "pem" }) as string,
  );
  process.env.AUTH_SUBJECT_SECRET = randomBytes(32).toString("hex");
  tokens = await import("@/lib/keys/tokens");
});

describe("a genuine key round-trips", () => {
  it("verifies a freshly minted access key", async () => {
    const token = await tokens.mintAccessKey({ sub: "s_reader", discovery: "query" });
    const key = await tokens.verifyAccessKey(token);
    expect(key?.sub).toBe("s_reader");
    expect(key?.discovery).toBe("query");
    expect(key?.scp).toContain("write:propose");
  });
});

describe("forgery and tampering are rejected", () => {
  it("rejects a key whose payload was edited after signing", async () => {
    const token = await tokens.mintAccessKey({ sub: "s_reader", discovery: "query" });
    const [header, payload, signature] = token.split(".");

    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    decoded.discovery = "sweep";
    const tampered = [
      header,
      Buffer.from(JSON.stringify(decoded)).toString("base64url"),
      signature, // stale signature, no longer matches the payload
    ].join(".");

    expect(await tokens.verifyAccessKey(tampered)).toBeNull();
  });

  it("rejects a key signed by someone else's private key", async () => {
    const forged = await new SignJWT({ discovery: "sweep", scp: [] })
      .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
      .setIssuer(tokens.ISSUER)
      .setAudience(tokens.ACCESS_AUDIENCE)
      .setSubject("s_attacker")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(
        await importPKCS8(
          attacker.privateKey.export({ type: "pkcs8", format: "pem" }) as string,
          "EdDSA",
        ),
      );

    expect(await tokens.verifyAccessKey(forged)).toBeNull();
  });

  it("rejects the alg:none downgrade", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url",
    );
    const payload = Buffer.from(
      JSON.stringify({
        sub: "s_attacker",
        discovery: "sweep",
        scp: [],
        iss: tokens.ISSUER,
        aud: tokens.ACCESS_AUDIENCE,
        exp: Math.floor(Date.now() / 1000) + 900,
      }),
    ).toString("base64url");

    expect(await tokens.verifyAccessKey(`${header}.${payload}.`)).toBeNull();
  });

  it("rejects garbage", async () => {
    expect(await tokens.verifyAccessKey("not.a.jwt")).toBeNull();
    expect(await tokens.verifyAccessKey("")).toBeNull();
  });
});

describe("expiry and audience are enforced", () => {
  it("rejects an expired access key", async () => {
    const expired = await new SignJWT({ discovery: "query", scp: [] })
      .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
      .setIssuer(tokens.ISSUER)
      .setAudience(tokens.ACCESS_AUDIENCE)
      .setSubject("s_reader")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(await importPKCS8(
        platform.privateKey.export({ type: "pkcs8", format: "pem" }) as string,
        "EdDSA",
      ));

    expect(await tokens.verifyAccessKey(expired)).toBeNull();
  });

  it("does not accept a refresh key where an access key is required", async () => {
    const refresh = await tokens.mintRefreshKey({ sub: "s_reader" });
    expect(await tokens.verifyAccessKey(refresh)).toBeNull();
    expect(await tokens.verifyRefreshKey(refresh)).not.toBeNull();
  });

  it("does not accept an access key where a refresh key is required", async () => {
    const access = await tokens.mintAccessKey({ sub: "s_reader", discovery: "query" });
    expect(await tokens.verifyRefreshKey(access)).toBeNull();
  });
});

describe("the node key is an access-audience key, and nothing more", () => {
  it("verifies and carries the tier's scopes", async () => {
    const nodeKey = await tokens.mintNodeKey({
      sub: "s_lab",
      audience: "s_contributor",
      sessionSecondsLeft: 900,
    });
    const key = await tokens.verifyAccessKey(nodeKey, {
      audience: "s_contributor",
    });
    expect(key?.sub).not.toBe("s_lab");
    expect(key?.sub?.startsWith("n_")).toBe(true);
    expect(key?.scp).toContain("write:propose");
    expect(key?.scp).not.toContain("serve:node");
  });

  it("issues a serve key that announces but grants NO read access", async () => {
    const serve = await tokens.mintServeKey({ sub: "s_pub" });

    expect(await tokens.verifyAccessKey(serve)).toBeNull();

    const announced = await tokens.verifyServeKey(serve);
    expect(announced?.sub).toBe("s_pub");
    expect(announced).not.toHaveProperty("tier");

    const access = await tokens.mintAccessKey({ sub: "s_pub", discovery: "query" });
    expect(await tokens.verifyServeKey(access)).toBeNull();
  });
});
