import { generateKeyPairSync, randomBytes } from "node:crypto";

import { SignJWT, importPKCS8 } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Contract 1 says authorization is signature verification, not a lookup. That
 * is only sound if a forged, tampered, expired, or wrong-audience key is
 * rejected. These exercise the real verifier against exactly those.
 *
 * A fresh Ed25519 pair is generated and injected as the platform's keys
 * before the token module is imported, so the test signs with the same key
 * the verifier trusts — and an attacker's separately-generated key stands in
 * for a forgery.
 */

const b64 = (pem: string) => Buffer.from(pem).toString("base64");

const platform = generateKeyPairSync("ed25519");
const attacker = generateKeyPairSync("ed25519");

let tokens: typeof import("@/lib/keys/tokens");

beforeAll(async () => {
  process.env.RECEPTOROME_SIGNING_KEY = b64(
    platform.privateKey.export({ type: "pkcs8", format: "pem" }) as string,
  );
  process.env.RECEPTOROME_PUBLIC_KEY = b64(
    platform.publicKey.export({ type: "spki", format: "pem" }) as string,
  );
  process.env.AUTH_SUBJECT_SECRET = randomBytes(32).toString("hex");
  tokens = await import("@/lib/keys/tokens");
});

describe("a genuine key round-trips", () => {
  it("verifies a freshly minted access key", async () => {
    const token = await tokens.mintAccessKey({
      sub: "s_reader",
      tier: "member",
      cus: "cus_1",
      name: "Reader",
    });
    const key = await tokens.verifyAccessKey(token);
    expect(key?.sub).toBe("s_reader");
    expect(key?.tier).toBe("member");
    expect(key?.scp).toContain("read:member");
  });
});

describe("forgery and tampering are rejected", () => {
  it("rejects a key whose payload was edited after signing", async () => {
    const token = await tokens.mintAccessKey({ sub: "s_reader", tier: "reader" });
    const [header, payload, signature] = token.split(".");

    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    decoded.tier = "lab"; // the escalation an attacker would want
    const tampered = [
      header,
      Buffer.from(JSON.stringify(decoded)).toString("base64url"),
      signature, // stale signature, no longer matches the payload
    ].join(".");

    expect(await tokens.verifyAccessKey(tampered)).toBeNull();
  });

  it("rejects a key signed by someone else's private key", async () => {
    const forged = await new SignJWT({ tier: "lab", scp: ["read:lab"] })
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
    // header {"alg":"none"}, a lab-tier payload, empty signature.
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url",
    );
    const payload = Buffer.from(
      JSON.stringify({
        sub: "s_attacker",
        tier: "lab",
        scp: ["read:lab"],
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
    const expired = await new SignJWT({ tier: "member", scp: ["read:member"] })
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
    // Different audiences: a long-lived refresh key must not be presentable
    // as an access key, or the 15-minute access window would be meaningless.
    const refresh = await tokens.mintRefreshKey({ sub: "s_reader" });
    expect(await tokens.verifyAccessKey(refresh)).toBeNull();
    expect(await tokens.verifyRefreshKey(refresh)).not.toBeNull();
  });

  it("does not accept an access key where a refresh key is required", async () => {
    const access = await tokens.mintAccessKey({ sub: "s_reader", tier: "reader" });
    expect(await tokens.verifyRefreshKey(access)).toBeNull();
  });
});

describe("the node key is an access-audience key, and nothing more", () => {
  it("verifies and carries the tier's scopes", async () => {
    const nodeKey = await tokens.mintNodeKey({ sub: "s_lab", tier: "lab" });
    const key = await tokens.verifyAccessKey(nodeKey);
    expect(key?.sub).toBe("s_lab");
    expect(key?.scp).toContain("serve:node");
  });
});
