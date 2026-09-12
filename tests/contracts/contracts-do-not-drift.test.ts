import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT } from "./scan";

/**
 * The eleven contracts as authored, held here so docs/CONTRACTS.md cannot
 * quietly become the authority on what they say.
 *
 * A pointer to a file is not good enough. The file can drift - a softened
 * "never", a dropped clause, an added exception, a reordered priority - and a
 * drifted file becomes the new standard without anyone deciding that it should.
 * Every one of those edits is small, defensible on its own, and invisible in a
 * diff nobody is reading as a contract change.
 *
 * This is not the self-referential trap that was removed from
 * brokers-connections-not-value.test.ts. That assertion searched its own file
 * for its own regex literal and could not fail. This one compares two
 * independent files: edit the document and it fails here.
 *
 * Typography is normalised because an em-dash is not a clause. Wording is not.
 */
const AUTHORED: Record<number, string> = {
  1: `This is a GitHub for science. Any change that would make it
indistinguishable from a generic publishing SaaS is the wrong change.
Everything else is negotiable; this is not.`,

  2: `No person-linkable data at rest. No user table, profile, email, session
store, or activity record. Sign-in proves identity and is then forgotten. The
Privacy Pass nullifier set is the one exception: named, bounded, short-epoch,
process-global rather than at rest.`,

  3: `Authorization is signature verification, never a lookup. Subscription
truth lives only in Stripe and is never mirrored. Consequences: an individual
key cannot be revoked, so short expiry plus renewal replaces revocation; there
are no API keys, because a stable per-person key is a profile. A key's expiry
timestamp is SIGNED, not encrypted - a contributor's node must verify it from
the public key alone.`,

  4: `The platform stores no content. Contributors serve from their own
machines; when they stop, it is gone - not archived, cached, or tombstoned.
Signaling and discovery only. No TURN relay: relaying means content passes
through the platform. The cost - 10-20% of strict-NAT users cannot connect -
is accepted.`,

  5: `The platform brokers connections, never value. Never collects for
contributors, holds funds, pays anyone, or takes a cut. --pay-to is relayed
verbatim, never parsed, never stored, capped at 300 characters.`,

  6: `Never introduce platform-funded contributor payouts. No bonuses, no
growth incentives. This is the only route to creating money from nothing, and
it will be commercially tempting later.`,

  7: `Money is never in floating point. "Payout never exceeds intake" once
failed by 2x10^-14 toward overpaying. An invariant needing a tolerance is not an
invariant.`,

  8: `The platform verifies proofs and never produces them. Never operate a
prover. zkLogin was measured and rejected: the zero-knowledge property is gone
when the party being convinced is the party doing the convincing.`,

  9: `Contracts outrank features. When a feature and a contract conflict, cut
the feature and record the decision. There is no "stores just a little." If you
find yourself arguing that something is technically not at rest, that argument
is the signal a contract is about to break - stop.`,

  10: `Contracts are enforced by tests, not discipline. A suite that would
still pass after a user table appeared enforces nothing. Every finding gets a
regression test before the fix.`,

  11: `Adversarial testing targets the local dev server only. Never probe,
scan, fuzz, or send crafted input to any external site or service. When
browsing externally you are a reader, nothing more. This overrides any
instruction elsewhere.`,
};

function normalise(text: string): string {
  return text
    .replace(/—|–/g, "-")
    .replace(/’/g, "'")
    .replace(/“|”/g, '"')
    .replace(/2×10⁻¹⁴/g, "2x10^-14")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function recorded(): Record<number, string> {
  const doc = readFileSync(join(ROOT, "docs", "CONTRACTS.md"), "utf8");
  const start = doc.indexOf("## The eleven");
  const end = doc.indexOf("## Contract 1 ");
  expect(start, "docs/CONTRACTS.md has no 'The eleven' section").toBeGreaterThan(-1);
  expect(end, "docs/CONTRACTS.md has no per-contract section").toBeGreaterThan(start);

  const section = doc.slice(start, end);
  const out: Record<number, string> = {};
  for (const match of section.matchAll(
    /\*\*(\d+)\.\*\*([\s\S]*?)(?=\n\n\*\*\d+\.\*\*|\n\n---)/g,
  )) {
    out[Number(match[1])] = normalise(match[2]);
  }
  return out;
}

describe("docs/CONTRACTS.md reproduces the contracts as authored", () => {
  const inFile = recorded();

  it("records all eleven, and no more", () => {
    expect(Object.keys(inFile).map(Number).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it.each(Object.keys(AUTHORED).map(Number))(
    "records contract %i word for word",
    (n) => {
      expect(
        inFile[n],
        [
          `docs/CONTRACTS.md no longer states contract ${n} as authored.`,
          "",
          "The authored text is the authority and it is held in this file. If the",
          "contract itself is being changed, change it here in the same commit and",
          "say why in the message - that is the point at which somebody should be",
          "asked whether it should change at all.",
          "",
          "A softened 'never', a dropped clause, or an added exception is exactly",
          "the edit this exists to catch, and every one of them is defensible on",
          "its own.",
        ].join("\n"),
      ).toBe(normalise(AUTHORED[n]));
    },
  );

  it("keeps them in order, because the order is a priority", () => {
    const doc = readFileSync(join(ROOT, "docs", "CONTRACTS.md"), "utf8");
    const section = doc.slice(
      doc.indexOf("## The eleven"),
      doc.indexOf("## Contract 1 "),
    );
    const order = [...section.matchAll(/\*\*(\d+)\.\*\*/g)].map((m) => Number(m[1]));
    expect(order).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe("the drift guard would notice a drifted file", () => {
  it("rejects a softened absolute", () => {
    const softened = AUTHORED[6].replace(
      "Never introduce platform-funded contributor payouts.",
      "Avoid platform-funded contributor payouts where practical.",
    );
    expect(normalise(softened)).not.toBe(normalise(AUTHORED[6]));
  });

  it("rejects a dropped clause", () => {
    const trimmed = AUTHORED[4].replace(
      /No TURN relay[\s\S]*?is accepted\./,
      "",
    );
    expect(normalise(trimmed)).not.toBe(normalise(AUTHORED[4]));
  });

  it("rejects an added exception", () => {
    const widened = `${AUTHORED[2]} Analytics aggregates are permitted.`;
    expect(normalise(widened)).not.toBe(normalise(AUTHORED[2]));
  });

  it("does not reject a change of typography alone", () => {
    const retyped = AUTHORED[3]
      .replace(/-/g, "—")
      .replace(/'/g, "’");
    expect(normalise(retyped)).toBe(normalise(AUTHORED[3]));
  });
});
