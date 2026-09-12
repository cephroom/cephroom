import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly } from "./scan";

/**
 * The simulated billing controls act on the subscription the page shows -
 * contract 3.
 *
 * The account page shows the DISCOVERY plan chosen by governingSubscription
 * (which prefers a paying subscription). But it wired the billing controls to
 * subscriptions[0] - the raw first subscription in Stripe's list. When a
 * customer has more than one (a lapsed subscription plus a live one, which is
 * ordinary), those are different subscriptions: the page presents the live plan
 * while the controls drive the dead one. "Renewal fails" then never appears on
 * a customer whose first-listed subscription is canceled, and "Advance period"
 * silently moves a subscription the reader is not looking at.
 *
 * The controls must target the subscription the page is about - the governing
 * one - so what you act on is what you see.
 *
 * The page is a server component reading cookies, so this guards the wiring's
 * shape; the behaviour was confirmed live (an active subscriber whose canceled
 * subscription was listed first saw only the canceled-state controls).
 */
const page = stripCommentsOnly(
  readFileSync(join(ROOT, "src", "app", "account", "page.tsx"), "utf8"),
);

const controls = (() => {
  const at = page.indexOf("<SimulatedBillingControls");
  expect(at, "no <SimulatedBillingControls> in the account page").toBeGreaterThan(-1);
  return page.slice(at, page.indexOf("/>", at) + 2);
})();

describe("the dev controls target the governing subscription, not an arbitrary one", () => {
  it("does not wire the controls to subscriptions[0]", () => {
    expect(
      controls,
      "The controls must not act on subscriptions[0] - when a customer has a lapsed plus a live subscription, that is the wrong one, and it disagrees with the plan the page shows.",
    ).not.toMatch(/subscriptions\[0\]/);
  });

  it("wires subscriptionId and status from the same subscription object", () => {
    const idMatch = controls.match(/subscriptionId=\{\s*([A-Za-z_$][\w$]*)\.id\s*\}/);
    const statusMatch = controls.match(/status=\{\s*([A-Za-z_$][\w$]*)\.status\s*\}/);
    expect(idMatch, "subscriptionId must be <obj>.id").not.toBeNull();
    expect(statusMatch, "status must be <obj>.status").not.toBeNull();
    expect(
      idMatch![1],
      "subscriptionId and status must come from the SAME subscription, or the controls could act on one plan while reporting another's state.",
    ).toBe(statusMatch![1]);
  });

  it("binds that subscription to the governing plan the page shows", () => {
    // The object feeding the controls resolves to the governing discovery plan
    // (falling back to serving) - the same selection the page renders.
    expect(page).toMatch(/discoverySub\s*\?\?\s*servingSub/);
  });
});
