import { generateKeyPairSync, randomBytes } from "node:crypto";

import { decodeJwt } from "jose";
import { beforeAll, describe, expect, it } from "vitest";


const platform = generateKeyPairSync("ed25519");
const b64 = (pem: string) => Buffer.from(pem).toString("base64");

let tokens: typeof import("@/lib/keys/tokens");

const READER = "s_reader_one";
const OTHER_READER = "s_reader_two";
const NODE_A = "s_nodeA_marcus";
const NODE_B = "s_nodeB_ines";

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

describe("the subject a contributor sees is scoped to that contributor", () => {
  it("gives two contributors different subjects for the same reader", async () => {
    const atA = decodeJwt(
      await tokens.mintNodeKey({ sub: READER, audience: NODE_A, sessionSecondsLeft: 900 }),
    );
    const atB = decodeJwt(
      await tokens.mintNodeKey({ sub: READER, audience: NODE_B, sessionSecondsLeft: 900 }),
    );

    expect(atA.sub).not.toBe(atB.sub);
    expect(atA.sub).not.toBe(READER);
    expect(atB.sub).not.toBe(READER);
  });

  it("gives the same contributor the same subject every time", async () => {
    const first = decodeJwt(
      await tokens.mintNodeKey({ sub: READER, audience: NODE_A, sessionSecondsLeft: 900 }),
    );
    const second = decodeJwt(
      await tokens.mintNodeKey({ sub: READER, audience: NODE_A, sessionSecondsLeft: 900 }),
    );
    expect(first.sub).toBe(second.sub);
  });

  it("keeps two readers distinct at the same contributor", async () => {
    const one = decodeJwt(
      await tokens.mintNodeKey({ sub: READER, audience: NODE_A, sessionSecondsLeft: 900 }),
    );
    const two = decodeJwt(
      await tokens.mintNodeKey({ sub: OTHER_READER, audience: NODE_A, sessionSecondsLeft: 900 }),
    );
    expect(one.sub).not.toBe(two.sub);
  });

  it("does not survive a change of reader or of contributor", async () => {
    const base = decodeJwt(
      await tokens.mintNodeKey({ sub: READER, audience: NODE_A, sessionSecondsLeft: 900 }),
    )!.sub;

    const others = await Promise.all([
      tokens.mintNodeKey({ sub: OTHER_READER, audience: NODE_A, sessionSecondsLeft: 900 }),
      tokens.mintNodeKey({ sub: READER, audience: NODE_B, sessionSecondsLeft: 900 }),
      tokens.mintNodeKey({ sub: OTHER_READER, audience: NODE_B, sessionSecondsLeft: 900 }),
    ]);
    for (const key of others) expect(decodeJwt(key).sub).not.toBe(base);
  });

  it("marks a node-scoped subject as one, so it cannot be mistaken for the real one", async () => {
    const scoped = decodeJwt(
      await tokens.mintNodeKey({ sub: READER, audience: NODE_A, sessionSecondsLeft: 900 }),
    );
    expect(String(scoped.sub).startsWith("n_")).toBe(true);
    expect(tokens.deriveSubject("google", "123").startsWith("s_")).toBe(true);
  });

  it("reveals nothing about the reader that a dictionary attack could unwind", async () => {
    const scoped = tokens.nodeScopedSubject(READER, NODE_A);
    process.env.AUTH_SUBJECT_SECRET = randomBytes(32).toString("hex");
    expect(tokens.nodeScopedSubject(READER, NODE_A)).not.toBe(scoped);
  });
});

describe("a key issued for one contributor cannot be presented to another", () => {
  it("names the contributor it was minted for", async () => {
    const key = decodeJwt(
      await tokens.mintNodeKey({ sub: READER, audience: NODE_A, sessionSecondsLeft: 900 }),
    );
    expect(key.nod).toBe(NODE_A);
  });

  it("is refused by a node it was not minted for", async () => {
    const forA = await tokens.mintNodeKey({
      sub: READER,
      audience: NODE_A,
      sessionSecondsLeft: 900,
    });

    expect(await tokens.verifyAccessKey(forA, { audience: NODE_A })).not.toBeNull();
    expect(await tokens.verifyAccessKey(forA, { audience: NODE_B })).toBeNull();
  });

  it("still accepts an anonymous key at any node", async () => {
    const anon = await tokens.mintAnonymousKey({ discovery: "query" });
    expect(await tokens.verifyAccessKey(anon, { audience: NODE_A })).not.toBeNull();
    expect(await tokens.verifyAccessKey(anon, { audience: NODE_B })).not.toBeNull();
  });

  it("still accepts a session key where no contributor is named", async () => {
    const session = await tokens.mintAccessKey({ sub: READER, discovery: "query" });
    expect(await tokens.verifyAccessKey(session)).not.toBeNull();
  });

  it("refuses a contributor-bound key where a plain session key is required", async () => {
    const forA = await tokens.mintNodeKey({
      sub: READER,
      audience: NODE_A,
      sessionSecondsLeft: 900,
    });
    expect(await tokens.verifyAccessKey(forA)).toBeNull();
  });
});

describe("the claim set stays exactly as small as it was", () => {
  it("adds the contributor binding and nothing else", async () => {
    const claims = decodeJwt(
      await tokens.mintNodeKey({ sub: READER, audience: NODE_A, sessionSecondsLeft: 900 }),
    );
    expect(Object.keys(claims).sort()).toEqual(
      ["aud", "exp", "iat", "iss", "nod", "scp", "sub"].sort(),
    );
  });
});
