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

    // And the same for the module that validates an announcement, which is
    // where a wallet-recogniser would most plausibly be added now that the
    // schema lives somewhere of its own. A length is the only thing the
    // platform is willing to know about this field.
    const schema = readFileSync(
      join(ROOT, "src", "lib", "signaling", "announcement.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(schema).not.toMatch(/0x|ethereum|bitcoin|iban|isValidAddress/i);
    // `.max()` and nothing else. A `.trim()`, `.toLowerCase()` or `.regex()`
    // here would each be the platform forming an opinion about the string.
    const payToLine = schema
      .split("\n")
      .find((line) => line.includes("payTo:"));
    expect(payToLine).toBeDefined();
    expect(payToLine).not.toMatch(/\.trim\(|\.toLowerCase\(|\.regex\(|\.url\(|\.transform\(/);
  });

  it("bounds it at 300 characters, and says so somewhere that runs", async () => {
    // The bound existed in exactly one place — a `.max(300)` in the announce
    // schema — and nothing asserted it. Deleting the cap passed the whole
    // suite, and payTo is the one attacker-controlled string the platform
    // relays to every reader of a column.
    const { announcementSchema, PAY_TO_MAX } = await import(
      "@/lib/signaling/announcement"
    );

    expect(PAY_TO_MAX).toBe(300);

    const base = {
      displayName: "A contributor",
      address: "http://127.0.0.1:4600",
      items: [],
    };

    expect(
      announcementSchema.safeParse({ ...base, payTo: "x".repeat(300) }).success,
    ).toBe(true);
    expect(
      announcementSchema.safeParse({ ...base, payTo: "x".repeat(301) }).success,
    ).toBe(false);

    // Absent is fine: "nothing" is a legitimate answer to how to pay someone.
    expect(announcementSchema.safeParse(base).success).toBe(true);
  });

  it("relays it byte for byte, whatever is in it", async () => {
    // Verbatim means verbatim. No trimming, no normalising, no case folding —
    // each is a small step towards understanding the string, and understanding
    // it is the first step towards routing to it.
    const { createRegistry } = await import("@/lib/signaling/registry");
    const registry = createRegistry();

    const awkward = "  ETH: 0xAbC  /  ko-fi.com/Me    or don't bother  ";
    registry.announce({
      sub: "s_pay",
      displayName: "Payee",
      address: "http://127.0.0.1:4600",
      payTo: awkward,
      items: [{ id: "c", title: "C", kind: "column", tags: [] }],
    });

    expect(registry.find("s_pay", "c")?.presence.payTo).toBe(awkward);
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
  /**
   * This used to read `docs/CONTRACTS.md`, and broke when the documentation
   * was deleted — which turned out to be the useful accident.
   *
   * A rule recorded only in a document is a rule whose enforcement can be
   * removed by deleting a file nobody ships. The place this particular
   * prohibition has to survive is not a contributor-facing document; it is the
   * page where a contributor asks why they are not being paid, because that is
   * where the pressure to reverse it comes from. So the assertions moved to
   * the prose the product actually serves, which cannot be deleted without
   * somebody noticing a blank section.
   */
  const prose = (...parts: string[]) =>
    readFileSync(join(ROOT, ...parts), "utf8").replace(/\s+/g, " ");

  const contribute = prose("src", "app", "contribute", "page.tsx");
  const pricing = prose("src", "app", "pricing", "page.tsx");

  it("tells contributors, on the page about getting paid, that the platform never pays them", () => {
    expect(contribute).toMatch(/never pay you ourselves/i);
    expect(contribute).toMatch(/no bonuses/i);
    expect(contribute).toMatch(/incentives for popular columns/i);
  });

  it("says it is a rule rather than a feature nobody has built yet", () => {
    // The distinction is the entire point. "We don't do that yet" invites the
    // next person to do it; "we are not allowed to do that" invites them to
    // read why first.
    expect(contribute).toMatch(
      /a rule in the contracts rather than a current limitation/i,
    );
  });

  it("carries the reason, so nobody has to re-derive it under pressure", () => {
    // Two parties agreeing to say a transfer happened, and the platform being
    // structurally unable to tell. Without this sentence the prohibition looks
    // like squeamishness about payments rather than the one defence available.
    expect(contribute).toMatch(/pays out of a pool can have that pool drained/i);
    expect(contribute).toMatch(/agree to say a transfer happened/i);
    expect(contribute).toMatch(/we do not watch what moves between you and a reader/i);
  });

  it("tells readers the same thing, in the place they would assume otherwise", () => {
    expect(pricing).toMatch(/does not pay contributors/i);
    expect(pricing).toMatch(/we take no share/i);
    expect(pricing).toMatch(/paying out of a pool/i);
  });

  it("keeps the reasoning next to the code that would have to be written to break it", () => {
    // The argument also lives in this file's own docstring, which is the
    // thing a person editing the earnings machinery back in would read.
    const self = readFileSync(
      join(ROOT, "tests", "contracts", "brokers-connections-not-value.test.ts"),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(self).toMatch(
      /two colluding parties can sign a transfer that never happened/i,
    );
    expect(self).toMatch(
      /transcript of a real transfer is computable by the serving party alone/i,
    );
  });
});
