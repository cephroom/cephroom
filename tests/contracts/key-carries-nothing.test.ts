import { generateKeyPairSync, randomBytes } from "node:crypto";

import { decodeJwt } from "jose";
import { beforeAll, describe, expect, it } from "vitest";


const platform = generateKeyPairSync("ed25519");
const b64 = (pem: string) => Buffer.from(pem).toString("base64");

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

const STRUCTURAL = ["aud", "exp", "iat", "iss"];

describe("every key's claim set is pinned exactly", () => {
  it("gives the access key a subject, a discovery plan, its scopes and a self-declared actor", async () => {
    const claims = decodeJwt(
      await tokens.mintAccessKey({ sub: "s_reader", discovery: "query" }),
    );
    // `act` is the human/AI self-declaration - a category, not an identifier
    // (see @/lib/actor). It is added here deliberately, as a visible diff to
    // this pin, and it must never become anything a reader could be picked out
    // by. The assertion below fixes it to the two allowed words.
    expect(Object.keys(claims).sort()).toEqual(
      [...STRUCTURAL, "act", "discovery", "scp", "sub"].sort(),
    );
    expect(["human", "ai"]).toContain(claims.act);
  });

  it("gives the refresh key a subject and the self-declared actor, nothing else", async () => {
    const claims = decodeJwt(await tokens.mintRefreshKey({ sub: "s_reader" }));
    expect(Object.keys(claims).sort()).toEqual([...STRUCTURAL, "act", "sub"].sort());
    expect(["human", "ai"]).toContain(claims.act);
  });

  it("gives the node key nothing a contributor could identify a reader by", async () => {
    const claims = decodeJwt(
      await tokens.mintNodeKey({
        sub: "s_reader",
        audience: "s_contributor",
        sessionSecondsLeft: 900,
      }),
    );
    expect(Object.keys(claims).sort()).toEqual(
      [...STRUCTURAL, "nod", "scp", "sub"].sort(),
    );
    expect(claims).not.toHaveProperty("discovery");
    // The human/AI declaration stays on the platform side; a contributor's node
    // learns nothing new about a reader, not even a self-reported category.
    expect(claims).not.toHaveProperty("act");
    expect(JSON.stringify(claims)).not.toContain("s_reader");
  });

  it("gives the serve key a subject, the announce scope and a capacity", async () => {
    const claims = decodeJwt(await tokens.mintServeKey({ sub: "s_pub" }));
    expect(Object.keys(claims).sort()).toEqual(
      [...STRUCTURAL, "cap", "scp", "sub"].sort(),
    );
  });

  it("gives the anonymous key no subject at all", async () => {
    const claims = decodeJwt(await tokens.mintAnonymousKey({ discovery: "query" }));
    expect(Object.keys(claims).sort()).toEqual(
      [...STRUCTURAL, "anon", "discovery", "scp"].sort(),
    );
    expect(claims.sub).toBeUndefined();
    // An anonymous search token carries no actor either: human/AI would narrow
    // the crowd a spent token hides in, and the token is meant to carry nothing.
    expect(claims).not.toHaveProperty("act");
  });
});

describe("no key can be made to carry a name or a customer id", () => {
  it("has no parameter for either, on any mint", async () => {
    const mints = [
      tokens.mintAccessKey,
      tokens.mintRefreshKey,
      tokens.mintNodeKey,
      tokens.mintServeKey,
      tokens.mintAnonymousKey,
    ];
    for (const mint of mints) {
      const source = mint
        .toString()
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(source, `${mint.name} still mentions a name`).not.toMatch(/\bname\b/);
      expect(source, `${mint.name} still mentions a customer`).not.toMatch(
        /\bcus\b|customerId/,
      );
    }
  });

  it("ignores a name or customer smuggled into a mint call", async () => {
    const key = await tokens.mintAccessKey({
      sub: "s_reader",
      discovery: "query",
      name: "Rosalind Hale",
      cus: "cus_12345",
    } as Parameters<typeof tokens.mintAccessKey>[0]);

    const claims = decodeJwt(key);
    expect(JSON.stringify(claims)).not.toContain("Rosalind");
    expect(JSON.stringify(claims)).not.toContain("cus_12345");
  });

  it("drops both when verifying, so nothing downstream can read them", async () => {
    const verified = await tokens.verifyAccessKey(
      await tokens.mintAccessKey({ sub: "s_reader", discovery: "query" }),
    );
    expect(verified).not.toHaveProperty("name");
    expect(verified).not.toHaveProperty("cus");

    const serve = await tokens.verifyServeKey(
      await tokens.mintServeKey({ sub: "s_pub" }),
    );
    expect(Object.keys(serve!).sort()).toEqual(["capacity", "sub"]);

    const refresh = await tokens.verifyRefreshKey(
      await tokens.mintRefreshKey({ sub: "s_reader" }),
    );
    expect(refresh).not.toHaveProperty("name");
    expect(refresh).not.toHaveProperty("cus");
  });
});

describe("the viewer the platform reconstructs is equally thin", () => {
  it("exposes no name and no customer id", async () => {
    const session = await import("@/lib/auth/session");
    // `actor` is the human/AI self-declaration - a category, not a name or an
    // id (see @/lib/actor). Added deliberately; still nothing person-linkable.
    expect(Object.keys(session.ANONYMOUS).sort()).toEqual(
      ["actor", "discovery", "expiresIn", "key", "sub"].sort(),
    );
    expect(session.ANONYMOUS).not.toHaveProperty("name");
    expect(session.ANONYMOUS).not.toHaveProperty("cus");
  });
});
