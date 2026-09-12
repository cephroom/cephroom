import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  fairShare,
  limitedBy,
  LISTING_MIN_SHARE,
} from "@/lib/signaling/fair-share";
import { ROOT, stripCommentsOnly } from "./scan";
import { DISCOVERY_REACH } from "@/lib/stripe/plans";

interface Entry {
  sub: string;
  id: string;
}

const network = (spec: number[]): Entry[] =>
  spec.flatMap((n, i) =>
    Array.from({ length: n }, (_, j) => ({ sub: `s_${i}`, id: `${i}-${j}` })),
  );

function returned(spec: number[], limit: number): number {
  return fairShare(network(spec), (e) => e.sub, limit).length;
}

describe("a truncated listing says which limit truncated it", () => {
  it("says nothing was cut when nothing was", () => {
    expect(limitedBy(20, 20, 50)).toBeNull();
  });

  it("names the plan when the plan's ceiling was reached", () => {
    expect(limitedBy(50, 400, 50)).toBe("reach");
  });

  it("names the share when the equal share bound it below the ceiling", () => {
    expect(limitedBy(30, 45, 50)).toBe("share");
  });

  it("prefers the plan when the ceiling was reached and more were matching", () => {
    expect(limitedBy(50, 60, 50)).toBe("reach");
  });

  it("says nothing was cut even when the count happens to equal the ceiling", () => {
    expect(limitedBy(50, 50, 50)).toBeNull();
  });
});

describe("the share floor, not the plan, is what binds a small network", () => {
  const spec = [25, 8, 8, 2, 2];
  const online = spec.reduce((a, b) => a + b, 0);

  it("returns the same number on browse and on query", () => {
    const onBrowse = returned(spec, DISCOVERY_REACH.browse);
    const onQuery = returned(spec, DISCOVERY_REACH.query);

    expect(
      onQuery,
      [
        "Five contributors, forty-five items online. Browse and Query return the",
        "same listing, because both land on the per-contributor share floor long",
        "before either plan's ceiling.",
        "",
        "That is correct behaviour - the floor is what stops a flooder taking the",
        "page - but it means telling this reader 'your plan returns 200' while",
        "showing them 30 is an upsell for something they already have.",
      ].join("\n"),
    ).toBe(onBrowse);

    expect(onBrowse).toBeLessThan(online);
  });

  it("is share-bound on both, so neither may be described as plan-limited", () => {
    expect(limitedBy(returned(spec, DISCOVERY_REACH.browse), online, DISCOVERY_REACH.browse)).toBe("share");
    expect(limitedBy(returned(spec, DISCOVERY_REACH.query), online, DISCOVERY_REACH.query)).toBe("share");
  });

  it("does become plan-bound once enough contributors are online", () => {
    const many = Array.from({ length: 30 }, () => 10);
    const total = 300;
    expect(limitedBy(returned(many, DISCOVERY_REACH.browse), total, DISCOVERY_REACH.browse)).toBe("reach");
  });

  it("is the floor doing it, and the floor is the flood defence", () => {
    expect(LISTING_MIN_SHARE).toBeGreaterThan(0);
    const flooded = returned([500, 3, 3], DISCOVERY_REACH.browse);
    expect(flooded).toBeLessThanOrEqual(LISTING_MIN_SHARE * 3);
  });
});

describe("what the reader is told matches which limit applied", () => {
  const live = stripCommentsOnly(
    readFileSync(
      join(ROOT, "src", "app", "api", "v1", "live", "route.ts"),
      "utf8",
    ),
  );
  const search = readFileSync(
    join(ROOT, "src", "components", "live-search.tsx"),
    "utf8",
  );

  it("the listing reports the cause rather than only the fact", () => {
    expect(
      live,
      "A reader cannot tell whether paying more would return more unless the answer says which limit applied.",
    ).toContain("limitedBy");
  });

  it("the reader is not told their plan returns more when it would not", () => {
    const collapsed = search.replace(/\s+/g, " ");
    expect(collapsed).toMatch(/limitedBy|limited/i);
    expect(
      collapsed,
      [
        "The old copy read: `${answer.matching} matched; ${answer.reach.plan}",
        "returns ${answer.reach.results}.` - shown to a reader looking at 30",
        "results with 45 online and a plan ceiling of 50 that was never reached.",
        "It reads as 'upgrade to see the rest' and upgrading returns the same 30.",
      ].join("\n"),
    ).not.toMatch(/\$\{answer\.reach\.plan\} returns \$\{answer\.reach\.results\}/);
  });

  it("explains the equal share where a reader is deciding what to pay", () => {
    const pricing = readFileSync(
      join(ROOT, "src", "app", "pricing", "page.tsx"),
      "utf8",
    ).replace(/\s+/g, " ");

    expect(
      pricing,
      "The /contribute page explains the equal share to contributors. A reader buying reach needs the same fact, because it is the thing that decides what their money returns.",
    ).toMatch(/equal share|same share|share of (the|a|any) listing/i);
  });
});
