import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { decodeJwt } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly } from "./scan";

/**
 * What every party can observe about every other, enumerated.
 *
 * Written after running the platform at a realistic shape — two contributors
 * and five readers on three tiers, concurrently — because three of the four
 * privacy findings that run produced were invisible at one-to-one scale. They
 * were all comparisons: between two contributors, between two readers,
 * between a claim and the machine making it. You cannot compare parties you
 * do not have.
 *
 * The point of this file is that "nothing leaks" is not a testable sentence.
 * What is testable is a closed list: here is precisely what each side sees,
 * and adding to it fails. So each surface below is pinned exhaustively rather
 * than checked for the absence of particular bad values, and the answer to
 * "can a contributor learn X" is decided by reading the list rather than by
 * reasoning about the code.
 *
 * The honest residue is recorded too. Some of what a contributor learns is
 * not in any field we control and cannot be removed without removing the
 * direct connection that the whole architecture exists to provide.
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

describe("what a contributor learns about a reader", () => {
  it("receives exactly these fields, and no others", async () => {
    // Measured against a live node during the two-contributor run; this is
    // the whole of what arrives in the credential.
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
    // This used to say "learns the reader's tier, and nothing finer", because
    // a node decided what to serve and had to be told what was bought. It
    // decides nothing now: a column is served whole to whoever asks, so the
    // tier went with the decision it existed for. What a consumer pays us for
    // is discovery, which happens entirely on our side of the connection.
    const claims = decodeJwt(
      await tokens.mintNodeKey({
        sub: "s_reader",
        audience: "s_nodeA_marcus",
        sessionSecondsLeft: 900,
      }),
    );

    expect(claims).not.toHaveProperty("tier");
    expect(claims).not.toHaveProperty("discovery");
    // Checked as claim *keys*, not as substrings of the serialised token —
    // "cus" is a substring of "s_nodeA_marcus", and a test that can be passed
    // or failed by somebody's name is not testing what it says it is.
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
    // Stated positively because it is true, deliberate, and load-bearing:
    // a proposal has to be attributable, and the per-person flood limit
    // depends on it. A contributor knows "this is the same person as last
    // week" and "these are four different people".
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
    // The stronger position, available to any subscriber. No subject, so
    // nothing to recognise and nothing to accumulate against.
    const claims = decodeJwt(await tokens.mintAnonymousKey({ discovery: "query" }));
    expect(claims.sub).toBeUndefined();
    expect(Object.keys(claims).sort()).toEqual(
      ["anon", "aud", "discovery", "exp", "iat", "iss", "scp"].sort(),
    );
  });

  /**
   * What remains, and why it is not fixable here.
   *
   * A reader's browser connects to a contributor's machine directly, so that
   * machine sees an IP address, a timestamp, which item was requested, and
   * whatever headers the browser chose to send. None of it passes through any
   * field this codebase controls, and removing it would mean putting the
   * platform back in the request — which is the one thing Contract 2 exists
   * to prevent, and a far larger loss.
   *
   * So it is disclosed rather than defended against, and the disclosure has
   * to keep saying so.
   */
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
  /**
   * The adversarial half, run at five contributors and twelve readers with a
   * hostile party embedded on each side. Both hold legitimate keys and are
   * entitled to what they have; everything they do looks correct to anything
   * that only checks signatures.
   *
   * Measured with the two of them colluding — the hostile contributor
   * publishing everything she sees, the hostile reader telling her everything
   * he knows:
   *
   *   Mallory sees 11 pseudonyms
   *   Marcus  sees 11 pseudonyms
   *   pseudonyms that match across the two nodes: 0
   *
   * A contributor's view is a function of (reader, themselves). Publishing it
   * gives another contributor a column of values computed under a different
   * key, so there is nothing to join on. And a reader knowing their own
   * pairing does not invert the function for anybody else's.
   */
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
    // The hostile reader tells the hostile contributor exactly who he is.
    // That is one row of the table and buys nothing: the derivation is keyed
    // on a secret neither of them has.
    const known = tokens.nodeScopedSubject("s_evil", "s_nodeE");
    expect(known).not.toContain("s_evil");
    for (const other of ["s_r1", "s_r2", "s_r3"]) {
      expect(tokens.nodeScopedSubject(other, "s_nodeE")).not.toBe(known);
    }
  });

  it("cannot tell one anonymous read from another", async () => {
    // The strongest position a reader can take, and it has to survive an
    // adversary looking specifically for a difference. Two anonymous keys at
    // the same tier differ only in their signature.
    const one = decodeJwt(await tokens.mintAnonymousKey({ discovery: "query" }));
    const two = decodeJwt(await tokens.mintAnonymousKey({ discovery: "query" }));
    expect(Object.keys(one).sort()).toEqual(Object.keys(two).sort());
    expect(one.discovery).toBe(two.discovery);
    expect(one.sub).toBeUndefined();
    expect(two.sub).toBeUndefined();
    expect(JSON.stringify(one.scp)).toBe(JSON.stringify(two.scp));
  });

  it("cannot spend a reader's key at a contributor it was not meant for", async () => {
    // The hostile contributor's other route to correlation: take the key a
    // reader hands her and try it at a rival, to learn the pseudonym that
    // rival would see.
    const forE = await tokens.mintNodeKey({
      sub: "s_reader",
      audience: "s_nodeE",
      sessionSecondsLeft: 900,
    });
    expect(await tokens.verifyAccessKey(forE, { audience: "s_nodeA" })).toBeNull();
  });

  it("cannot exceed its tier by editing the key", async () => {
    const member = await tokens.mintNodeKey({
      sub: "s_reader",
      audience: "s_nodeA",
      sessionSecondsLeft: 900,
    });
    const [header, payload, signature] = member.split(".");
    const edited = JSON.parse(Buffer.from(payload, "base64url").toString());
    edited.tier = "lab";
    edited.scp = ["read:public", "read:member", "read:lab"];
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
    // Everything here is self-declared. The platform adds nothing of its own
    // and holds nothing to add.
    const locator = stripCommentsOnly(
      readFileSync(
        join(ROOT, "src", "app", "api", "v1", "read", "[sub]", "[id]", "route.ts"),
        "utf8",
      ),
    );
    for (const field of ["sub", "servedBy", "address", "payTo", "item", "fetch", "rules"]) {
      expect(locator).toContain(field);
    }
    // Nothing about how the contributor is doing, because nobody counts.
    for (const absent of ["readerCount", "views", "earnings", "since", "joined", "rank"]) {
      expect(locator).not.toContain(absent);
    }
  });

  it("can check the machine is who the registry said, without the platform", () => {
    const serving = stripCommentsOnly(
      readFileSync(join(ROOT, "src", "lib", "signaling", "serving.ts"), "utf8"),
    );
    expect(serving).toContain("servingMismatch");
    // Pure: the browser and the CLI both run it, and neither asks the
    // platform anything to do so.
    expect(serving).not.toMatch(/\bfetch\s*\(|from "node:/);
  });
});

describe("what one reader learns about another", () => {
  it("sees other proposers only under this contributor's scoped pseudonym", () => {
    // A proposal list is visible to everyone entitled to the column, so a
    // proposer is visible to other readers by construction. What they are
    // visible *as* is the part that matters: before the scoping change this
    // list handed out platform subjects, so any member collected global
    // identifiers for members they had never met.
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
  /**
   * Measured with a hostile consumer: `/api/v1/live` needs no key, has no
   * rate limit, and returns every contributor's address. Three polls in a
   * second, five contributors each time.
   *
   * That is discovery working — a reader has to be able to find who is
   * serving, and the address is the point of the endpoint. But it means
   * anybody can poll it on a timer and build a presence timeline for every
   * contributor: when their machine is on, when it goes off, how long for.
   * For somebody serving from their own laptop that is a record of when they
   * are at their desk, held by whoever bothered to collect it.
   *
   * It cannot be closed without closing discovery, so it is disclosed. The
   * gap this covers is that /contribute disclosed the *operator's* view —
   * "the platform holds the association between your subject and a network
   * address in RAM, and an operator could observe that" — and stopped there,
   * while the public view is strictly larger and available to anyone.
   */
  it("tells contributors that presence is public, not merely operator-visible", () => {
    const contribute = readFileSync(
      join(ROOT, "src", "app", "contribute", "page.tsx"),
      "utf8",
    ).replace(/\s+/g, " ");

    expect(contribute).toMatch(/anyone can|any stranger|without signing in|no key/i);
    // And that it is repeatable, which is what turns an address into a
    // timeline.
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
    // The platform must not be the one keeping the timeline. A poller builds
    // their own; that is their record, not ours.
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
    // The shape of what is held, pinned. A field added here is a field that
    // survives as long as a lease and shows up in the public listing.
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

  /**
   * The one thing the platform does see, and where it is admitted.
   *
   * A column page is server-rendered with the reader's cookie attached, and
   * it mints a node key for (this reader, this contributor). So at render
   * time the platform necessarily knows who asked for what. Nothing is
   * written down — the registry is byte-identical after any amount of
   * traffic, which the two-contributor run confirmed directly — but the
   * capability exists for the length of the request, and a promise is what
   * stops it being used.
   *
   * That is exactly how /privacy already describes it, and it must keep
   * describing it that way.
   */
  it("admits that page requests reveal what a reader opened", () => {
    const privacy = readFileSync(
      join(ROOT, "src", "app", "privacy", "page.tsx"),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(privacy).toMatch(/page requests still carry your session/i);
    expect(privacy).toMatch(/we could, today, see which column pages you opened/i);
    // And that it is not described as solved.
    expect(privacy).toMatch(/not going to describe it as done/i);
  });
});
