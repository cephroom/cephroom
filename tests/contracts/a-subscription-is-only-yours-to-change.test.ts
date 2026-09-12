import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly } from "./scan";

/**
 * You can only cancel or resume your own subscription - contract 3.
 *
 * cancelSubscription and resumeSubscription take a subscriptionId from a form,
 * which the client controls. Without an ownership check that is a textbook
 * IDOR: anyone signed in could cancel a stranger's plan by id (griefing) or
 * flip cancel-at-period-end on a subscription that is not theirs. The store's
 * setCancelAtPeriodEnd trusts the id - it has no notion of who is asking - so
 * the check has to live in the action, and it does: it lists the viewer's own
 * subscriptions and refuses an id that is not among them.
 *
 * This is a server action that reads cookies, so it is not unit-testable in a
 * node test environment; this guards the shape of the check instead, so it
 * cannot be removed or bypassed silently.
 */
const actions = stripCommentsOnly(
  readFileSync(join(ROOT, "src", "lib", "stripe", "actions.ts"), "utf8"),
);

function bodyOf(name: string): string {
  const start = actions.indexOf(`function ${name}`);
  expect(start, `no ${name}`).toBeGreaterThan(-1);
  const next = actions.indexOf("\nasync function ", start + 1);
  const next2 = actions.indexOf("\nexport ", start + 1);
  const end = Math.min(...[next, next2].filter((n) => n > start).concat([actions.length]));
  return actions.slice(start, end);
}

describe("cancel and resume verify ownership before mutating", () => {
  it("routes both through the same guarded helper", () => {
    for (const name of ["cancelSubscription", "resumeSubscription"]) {
      const body = bodyOf(name);
      expect(
        body,
        `${name} must delegate to setCancellation, not call the gateway directly.`,
      ).toMatch(/setCancellation\(/);
      expect(
        body,
        `${name} must not call setCancelAtPeriodEnd itself, bypassing the ownership check.`,
      ).not.toMatch(/setCancelAtPeriodEnd/);
    }
  });

  it("checks the id is among the viewer's own subscriptions before changing it", () => {
    const body = bodyOf("setCancellation");
    const listAt = body.indexOf("listSubscriptions");
    const membershipAt = body.search(/\.id === subscriptionId|=== subscriptionId/);
    const mutateAt = body.indexOf("setCancelAtPeriodEnd");

    expect(listAt, "setCancellation must list the viewer's subscriptions").toBeGreaterThan(-1);
    expect(membershipAt, "setCancellation must check the id belongs to the viewer").toBeGreaterThan(-1);
    expect(mutateAt, "setCancellation must call the mutation").toBeGreaterThan(-1);

    expect(
      membershipAt < mutateAt && listAt < mutateAt,
      "the ownership check must happen BEFORE the mutation, or it protects nothing.",
    ).toBe(true);
  });

  it("derives the caller from the session, not from the form", () => {
    const body = bodyOf("setCancellation");
    expect(body).toMatch(/getViewer\(\)/);
    // The subject used to scope the lookup must come from the viewer, never a
    // form field.
    expect(body).not.toMatch(/formData\.get\("sub"\)|formData\.get\('sub'\)/);
  });

  it("refuses with a clear error rather than proceeding", () => {
    expect(bodyOf("setCancellation")).toMatch(/not yours|throw new Error/i);
  });
});
