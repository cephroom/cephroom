import { generateKeyPairSync, randomBytes } from "node:crypto";

import { decodeJwt } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Two contributors must not be able to compare notes about a reader.
 *
 * Found by running the platform at a realistic shape for the first time: two
 * contributors serving simultaneously, five readers on three tiers pulling
 * from both. One-to-one role-play cannot surface this, because the property
 * that fails is a *comparison between parties* and there was only ever one
 * party of each kind.
 *
 * Every node received the same `sub` for a given reader:
 *
 *   C1 -> node A  sub=s_ZPyZePpz9YZPWzHOkU68u4MoqbW
 *   C1 -> node B  sub=s_ZPyZePpz9YZPWzHOkU68u4MoqbW
 *
 * A subject is stable and unforgeable, which is exactly what makes it useful
 * for attribution and exactly what makes a *global* one dangerous. Contract 1
 * says the platform holds no activity record. It did not hold one — it handed
 * every contributor the join key for building one, and two contributors who
 * compare logs reconstruct a reader's history across the whole network. The
 * record exists; it is simply not stored here, which is the distinction
 * Contract 1 explicitly refuses to accept ("an argument that something is
 * technically not at rest is itself the signal a contract is about to break").
 *
 * It leaked reader-to-reader as well: a node's `/proposals` list carries each
 * proposer's subject, so any member reading proposals on one node collected
 * global identifiers for members they had never met.
 *
 * The fix is a pairwise pseudonym — the subject a node sees is derived from
 * (reader, contributor), so it is stable for that pairing and meaningless to
 * anyone else. A contributor keeps everything they legitimately need: telling
 * their readers apart, recognising a returning one, attributing a proposal,
 * enforcing a per-person flood limit. They lose only the ability to join
 * their records to somebody else's.
 */

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
    // And neither is the reader's real subject, which must never leave the
    // platform — it is the join key for everything.
    expect(atA.sub).not.toBe(READER);
    expect(atB.sub).not.toBe(READER);
  });

  it("gives the same contributor the same subject every time", async () => {
    // A contributor has to be able to recognise a returning reader: it is how
    // a proposal is attributed and how the per-person flood limit works.
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
    // The pairing is the whole identifier. Neither half alone determines it,
    // so neither half can be recovered from it.
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
    // Different prefix, so a node-scoped id appearing where a platform
    // subject belongs is visible rather than merely wrong.
    const scoped = decodeJwt(
      await tokens.mintNodeKey({ sub: READER, audience: NODE_A, sessionSecondsLeft: 900 }),
    );
    expect(String(scoped.sub).startsWith("n_")).toBe(true);
    expect(tokens.deriveSubject("google", "123").startsWith("s_")).toBe(true);
  });

  it("reveals nothing about the reader that a dictionary attack could unwind", async () => {
    // Derived under the server secret, so holding a node-scoped subject and
    // guessing candidate reader subjects gets you nowhere without it.
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
    // Without this the pairwise subject buys nothing: node B accepts node A's
    // key, reads the subject A would have seen, and the two can join on it
    // again. The binding is what makes the scoping real.
    const forA = await tokens.mintNodeKey({
      sub: READER,
      audience: NODE_A,
      sessionSecondsLeft: 900,
    });

    expect(await tokens.verifyAccessKey(forA, { audience: NODE_A })).not.toBeNull();
    expect(await tokens.verifyAccessKey(forA, { audience: NODE_B })).toBeNull();
  });

  it("still accepts an anonymous key at any node", async () => {
    // An anonymous key has no subject to scope and is the strongest privacy
    // position available. It must not be collateral damage.
    const anon = await tokens.mintAnonymousKey({ discovery: "query" });
    expect(await tokens.verifyAccessKey(anon, { audience: NODE_A })).not.toBeNull();
    expect(await tokens.verifyAccessKey(anon, { audience: NODE_B })).not.toBeNull();
  });

  it("still accepts a session key where no contributor is named", async () => {
    // The platform's own pages verify the reader's session key, and there is
    // no contributor in that conversation.
    const session = await tokens.mintAccessKey({ sub: READER, discovery: "query" });
    expect(await tokens.verifyAccessKey(session)).not.toBeNull();
  });

  it("refuses a contributor-bound key where a plain session key is required", async () => {
    // The reverse direction. A node-bound key turning up as a session cookie
    // would mean a node could replay a reader's key against the platform.
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
