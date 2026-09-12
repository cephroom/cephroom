import { describe, expect, it } from "vitest";

import { fairShare, LISTING_LIMIT, LISTING_SPREAD } from "@/lib/signaling/fair-share";

/**
 * No contributor can crowd the others out of discovery.
 *
 * Found by running five contributors with one of them hostile. Mallory holds
 * a legitimate key and is entitled to serve — everything she does looks
 * correct to anything that checks signatures. She announced 500 items:
 *
 *   /api/v1/live returns 515 items from 5 contributors
 *   {"Ines":4,"Lena":3,"Mallory":500,"Marcus":4,"Ravi":4}
 *   one contributor's share: 97%
 *   search for a real tag returns 506 results, 500 of them spam
 *   /read page size: 1,678,673 bytes
 *
 * Discovery is the platform's only product surface — "discovery is presence,
 * and that is all" — so burying it buries everything. And the schema was
 * obeyed exactly: 500 items is the documented maximum, each field within its
 * cap. Nothing was malformed. The listing simply had no opinion about
 * proportion.
 *
 * The fix has to hold without state and without judging content, because the
 * platform has neither memory nor any view of what is being served. Ordering
 * is enough: take one item from each contributor in turn. A contributor with
 * 500 items then occupies one slot per round, exactly like a contributor with
 * one, and flooding costs the flooder their own page space rather than
 * everybody else's.
 *
 * The cap on total results is the other half — round-robin fixes who is
 * visible, not how many bytes are sent.
 */

interface Entry {
  sub: string;
  id: string;
}

const from = (spec: Record<string, number>): Entry[] =>
  Object.entries(spec).flatMap(([sub, n]) =>
    Array.from({ length: n }, (_, i) => ({ sub, id: `${sub}-${i}` })),
  );

const countBy = (entries: Entry[]) => {
  const out: Record<string, number> = {};
  for (const e of entries) out[e.sub] = (out[e.sub] ?? 0) + 1;
  return out;
};

describe("one contributor cannot dominate the listing", () => {
  it("gives the flooder no more slots than anybody else", () => {
    // The measured attack, reproduced.
    const result = fairShare(
      from({ marcus: 4, ines: 4, ravi: 4, lena: 3, mallory: 500 }),
      (e) => e.sub,
    );
    const counts = countBy(result);

    // Everyone honest keeps everything they announced.
    expect(counts.marcus).toBe(4);
    expect(counts.ines).toBe(4);
    expect(counts.ravi).toBe(4);
    expect(counts.lena).toBe(3);

    // Before: 97% of the listing. A flooder is held to one contributor's
    // share of the page, whatever they announced.
    const share = counts.mallory / result.length;
    expect(share).toBeLessThan(0.5);

    // And the page stays a page: the honest 15 are not diluted into a
    // thousand-item scroll.
    expect(result.length).toBeLessThan(40);
  });

  it("keeps the first page evenly split", () => {
    const result = fairShare(
      from({ marcus: 4, ines: 4, ravi: 4, lena: 3, mallory: 500 }),
      (e) => e.sub,
    );
    const firstTwenty = countBy(result.slice(0, 20));
    // Four rounds of five. Nobody takes more than their turn.
    expect(Math.max(...Object.values(firstTwenty))).toBeLessThanOrEqual(5);
  });

  it("puts every contributor in the first round, whatever their volume", () => {
    const result = fairShare(
      from({ marcus: 4, ines: 4, ravi: 4, lena: 3, mallory: 500 }),
      (e) => e.sub,
    );
    // The thing that was actually lost: an honest contributor's work being
    // visible at all without scrolling past a wall of somebody else's.
    const firstFive = new Set(result.slice(0, 5).map((e) => e.sub));
    expect(firstFive.size).toBe(5);
  });

  it("keeps the honest ordering when nobody is flooding", () => {
    // Round-robin must not scramble a normal listing into something that
    // changes on every request.
    const entries = from({ marcus: 2, ines: 2 });
    const once = fairShare(entries, (e) => e.sub).map((e) => e.id);
    const twice = fairShare(entries, (e) => e.sub).map((e) => e.id);
    expect(once).toEqual(twice);
  });

  it("returns everything when the total is small", () => {
    const entries = from({ marcus: 4, ines: 4, ravi: 4, lena: 3 });
    expect(fairShare(entries, (e) => e.sub)).toHaveLength(15);
  });

  it("caps the response so a flood cannot be measured in megabytes", () => {
    const result = fairShare(from({ mallory: 5000 }), (e) => e.sub);
    expect(result.length).toBeLessThanOrEqual(LISTING_LIMIT);
  });

  it("does not hand a loud party the room a quiet day left over", () => {
    // Sizing each share against today's turnout is the trap: with five
    // contributors online, dividing a 200-item page five ways gives the
    // flooder forty slots against the honest four's three or four. The page
    // makes room for a network instead.
    const few = fairShare(from({ honest: 3, flooder: 500 }), (e) => e.sub);
    expect(countBy(few).flooder).toBeLessThanOrEqual(LISTING_LIMIT / LISTING_SPREAD);
  });

  it("caps a flood spread across many contributors too", () => {
    // Twenty subjects with fifty items each: fair to all of them, and still
    // bounded, because the limit is on the response rather than on any one
    // announcer.
    const spec: Record<string, number> = {};
    for (let i = 0; i < 20; i += 1) spec[`s_${i}`] = 50;
    const result = fairShare(from(spec), (e) => e.sub);
    expect(result.length).toBeLessThanOrEqual(LISTING_LIMIT);
    // Still even-handed at the cap.
    const counts = Object.values(countBy(result));
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("loses nothing that fits", () => {
    // No silent dropping below the limit: if it is online and there is room,
    // it is listed. Discovery is presence.
    const entries = from({ a: 10, b: 10 });
    const result = fairShare(entries, (e) => e.sub);
    expect(new Set(result.map((e) => e.id)).size).toBe(20);
  });

  it("is a pure ordering, holding no state about who flooded", async () => {
    // Remembering an offender would be an activity record about a person,
    // which is the one remedy not available here. The defence has to work on
    // a single request with no history at all — so the module holds nothing
    // between calls, and the same input always gives the same output.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { ROOT, scan } = await import("./scan");
    const { MUTABLE_GLOBAL_RULE } = await import("./rules");

    expect(scan(["src/lib/signaling"], [MUTABLE_GLOBAL_RULE]).map((h) => h.file))
      .not.toContain("src/lib/signaling/fair-share.ts");

    const source = readFileSync(
      join(ROOT, "src", "lib", "signaling", "fair-share.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/Date\.now|globalThis/);
  });
});
