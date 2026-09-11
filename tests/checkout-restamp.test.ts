import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A paid checkout must leave the reader holding a re-stamped key.
 *
 * The bug this guards: real Stripe returns the browser to the restamp route
 * as a genuine top-level navigation, so that route's Set-Cookie lands. The
 * simulated checkout completes inside a server action instead, and the
 * redirect it throws is followed as an RSC navigation that drops the
 * intermediate route's cookie — so a reader who just paid would land on
 * /account still stamped Reader. The fix is to re-stamp inside the action,
 * where cookies().set() sticks.
 *
 * This is a browser/Next-integration failure that a node unit test cannot
 * reproduce, so the guard is structural: the completion paths of the
 * simulated checkout must call restampKey(). If someone deletes that call,
 * this turns red before the regression ships.
 */
describe("simulated checkout re-stamps the key on completion", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/simulated/checkout/page.tsx"),
    "utf8",
  );

  it("imports restampKey", () => {
    expect(source).toMatch(/import\s*\{[^}]*\brestampKey\b[^}]*\}/);
  });

  it("calls restampKey in the pay path", () => {
    // The pay() action must re-stamp before it redirects, or the paid reader
    // lands still stamped Reader.
    const pay = source.slice(
      source.indexOf("async function pay"),
      source.indexOf("async function decline"),
    );
    expect(pay).toContain("restampKey(");
  });

  it("calls restampKey in the declined-card path too", () => {
    // A declined card still creates a subscription (past_due); the key must
    // reflect whatever Stripe now says rather than the stale prior tier.
    const decline = source.slice(source.indexOf("async function decline"));
    expect(decline).toContain("restampKey(");
  });
});
