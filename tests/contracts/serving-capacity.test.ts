import { generateKeyPairSync, randomBytes } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { fairShare, LISTING_MIN_SHARE } from "@/lib/signaling/fair-share";
import {
  FREE_SERVING_CAPACITY,
  SERVING_CAPACITY,
  DISCOVERY_REACH,
} from "@/lib/stripe/plans";


const platform = generateKeyPairSync("ed25519");
const b64 = (pem: string) => Buffer.from(pem).toString("base64");
let tokens: typeof import("@/lib/keys/tokens");

beforeAll(async () => {
  process.env.CEPHROOM_SIGNING_KEY = b64(
    platform.privateKey.export({ type: "pkcs8", format: "pem" }) as string,
  );
  process.env.CEPHROOM_PUBLIC_KEY = b64(
    platform.publicKey.export({ type: "spki", format: "pem" }) as string,
  );
  process.env.AUTH_SUBJECT_SECRET = randomBytes(32).toString("hex");
  tokens = await import("@/lib/keys/tokens");
});

describe("a serve key carries the capacity its plan bought", () => {
  it("gives a key with no plan behind it the free capacity", async () => {
    const verified = await tokens.verifyServeKey(
      await tokens.mintServeKey({ sub: "s_free" }),
    );
    expect(verified?.capacity).toBe(FREE_SERVING_CAPACITY);
  });

  it("carries a paid capacity when one was bought", async () => {
    const verified = await tokens.verifyServeKey(
      await tokens.mintServeKey({
        sub: "s_paid",
        capacity: SERVING_CAPACITY.stacks,
      }),
    );
    expect(verified?.capacity).toBe(SERVING_CAPACITY.stacks);
  });

  it("refuses to believe a capacity above the largest plan", async () => {
    const verified = await tokens.verifyServeKey(
      await tokens.mintServeKey({ sub: "s_liar", capacity: 10_000_000 }),
    );
    expect(verified?.capacity).toBe(SERVING_CAPACITY.stacks);
  });

  it("falls back to free rather than zero when the claim is nonsense", async () => {
    for (const nonsense of [0, -5, 1.5, Number.NaN]) {
      const key = await tokens.mintServeKey({
        sub: "s_odd",
        capacity: nonsense,
      });
      expect((await tokens.verifyServeKey(key))?.capacity).toBe(
        FREE_SERVING_CAPACITY,
      );
    }
  });
});

describe("the platform holds a contributor to it", () => {
  it("accepts an announcement inside the capacity", async () => {
    const { announcementSchema } = await import("@/lib/signaling/announcement");
    const { withinCapacity } = await import("@/lib/signaling/announcement");

    const items = Array.from({ length: FREE_SERVING_CAPACITY }, (_, i) => ({
      id: `item-${i}`,
      title: "t",
      kind: "column" as const,
      tags: [],
    }));
    const parsed = announcementSchema.parse({
      displayName: "Ada",
      address: "http://127.0.0.1:4600",
      items,
    });
    expect(withinCapacity(parsed, FREE_SERVING_CAPACITY)).toBe(true);
  });

  it("refuses one over it", async () => {
    const { announcementSchema, withinCapacity } = await import(
      "@/lib/signaling/announcement"
    );
    const items = Array.from({ length: FREE_SERVING_CAPACITY + 1 }, (_, i) => ({
      id: `item-${i}`,
      title: "t",
      kind: "column" as const,
      tags: [],
    }));
    const parsed = announcementSchema.parse({
      displayName: "Ada",
      address: "http://127.0.0.1:4600",
      items,
    });
    expect(withinCapacity(parsed, FREE_SERVING_CAPACITY)).toBe(false);
  });

  it("is enforced at the announce endpoint, against the key's own capacity", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { ROOT, stripCommentsOnly } = await import("./scan");

    const route = stripCommentsOnly(
      readFileSync(
        join(ROOT, "src", "app", "api", "signal", "route.ts"),
        "utf8",
      ),
    );
    expect(route).toContain("withinCapacity");
    expect(route).toContain("capacity");
    expect(route).not.toMatch(/body\.capacity|parsed\.data\.capacity/);
  });
});

describe("capacity buys presence, never prominence", () => {
  it("gives every contributor the same share of a page, whatever they pay", () => {
    const entries = [
      ...Array.from({ length: SERVING_CAPACITY.stacks }, (_, i) => ({
        sub: "s_stacks",
        id: `a${i}`,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({ sub: "s_desk", id: `b${i}` })),
    ];
    const page = fairShare(entries, (e) => e.sub, DISCOVERY_REACH.browse);

    const counts: Record<string, number> = {};
    for (const entry of page) counts[entry.sub] = (counts[entry.sub] ?? 0) + 1;

    expect(counts.s_desk).toBe(5);
    expect(counts.s_stacks).toBeLessThanOrEqual(LISTING_MIN_SHARE);
    expect(counts.s_stacks / page.length).toBeLessThan(0.75);
  });

  it("surfaces more of a large contributor as the consumer's reach grows", () => {
    const entries = Array.from({ length: SERVING_CAPACITY.stacks }, (_, i) => ({
      sub: "s_stacks",
      id: `a${i}`,
    }));
    const browsing = fairShare(entries, (e) => e.sub, DISCOVERY_REACH.browse);
    const sweeping = fairShare(entries, (e) => e.sub, DISCOVERY_REACH.sweep);
    expect(sweeping.length).toBeGreaterThan(browsing.length);
  });

  it("says so in the copy a contributor is deciding from", async () => {
    const { SERVING_PLANS } = await import("@/lib/stripe/plans");
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { ROOT } = await import("./scan");

    const surfaces = [
      Object.values(SERVING_PLANS)
        .flatMap((p) => [p.name, p.tagline, ...p.features])
        .join(" "),
      readFileSync(join(ROOT, "src", "app", "contribute", "page.tsx"), "utf8"),
    ];

    for (const copy of surfaces) {
      for (const promise of [
        "times the size",
        "bigger share",
        "larger share",
        "priority",
        "ranked higher",
        "more visible",
        "prominen",
        "top of the listing",
        "reach more readers",
      ]) {
        expect(copy.toLowerCase(), `serving copy promises "${promise}"`).not.toContain(
          promise,
        );
      }
    }
  });

  it("does not tell a contributor to write an access level", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { ROOT } = await import("./scan");
    const contribute = readFileSync(
      join(ROOT, "src", "app", "contribute", "page.tsx"),
      "utf8",
    );
    expect(contribute).not.toMatch(/>access\s*</);
  });

  it("keeps the free capacity generous enough to never be met in practice", () => {
    expect(FREE_SERVING_CAPACITY).toBeGreaterThanOrEqual(20);
  });
});
