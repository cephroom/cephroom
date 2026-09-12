import { generateKeyPairSync, randomBytes } from "node:crypto";

import { decodeJwt } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * A key states a tier. It says nothing else about a person.
 *
 * Contract 1 lists what the platform does not hold — "no user table, profile,
 * email, display name, avatar, session store, preferences, or activity
 * record" — and then: **sign-in proves identity and is immediately
 * forgotten.** Two things were being carried forward instead of forgotten,
 * and both had reasons that sounded fine at the time.
 *
 * **The Google display name.** Stamped into the access key at sign-in, copied
 * into every refresh for seven days, and — the part that matters — stamped
 * into the short-lived `mintNodeKey` that a reader's browser presents to a
 * contributor's node. So reading a column handed a stranger your real name.
 * Worse, proposing an edit wrote it to their disk as `fromName`, permanently,
 * with no expiry and no way to remove it. An anonymous reading token exists
 * precisely so a contributor cannot learn who is reading; presenting the name
 * on every ordinary read made that a feature you had to opt into rather than
 * a property of the system. "It is only a display name" is exactly the
 * argument Contract 1 names and refuses.
 *
 * **The Stripe customer id.** A convenience: holding it saved a lookup on the
 * billing pages. But the contract says the platform does not mirror Stripe's
 * records "not in a table, not in a cache, not in a file", and a credential
 * is a fourth place — a cache keyed by identity, which is the one shape
 * AGENTS.md singles out. It is re-derivable from the subject through
 * `findCustomerBySubject`, and the contract has already accepted that cost:
 * "a Stripe API call per renewal per active reader... the price of not
 * holding the data."
 *
 * The assertions below are exhaustive rather than illustrative. A key's claim
 * set is the platform's entire surface for leaking a person, so it is pinned
 * exactly: adding any field fails here, and has to be argued for in this file.
 */

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

/** Claims every key carries because it is a JWT at all. */
const STRUCTURAL = ["aud", "exp", "iat", "iss"];

describe("every key's claim set is pinned exactly", () => {
  it("gives the access key a subject, a tier and its scopes — nothing more", async () => {
    const claims = decodeJwt(
      await tokens.mintAccessKey({ sub: "s_reader", tier: "member" }),
    );
    expect(Object.keys(claims).sort()).toEqual(
      [...STRUCTURAL, "scp", "sub", "tier"].sort(),
    );
  });

  it("gives the refresh key a subject and nothing else", async () => {
    // It lives seven days and cannot be revoked, so it is the worst possible
    // place to keep anything descriptive.
    const claims = decodeJwt(await tokens.mintRefreshKey({ sub: "s_reader" }));
    expect(Object.keys(claims).sort()).toEqual([...STRUCTURAL, "sub"].sort());
  });

  it("gives the node key nothing a contributor could identify a reader by", async () => {
    // This one is presented to a stranger's machine on every read. It proves
    // a tier. That is the entire job.
    const claims = decodeJwt(
      await tokens.mintNodeKey({ sub: "s_reader", tier: "lab" }),
    );
    expect(Object.keys(claims).sort()).toEqual(
      [...STRUCTURAL, "scp", "sub", "tier"].sort(),
    );
  });

  it("gives the serve key a subject and the announce scope", async () => {
    const claims = decodeJwt(
      await tokens.mintServeKey({ sub: "s_pub", tier: "member" }),
    );
    expect(Object.keys(claims).sort()).toEqual(
      [...STRUCTURAL, "scp", "sub", "tier"].sort(),
    );
  });

  it("gives the anonymous key no subject at all", async () => {
    const claims = decodeJwt(await tokens.mintAnonymousKey({ tier: "member" }));
    expect(Object.keys(claims).sort()).toEqual(
      [...STRUCTURAL, "anon", "scp", "tier"].sort(),
    );
    expect(claims.sub).toBeUndefined();
  });
});

describe("no key can be made to carry a name or a customer id", () => {
  it("has no parameter for either, on any mint", async () => {
    // Not "we stopped passing it" — there is nowhere to pass it. A parameter
    // that exists gets used by the next caller who finds it convenient.
    const mints = [
      tokens.mintAccessKey,
      tokens.mintRefreshKey,
      tokens.mintNodeKey,
      tokens.mintServeKey,
      tokens.mintAnonymousKey,
    ];
    for (const mint of mints) {
      const source = mint.toString();
      expect(source, `${mint.name} still mentions a name`).not.toMatch(/\bname\b/);
      expect(source, `${mint.name} still mentions a customer`).not.toMatch(
        /\bcus\b|customerId/,
      );
    }
  });

  it("ignores a name or customer smuggled into a mint call", async () => {
    // Belt and braces: even called with extra properties, nothing lands in
    // the token. TypeScript rejects this; a JavaScript caller would not.
    const key = await tokens.mintAccessKey({
      sub: "s_reader",
      tier: "member",
      name: "Rosalind Hale",
      cus: "cus_12345",
    } as Parameters<typeof tokens.mintAccessKey>[0]);

    const claims = decodeJwt(key);
    expect(JSON.stringify(claims)).not.toContain("Rosalind");
    expect(JSON.stringify(claims)).not.toContain("cus_12345");
  });

  it("drops both when verifying, so nothing downstream can read them", async () => {
    const verified = await tokens.verifyAccessKey(
      await tokens.mintAccessKey({ sub: "s_reader", tier: "member" }),
    );
    expect(verified).not.toHaveProperty("name");
    expect(verified).not.toHaveProperty("cus");

    const serve = await tokens.verifyServeKey(
      await tokens.mintServeKey({ sub: "s_pub", tier: "member" }),
    );
    expect(Object.keys(serve!)).toEqual(["sub"]);

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
    expect(Object.keys(session.ANONYMOUS).sort()).toEqual(
      ["expiresIn", "key", "sub", "tier"].sort(),
    );
  });
});
