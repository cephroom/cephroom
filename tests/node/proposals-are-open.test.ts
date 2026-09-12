import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly } from "../contracts/scan";

/**
 * Proposals are as open as the column they belong to.
 *
 * This file replaces `proposals-entitlement.test.ts`, which held the node to
 * gating `/proposals` behind the column's access level. That test was right
 * when it was written: `/proposals` had been leaking the source of a paid
 * column to anyone, because a proposal quotes the body it proposes changing,
 * and the GET had no check while `/column` did.
 *
 * The leak is gone because the thing it leaked is gone. A column has no
 * access level and is served whole to whoever asks, so a proposal against it
 * quotes nothing that was ever withheld. Keeping the gate would mean the node
 * enforcing a distinction that no longer exists anywhere else — which is the
 * half-removed entitlement path that is worse than either keeping or removing
 * it.
 *
 * What survives is the asymmetry that was always the real rule: **reading a
 * proposal is open, writing one is not.** A proposal lands on somebody's disk
 * and has to be answerable, so it needs a subject. That is attribution, not
 * payment, and it is the one requirement that never came from a tier.
 */

// Comments stripped, strings kept: the markers below are route paths, and a
// stripper that removes string contents would make every search miss.
const server = stripCommentsOnly(
  readFileSync(join(ROOT, "node", "server.ts"), "utf8"),
);

const handler = (marker: string) => {
  const start = server.indexOf(marker);
  expect(start, `no handler matching ${marker}`).toBeGreaterThan(-1);
  return server.slice(start, server.indexOf("if (url.pathname", start + 10));
};

describe("reading proposals is open", () => {
  it("checks no tier before listing them", () => {
    const get = handler('url.pathname === "/proposals" && request.method === "GET"');
    expect(get).not.toMatch(/tierAllows|entitled|\btier\b/);
  });

  it("still refuses a column this node does not serve", () => {
    // Unchanged, and not about access: asking for proposals on something the
    // node has never heard of is a 404 rather than an empty list, so a
    // typo does not read as "nobody has commented".
    const get = handler('url.pathname === "/proposals" && request.method === "GET"');
    expect(get).toMatch(/not served here/);
  });
});

describe("writing a proposal still needs a name to answer", () => {
  it("requires the propose scope", () => {
    const post = handler('url.pathname === "/proposals" && request.method === "POST"');
    expect(post).toMatch(/write:propose/);
  });

  it("requires a subject, so an anonymous token cannot propose", () => {
    // The one place anonymity is refused, and for a reason that has nothing
    // to do with money: a proposal with nobody attached is a demand on a
    // contributor's attention that they cannot reply to.
    const post = handler('url.pathname === "/proposals" && request.method === "POST"');
    expect(post).toMatch(/fromSub/);
  });

  it("says why, in the refusal itself", () => {
    const raw = readFileSync(join(ROOT, "node", "server.ts"), "utf8");
    expect(raw).toMatch(/A proposal has to be attributable/i);
  });

  it("does not mention membership in any refusal", () => {
    // The old message said proposing "needs the same membership as reading
    // the column". There is no membership, and a refusal that names one
    // sends a contributor looking for a plan that would not help.
    const raw = readFileSync(join(ROOT, "node", "server.ts"), "utf8");
    expect(raw).not.toMatch(/needs the same membership|Membership grants/i);
  });
});
