import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly } from "../contracts/scan";

/**
 * A node serves its content uncached - contract 4, and the live-re-run thesis.
 *
 * The whole point of the product is that a reader's browser re-runs a column's
 * claims against the LIVE dataset every time it opens. If the node's column and
 * dataset responses are cacheable, a browser or an intermediary can hand back a
 * stale copy, and a sentence that has quietly become wrong stops saying so -
 * the exact failure the design exists to prevent. Contract 4 also names caching
 * directly: content is "not archived, cached, or tombstoned".
 *
 * The /asset/ route already sets no-store, with a comment claiming it serves "a
 * figure ... with the same posture as a column: no store" - but the shared
 * send() helper used by /column, /dataset, /manifest and /proposals set only
 * content-type and CORS, so a column was in fact cacheable. Verified live: a
 * fetch of /column and /dataset came back with no cache-control at all.
 */
const server = stripCommentsOnly(
  readFileSync(join(ROOT, "node", "server.ts"), "utf8"),
);

describe("the node tells caches to hold nothing it serves", () => {
  it("sets no-store on the shared JSON send helper", () => {
    const at = server.indexOf("const send =");
    expect(at, "no send() helper found").toBeGreaterThan(-1);
    const body = server.slice(at, server.indexOf("};", at) + 2);
    expect(
      body,
      "send() must set cache-control: no-store, or every column, dataset, manifest and proposal-list it returns is cacheable - a stale answer to a question that is supposed to be re-run live.",
    ).toMatch(/"cache-control":\s*"no-store"/);
  });

  it("keeps the figure route's no-store, matching its own stated posture", () => {
    // The /asset/ route's comment asserts content is served no-store "the same
    // posture as a column"; that must stay true of both.
    expect(server).toMatch(/"cache-control":\s*"no-store"/);
  });
});
