import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { decodeJwt } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly } from "./scan";


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

describe("what a contributor learns about a reader", () => {
  it("receives exactly these fields, and no others", async () => {
    const claims = decodeJwt(
      await tokens.mintNodeKey({
        sub: "s_reader",
        audience: "s_nodeA_marcus",
        sessionSecondsLeft: 900,
      }),
    );
    expect(Object.keys(claims).sort()).toEqual(
      ["aud", "exp", "iat", "iss", "nod", "scp", "sub"].sort(),
    );
  });

  it("learns nothing whatever about what the reader has paid for", async () => {
    const claims = decodeJwt(
      await tokens.mintNodeKey({
        sub: "s_reader",
        audience: "s_nodeA_marcus",
        sessionSecondsLeft: 900,
      }),
    );

    expect(claims).not.toHaveProperty("tier");
    expect(claims).not.toHaveProperty("discovery");
    const present = Object.keys(claims);
    for (const absent of [
      "tier",
      "discovery",
      "price",
      "plan",
      "interval",
      "status",
      "cus",
      "customerId",
      "currentPeriodEnd",
      "cancelAtPeriodEnd",
      "trial",
      "email",
      "name",
    ]) {
      expect(present, `a node can see ${absent}`).not.toContain(absent);
    }
  });

  it("CAN tell its own readers apart, and CAN recognise a returning one", async () => {
    const first = decodeJwt(
      await tokens.mintNodeKey({ sub: "s_a", audience: "s_node", sessionSecondsLeft: 900 }),
    ).sub;
    const again = decodeJwt(
      await tokens.mintNodeKey({ sub: "s_a", audience: "s_node", sessionSecondsLeft: 900 }),
    ).sub;
    const other = decodeJwt(
      await tokens.mintNodeKey({ sub: "s_b", audience: "s_node", sessionSecondsLeft: 900 }),
    ).sub;

    expect(first).toBe(again);
    expect(first).not.toBe(other);
  });

  it("CANNOT compare notes with another contributor", async () => {
    const atA = decodeJwt(
      await tokens.mintNodeKey({ sub: "s_a", audience: "s_nodeA", sessionSecondsLeft: 900 }),
    ).sub;
    const atB = decodeJwt(
      await tokens.mintNodeKey({ sub: "s_a", audience: "s_nodeB", sessionSecondsLeft: 900 }),
    ).sub;
    expect(atA).not.toBe(atB);
  });

  it("CANNOT recover the platform subject from what it was given", async () => {
    const scoped = decodeJwt(
      await tokens.mintNodeKey({ sub: "s_a", audience: "s_node", sessionSecondsLeft: 900 }),
    ).sub;
    expect(scoped).not.toContain("s_a");
    expect(String(scoped).startsWith("n_")).toBe(true);
  });

  it("learns nothing at all when the reader spends an anonymous token", async () => {
    const claims = decodeJwt(await tokens.mintAnonymousKey({ discovery: "query" }));
    expect(claims.sub).toBeUndefined();
    expect(Object.keys(claims).sort()).toEqual(
      ["anon", "aud", "discovery", "exp", "iat", "iss", "scp"].sort(),
    );
  });

  it("says plainly that the connection itself reveals where a reader is", () => {
    const privacy = readFileSync(
      join(ROOT, "src", "app", "privacy", "page.tsx"),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(privacy).toMatch(/contributor sees your network address/i);
    expect(privacy).toMatch(/a VPN or Tor is the answer/i);
    expect(privacy).toMatch(/They do not see a name/i);
  });
});

describe("a hostile insider learns nothing an honest one does not", () => {
  it("gives two contributors nothing in common to join on", async () => {
    const readers = ["s_r1", "s_r2", "s_r3", "s_r4", "s_r5"];
    const atOne = new Set<string>();
    const atTwo = new Set<string>();
    for (const reader of readers) {
      atOne.add(tokens.nodeScopedSubject(reader, "s_nodeA"));
      atTwo.add(tokens.nodeScopedSubject(reader, "s_nodeE"));
    }
    expect(atOne.size).toBe(readers.length);
    expect(atTwo.size).toBe(readers.length);
    expect([...atOne].filter((v) => atTwo.has(v))).toEqual([]);
  });

  it("does not let a known pairing unwind any other", () => {
    const known = tokens.nodeScopedSubject("s_evil", "s_nodeE");
    expect(known).not.toContain("s_evil");
    for (const other of ["s_r1", "s_r2", "s_r3"]) {
      expect(tokens.nodeScopedSubject(other, "s_nodeE")).not.toBe(known);
    }
  });

  it("cannot tell one anonymous read from another", async () => {
    const one = decodeJwt(await tokens.mintAnonymousKey({ discovery: "query" }));
    const two = decodeJwt(await tokens.mintAnonymousKey({ discovery: "query" }));
    expect(Object.keys(one).sort()).toEqual(Object.keys(two).sort());
    expect(one.discovery).toBe(two.discovery);
    expect(one.sub).toBeUndefined();
    expect(two.sub).toBeUndefined();
    expect(JSON.stringify(one.scp)).toBe(JSON.stringify(two.scp));
  });

  it("cannot spend a reader's key at a contributor it was not meant for", async () => {
    const forE = await tokens.mintNodeKey({
      sub: "s_reader",
      audience: "s_nodeE",
      sessionSecondsLeft: 900,
    });
    expect(await tokens.verifyAccessKey(forE, { audience: "s_nodeA" })).toBeNull();
  });

  it("cannot exceed its tier by editing the key", async () => {
    const key = await tokens.mintNodeKey({
      sub: "s_reader",
      audience: "s_nodeA",
      sessionSecondsLeft: 900,
    });
    const [header, payload, signature] = key.split(".");
    const edited = JSON.parse(Buffer.from(payload, "base64url").toString());
    edited.discovery = "sweep";
    edited.scp = ["write:propose", "serve:node"];
    const forged = [
      header,
      Buffer.from(JSON.stringify(edited)).toString("base64url"),
      signature,
    ].join(".");
    expect(await tokens.verifyAccessKey(forged, { audience: "s_nodeA" })).toBeNull();
  });
});

describe("what a reader learns about a contributor", () => {
  it("gets only what the contributor announced, plus what their node serves", () => {
    const locator = stripCommentsOnly(
      readFileSync(
        join(ROOT, "src", "app", "api", "v1", "read", "[sub]", "[id]", "route.ts"),
        "utf8",
      ),
    );
    for (const field of ["sub", "servedBy", "address", "payTo", "item", "fetch", "rules"]) {
      expect(locator).toContain(field);
    }
    for (const absent of ["readerCount", "views", "earnings", "since", "joined", "rank"]) {
      expect(locator).not.toContain(absent);
    }
  });

  it("can check the machine is who the registry said, without the platform", () => {
    const serving = stripCommentsOnly(
      readFileSync(join(ROOT, "src", "lib", "signaling", "serving.ts"), "utf8"),
    );
    expect(serving).toContain("servingMismatch");
    expect(serving).not.toMatch(/\bfetch\s*\(|from "node:/);
  });
});

describe("what one reader learns about another", () => {
  it("sees other proposers only under this contributor's scoped pseudonym", () => {
    const proposals = stripCommentsOnly(
      readFileSync(join(ROOT, "node", "proposals.ts"), "utf8"),
    );
    expect(proposals).toContain("fromSub");
    expect(proposals).not.toContain("fromName");
  });

  it("cannot use one to find the same person at another contributor", async () => {
    const here = decodeJwt(
      await tokens.mintNodeKey({ sub: "s_a", audience: "s_nodeA", sessionSecondsLeft: 900 }),
    ).sub;
    const there = decodeJwt(
      await tokens.mintNodeKey({ sub: "s_a", audience: "s_nodeB", sessionSecondsLeft: 900 }),
    ).sub;
    expect(here).not.toBe(there);
  });
});

describe("what a stranger learns about a contributor, without signing in", () => {
  it("tells contributors that presence is public, not merely operator-visible", () => {
    const contribute = readFileSync(
      join(ROOT, "src", "app", "contribute", "page.tsx"),
      "utf8",
    ).replace(/\s+/g, " ");

    expect(contribute).toMatch(/anyone can|any stranger|without signing in|no key/i);
    expect(contribute).toMatch(/when your machine|timeline|on and off|watch over time/i);
  });

  it("still discloses the operator's view as well", () => {
    const contribute = readFileSync(
      join(ROOT, "src", "app", "contribute", "page.tsx"),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(contribute).toMatch(/an operator could observe/i);
  });

  it("offers no history of its own to make that easier", async () => {
    const { stripCommentsOnly: strip } = await import("./scan");
    const live = strip(
      readFileSync(
        join(ROOT, "src", "app", "api", "v1", "live", "route.ts"),
        "utf8",
      ),
    );
    for (const p of ["since", "before", "after", "cursor", "all", "history"]) {
      expect(live).not.toContain(`searchParams.get("${p}")`);
    }
  });
});

describe("what the platform learns watching everybody at once", () => {
  it("holds only presence, and only while it is current", () => {
    const registry = stripCommentsOnly(
      readFileSync(join(ROOT, "src", "lib", "signaling", "registry.ts"), "utf8"),
    );
    expect(registry).toMatch(/interface Announcement \{[^}]*\}/s);
    for (const absent of ["readers", "requests", "lastSeen", "history", "count"]) {
      expect(registry).not.toMatch(new RegExp(`\\b${absent}:`));
    }
  });

  it("answers no question about the past, by having no parameter for one", () => {
    const live = stripCommentsOnly(
      readFileSync(join(ROOT, "src", "app", "api", "v1", "live", "route.ts"), "utf8"),
    );
    for (const parameter of ["since", "before", "after", "cursor", "all"]) {
      expect(live).not.toContain(`searchParams.get("${parameter}")`);
    }
  });

  it("admits that page requests reveal what a reader opened", () => {
    const privacy = readFileSync(
      join(ROOT, "src", "app", "privacy", "page.tsx"),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(privacy).toMatch(/page requests still carry your session/i);
    expect(privacy).toMatch(/we could, today, see which column pages you opened/i);
    expect(privacy).toMatch(/not going to describe it as done/i);
  });
});
