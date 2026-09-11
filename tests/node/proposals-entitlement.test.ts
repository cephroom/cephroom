import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The /proposals routes must enforce the column's paywall.
 *
 * A proposal's body is the column's full Markdown source — a proposal is an
 * edit to the source the way a pull request is a diff of the file. So both
 * listing proposals (GET) and posting one (POST) have to require the same
 * entitlement that /column enforces via gateColumnBody. Without the GET gate,
 * an anonymous reader can pull the whole paid article, plus every proposer's
 * pseudonymous subject, out of the proposals on any member/lab column — a side
 * door straight around the paywall. Without the POST gate, a member can seed
 * edits into a lab column they cannot even read.
 *
 * The bug this guards is the *absence* of a check, which no behavioural unit
 * test of the pure helpers would catch (they were never wired in). So the
 * guard is structural: each handler block must call tierAllows. If someone
 * deletes a gate, one of these turns red.
 */
describe("the node gates /proposals behind the column's entitlement", () => {
  const source = readFileSync(
    join(process.cwd(), "node/server.ts"),
    "utf8",
  );

  function handler(marker: string): string {
    const start = source.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    // Everything from the handler's guard to the end of its block: enough to
    // contain the entitlement check, bounded so it cannot borrow the other
    // handler's check.
    return source.slice(start, start + 1400);
  }

  it("checks tierAllows before listing proposals (GET)", () => {
    const get = handler('"/proposals" && request.method === "GET"');
    expect(get).toContain("tierAllows(");
  });

  it("checks tierAllows before accepting a proposal (POST)", () => {
    const post = handler('"/proposals" && request.method === "POST"');
    expect(post).toContain("tierAllows(");
  });

  it("still resolves the column first, so an unknown column is 404 not open", () => {
    const get = handler('"/proposals" && request.method === "GET"');
    expect(get).toContain("not served here");
  });
});
