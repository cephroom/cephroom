import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsAndStrings } from "./scan";

const proposeForm = readFileSync(
  join(ROOT, "src", "components", "node-proposal-form.tsx"),
  "utf8",
).replace(/\s+/g, " ");

const nodeServer = stripCommentsAndStrings(
  readFileSync(join(ROOT, "node", "server.ts"), "utf8"),
);

describe("what the propose form promises is what the node does", () => {
  it("does not claim a wrong number cannot be proposed", () => {
    expect(
      proposeForm,
      [
        "The node runs parseBody and rejects on parse errors: a missing field, a",
        "duplicate key, a {{claim:x}} with no block behind it. It does NOT resolve",
        "a claim against the dataset, so a claim whose number is wrong parses",
        "cleanly and is accepted.",
        "",
        "That is deliberate — see the note beside this test — but it means the",
        "form must not tell a reader that a broken number cannot arrive.",
      ].join("\n"),
    ).not.toMatch(/broken number cannot arrive|cannot arrive as a proposal/i);
  });

  it("does not claim the node checks whether claims resolve", () => {
    expect(proposeForm).not.toMatch(
      /refuses anything whose claims do not resolve/i,
    );
  });

  it("says what the node actually checks", () => {
    expect(proposeForm).toMatch(/parse|syntax|well-formed|malformed/i);
  });

  it("still describes a node that rejects unparseable claims, because it does", () => {
    expect(nodeServer).toMatch(/parseBody/);
    expect(nodeServer).toMatch(/parsed\.errors\.length/);
  });

  it("does not resolve claims against the dataset when accepting a proposal", () => {
    const handler = nodeServer.slice(
      nodeServer.indexOf("/proposals"),
      nodeServer.indexOf("/column/"),
    );
    expect(
      handler,
      [
        "If the node ever starts resolving claims at propose time, this test",
        "should be inverted and the form copy changed back. Note the reason it",
        "does not: a proposal whose number differs from the dataset is often the",
        "point — an editor correcting a figure that has drifted needs to be able",
        "to state the new one. Refusing it would refuse the correction.",
      ].join("\n"),
    ).not.toMatch(/resolveClaims|judge\(/);
  });
});

describe("what a serving plan promises is what fair-share gives", () => {
  it("promises no contributor a larger share of a listing than anyone else", async () => {
    const { SERVING_PLANS, SERVING_ORDER } = await import("@/lib/stripe/plans");

    const copy = SERVING_ORDER.flatMap((id) => [
      SERVING_PLANS[id].tagline,
      ...SERVING_PLANS[id].features,
    ]);

    for (const line of copy) {
      expect(
        line,
        [
          `"${line}"`,
          "",
          "fairShare gives every online contributor the same number of slots in a",
          "listing, whatever they pay, so a listing is not a thing a plan can sell.",
          "Capacity is: how much work you may have online at once. Say that, and",
          "leave the listing to /contribute, which explains the equal share",
          "correctly. A plan bullet must not contradict the page it appears on.",
        ].join("\n"),
      ).not.toMatch(
        /listing|larger share|bigger share|priority|ranked higher|boost/i,
      );
    }
  });

  it("is backed by fair-share actually ignoring the plan", async () => {
    const { fairShare } = await import("@/lib/signaling/fair-share");

    const entries = [
      ...Array.from({ length: 250 }, (_, i) => ({ sub: "shelf", id: `s${i}` })),
      ...Array.from({ length: 25 }, (_, i) => ({ sub: "desk", id: `d${i}` })),
    ];
    const result = fairShare(entries, (entry) => entry.sub, 200);

    const counts: Record<string, number> = {};
    for (const entry of result) counts[entry.sub] = (counts[entry.sub] ?? 0) + 1;

    expect(counts.shelf).toBe(counts.desk);
  });

  it("still lets a plan describe the capacity it does buy", async () => {
    const { SERVING_PLANS } = await import("@/lib/stripe/plans");
    const shelf = [SERVING_PLANS.shelf.tagline, ...SERVING_PLANS.shelf.features]
      .join(" ")
      .toLowerCase();
    expect(shelf).toMatch(/items|announce|at once|capacity/);
  });
});
