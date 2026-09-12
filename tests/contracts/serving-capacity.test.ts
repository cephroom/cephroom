import { generateKeyPairSync, randomBytes } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { fairShare, LISTING_MIN_SHARE } from "@/lib/signaling/fair-share";
import {
  FREE_SERVING_CAPACITY,
  SERVING_CAPACITY,
  DISCOVERY_REACH,
} from "@/lib/stripe/plans";

/**
 * What a contributor's plan buys, and what it deliberately does not.
 *
 * It buys **how many items may be listed at once**. That is the same limit
 * the fair-share work introduced when one contributor announced five hundred
 * items and took 97% of the page — the mechanism already existed as an abuse
 * control, and this states it as a plan.
 *
 * It does **not** buy reach, ranking, or prominence, and the distinction is
 * the whole reason the two subscriptions can coexist without becoming the old
 * model again. If paying us bought a bigger share of somebody's search
 * results, a contributor plan would be buying attention that consumers came
 * here for, and the listing would be an auction. Every contributor present
 * gets an equal share of whatever page is being built; a plan changes how
 * many of *their* items are eligible to fill it, not how many slots they get.
 *
 * Which leaves a deliberate interaction worth stating: a contributor with
 * 2,500 items listed is fully discoverable to a consumer whose plan returns
 * enough results to reach them, and a sample to one whose plan does not. The
 * contributor decides how much is *present*; the consumer decides how much
 * they *see*. Neither pays for the other's side.
 */

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
    // The key is signed by us, so this is not an attack — it is a guard
    // against a bug upstream minting something nonsensical and the registry
    // honouring it forever after.
    const verified = await tokens.verifyServeKey(
      await tokens.mintServeKey({ sub: "s_liar", capacity: 10_000_000 }),
    );
    expect(verified?.capacity).toBe(SERVING_CAPACITY.stacks);
  });

  it("falls back to free rather than zero when the claim is nonsense", async () => {
    // Zero would silently take a contributor offline. Free is the honest
    // reading of "we could not tell what you had bought".
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
    // From the key, not from the body: a contributor cannot announce their
    // own allowance.
    expect(route).toContain("capacity");
    expect(route).not.toMatch(/body\.capacity|parsed\.data\.capacity/);
  });
});

describe("capacity buys presence, never prominence", () => {
  it("gives every contributor the same share of a page, whatever they pay", () => {
    // The contributor on Stacks and the contributor on Desk appear equally
    // in a listing. If this ever stopped being true, a contributor plan would
    // be buying search results, which is the consumer's product and the old
    // model wearing a different hat.
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

    // The free contributor keeps all five — a small contributor is never
    // truncated to make room — and the paid one does not get the page.
    expect(counts.s_desk).toBe(5);
    expect(counts.s_stacks).toBeLessThanOrEqual(LISTING_MIN_SHARE);
    expect(counts.s_stacks / page.length).toBeLessThan(0.75);
  });

  it("surfaces more of a large contributor as the consumer's reach grows", () => {
    // The deliberate interaction: the contributor decides how much is
    // present, the consumer decides how much they see. Neither buys the
    // other's side.
    const entries = Array.from({ length: SERVING_CAPACITY.stacks }, (_, i) => ({
      sub: "s_stacks",
      id: `a${i}`,
    }));
    const browsing = fairShare(entries, (e) => e.sub, DISCOVERY_REACH.browse);
    const sweeping = fairShare(entries, (e) => e.sub, DISCOVERY_REACH.sweep);
    expect(sweeping.length).toBeGreaterThan(browsing.length);
  });

  it("keeps the free capacity generous enough to never be met in practice", () => {
    // A researcher with their columns and the datasets behind them.
    expect(FREE_SERVING_CAPACITY).toBeGreaterThanOrEqual(20);
  });
});
