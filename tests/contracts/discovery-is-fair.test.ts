import { describe, expect, it } from "vitest";

import { fairShare, LISTING_LIMIT, LISTING_SPREAD } from "@/lib/signaling/fair-share";


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
    const result = fairShare(
      from({ marcus: 4, ines: 4, ravi: 4, lena: 3, mallory: 500 }),
      (e) => e.sub,
    );
    const counts = countBy(result);

    expect(counts.marcus).toBe(4);
    expect(counts.ines).toBe(4);
    expect(counts.ravi).toBe(4);
    expect(counts.lena).toBe(3);

    const share = counts.mallory / result.length;
    expect(share).toBeLessThan(0.5);

    expect(result.length).toBeLessThan(40);
  });

  it("keeps the first page evenly split", () => {
    const result = fairShare(
      from({ marcus: 4, ines: 4, ravi: 4, lena: 3, mallory: 500 }),
      (e) => e.sub,
    );
    const firstTwenty = countBy(result.slice(0, 20));
    expect(Math.max(...Object.values(firstTwenty))).toBeLessThanOrEqual(5);
  });

  it("puts every contributor in the first round, whatever their volume", () => {
    const result = fairShare(
      from({ marcus: 4, ines: 4, ravi: 4, lena: 3, mallory: 500 }),
      (e) => e.sub,
    );
    const firstFive = new Set(result.slice(0, 5).map((e) => e.sub));
    expect(firstFive.size).toBe(5);
  });

  it("keeps the honest ordering when nobody is flooding", () => {
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
    const few = fairShare(from({ honest: 3, flooder: 500 }), (e) => e.sub);
    expect(countBy(few).flooder).toBeLessThanOrEqual(LISTING_LIMIT / LISTING_SPREAD);
  });

  it("caps a flood spread across many contributors too", () => {
    const spec: Record<string, number> = {};
    for (let i = 0; i < 20; i += 1) spec[`s_${i}`] = 50;
    const result = fairShare(from(spec), (e) => e.sub);
    expect(result.length).toBeLessThanOrEqual(LISTING_LIMIT);
    const counts = Object.values(countBy(result));
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("loses nothing that fits", () => {
    const entries = from({ a: 10, b: 10 });
    const result = fairShare(entries, (e) => e.sub);
    expect(new Set(result.map((e) => e.id)).size).toBe(20);
  });

  it("is a pure ordering, holding no state about who flooded", async () => {
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
