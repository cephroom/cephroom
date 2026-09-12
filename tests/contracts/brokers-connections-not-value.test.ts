import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, walk } from "./scan";


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
    const registry = readFileSync(
      join(ROOT, "src", "lib", "signaling", "registry.ts"),
      "utf8",
    );
    expect(registry).toContain("payTo?: string");

    const code = registry
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/0x|ethereum|bitcoin|iban|isValidAddress/i);

    const schema = readFileSync(
      join(ROOT, "src", "lib", "signaling", "announcement.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(schema).not.toMatch(/0x|ethereum|bitcoin|iban|isValidAddress/i);
    const payToLine = schema
      .split("\n")
      .find((line) => line.includes("payTo:"));
    expect(payToLine).toBeDefined();
    expect(payToLine).not.toMatch(/\.trim\(|\.toLowerCase\(|\.regex\(|\.url\(|\.transform\(/);
  });

  it("bounds it at 300 characters, and says so somewhere that runs", async () => {
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

    expect(announcementSchema.safeParse(base).success).toBe(true);
  });

  it("relays it byte for byte, whatever is in it", async () => {
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
    const code = readFileSync(
      join(ROOT, "src", "lib", "signaling", "registry.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/writeFileSync|appendFile|database/);
  });

  it("says plainly that the platform is not part of what happens next", () => {
    const reader = readFileSync(
      join(ROOT, "src", "components", "column-reader.tsx"),
      "utf8",
    );
    expect(reader).toMatch(/take no share/i);
    expect(reader).toMatch(/not part of whatever happens next/i);
  });
});

describe("the prohibition is written down where it will be argued with", () => {
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
    expect(contribute).toMatch(
      /a rule in the contracts rather than a current limitation/i,
    );
  });

  it("carries the reason, so nobody has to re-derive it under pressure", () => {
    expect(contribute).toMatch(/pays out of a pool can have that pool drained/i);
    expect(contribute).toMatch(/agree to say a transfer happened/i);
    expect(contribute).toMatch(/we do not watch what moves between you and a reader/i);
  });

  it("tells readers the same thing, in the place they would assume otherwise", () => {
    expect(pricing).toMatch(/does not pay contributors/i);
    expect(pricing).toMatch(/we take no share/i);
    expect(pricing).toMatch(/paying out of a pool/i);
  });

  it("keeps the reasoning somewhere it can be read and argued with", () => {
    const notes = readFileSync(
      join(ROOT, "docs", "RESEARCH-NOTES.md"),
      "utf8",
    ).replace(/\s+/g, " ");

    expect(
      notes,
      [
        "docs/RESEARCH-NOTES.md must carry the argument for why the pool was",
        "removed rather than defended, because contract 6 is the one that will",
        "be argued with under commercial pressure and 'we decided not to' is not",
        "an argument anybody can check.",
        "",
        "This assertion used to read this test file and search it for a string",
        "that appeared only in the assertion's own regex literal — it searched",
        "itself, and could not fail. Pointing it at the document makes deleting",
        "the reasoning fail the suite, which is the property that was wanted.",
      ].join("\n"),
    ).toMatch(
      /transcript of a real transfer is computable by the serving party alone/i,
    );

    expect(notes).toMatch(
      /anything a receiver could contribute \*?after\*? a real transfer/i,
    );
    expect(notes, "the notes must say prover nodes do not close it").toMatch(
      /prover nodes do not close it/i,
    );
    expect(notes, "the notes must state the structural resolution").toMatch(
      /two parties moving their own money|colluders (divide|drain)/i,
    );
  });
});
