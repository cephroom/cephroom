import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly } from "../contracts/scan";


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
    const post = handler('url.pathname === "/proposals" && request.method === "POST"');
    expect(post).toMatch(/fromSub/);
  });

  it("says why, in the refusal itself", () => {
    const raw = readFileSync(join(ROOT, "node", "server.ts"), "utf8");
    expect(raw).toMatch(/A proposal has to be attributable/i);
  });

  it("does not mention membership in any refusal", () => {
    const raw = readFileSync(join(ROOT, "node", "server.ts"), "utf8");
    expect(raw).not.toMatch(/needs the same membership|Membership grants/i);
  });
});
