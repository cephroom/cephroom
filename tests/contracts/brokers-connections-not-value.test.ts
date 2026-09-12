import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, walk } from "./scan";

/**
 * The platform brokers connections and never value.
 *
 * A subscription buys a key of a given tier. The tier is a permission, not a
 * balance: it is not consumed by use, it expires when the key does, and that is
 * the whole model. A contributor may announce where they can be paid; the
 * platform displays the string and is not a party to anything that follows.
 *
 * This is enforced by a test because of what it replaced. An earlier design had
 * the platform split a subscription and pay contributors from the reserved part
 * against dual-signed usage records — receipt chains, write-before-pay
 * ordering, per-grant caps, bounded spent counters, the lot. Every line of it
 * defended one attack: **two colluding parties can sign a transfer that never
 * happened**, which is unpreventable without watching the data layer, because a
 * transcript of a real transfer is computable by the serving party alone.
 *
 * The defences could only make that loss-making and bounded, never impossible.
 * Removing the pool removes the attack outright — colluders are now dividing
 * their own money — so the machinery is gone and these assertions keep it gone.
 *
 * The row most likely to be argued back in is the last one: bonuses and growth
 * incentives for popular contributors. It is the obvious lever, it will look
 * harmless, and it reopens exactly this hole.
 */

function platformSources(): { rel: string; code: string }[] {
  return [...walk(join(ROOT, "src")), ...walk(join(ROOT, "node"))]
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .filter((file) => !file.includes(".test."))
    .map((file) => ({
      rel: relative(ROOT, file).split(sep).join("/"),
      code: readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, ""),
    }));
}

describe("no metering: a tier is a permission, not a balance", () => {
  it("has no usage record, allowance, or settlement path anywhere", () => {
    // A half-removed metering path is worse than either keeping or removing
    // it, so the absence is asserted rather than assumed.
    for (const { rel, code } of platformSources()) {
      for (const concept of [
        "allowance",
        "cumulativeUnits",
        "unitsForBytes",
        "settlement",
        "settledThrough",
        "spentCounter",
        "payoutMinor",
        "collusionNet",
      ]) {
        expect(code, `${rel} still references ${concept}`).not.toContain(
          concept,
        );
      }
    }
  });

  it("keeps no module that could compute what anybody is owed", () => {
    const files = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "node"))].map(
      (file) => relative(ROOT, file).split(sep).join("/"),
    );
    for (const gone of [
      "src/lib/earnings/units.ts",
      "src/lib/earnings/receipt.ts",
      "src/lib/earnings/settlement.ts",
      "src/lib/earnings/sessions.ts",
      "src/lib/earnings/grant.ts",
      "src/lib/earnings/funding.ts",
      "node/metering.ts",
    ]) {
      expect(files, `${gone} is back`).not.toContain(gone);
    }
  });

  it("exposes no settlement or payout endpoint", () => {
    const routes = walk(join(ROOT, "src", "app", "api")).map((file) =>
      relative(ROOT, file).split(sep).join("/"),
    );
    for (const route of routes) {
      expect(route).not.toMatch(/settle|payout|earnings|usage/i);
    }
  });
});

describe("the platform never funds a payment to a contributor", () => {
  it("has no code path that moves money outward", () => {
    // Stripe is used to *read* entitlement and to take a subscription. A
    // transfer, payout or Connect account would make this a payments business
    // with a different legal shape, and would reopen the collusion hole by
    // recreating a pool to drain.
    for (const { rel, code } of platformSources()) {
      for (const outward of [
        "transfers.create",
        "payouts.create",
        "accounts.create",
        "stripe.transfers",
        "stripe.payouts",
      ]) {
        expect(code, `${rel} moves money outward via ${outward}`).not.toContain(
          outward,
        );
      }
    }
  });

  it("never computes an amount on a contributor's behalf", () => {
    for (const { rel, code } of platformSources()) {
      expect(code, `${rel} looks like it prices something`).not.toMatch(
        /\b(amountOwed|earned|earnings|commission|revenueShare|contributorShare)\b/,
      );
    }
  });
});

describe("what a contributor announces is displayed and nothing more", () => {
  it("passes payTo through without parsing or validating it", () => {
    // Recognising a wallet address would be the first step towards routing to
    // one. It is an opaque string: a wallet, a page, an institutional account,
    // or a sentence saying not to bother.
    const registry = readFileSync(
      join(ROOT, "src", "lib", "signaling", "registry.ts"),
      "utf8",
    );
    expect(registry).toContain("payTo?: string");

    const code = registry
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    // No shape checking, no chain detection, no normalisation.
    expect(code).not.toMatch(/0x|ethereum|bitcoin|iban|isValidAddress/i);
  });

  it("is never persisted, like everything else in the registry", () => {
    // Comments scrubbed: that file's docstring says at length that nothing
    // here touches a file or a database, and saying so is not doing so.
    const code = readFileSync(
      join(ROOT, "src", "lib", "signaling", "registry.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/writeFileSync|appendFile|database/);
  });

  it("says plainly that the platform is not part of what happens next", () => {
    // The reader has to understand that paying is their own separate act.
    // If this copy goes, the page starts to read like a marketplace.
    const reader = readFileSync(
      join(ROOT, "src", "components", "column-reader.tsx"),
      "utf8",
    );
    expect(reader).toMatch(/take no share/i);
    expect(reader).toMatch(/not part of whatever happens next/i);
  });
});

describe("the prohibition is written down where it will be argued with", () => {
  it("names bonuses and growth incentives as forbidden", () => {
    const contracts = readFileSync(join(ROOT, "docs", "CONTRACTS.md"), "utf8");
    expect(contracts).toMatch(/brokers connections, never value/i);
    expect(contracts).toMatch(/bonuses.*growth incentives.*subsidies/i);
    // And the reason, so a future reader does not have to re-derive it.
    // The reason, so a future reader does not have to re-derive it. Matched
    // across a line break, because the document is wrapped prose.
    expect(contracts.replace(/\s+/g, " ")).toMatch(
      /colluding parties can sign a transfer that never happened/i,
    );
  });
});
