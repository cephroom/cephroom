import { beforeAll, describe, expect, it } from "vitest";


const ENV = {
  AUTH_SUBJECT_SECRET: "test-subject-secret",
  CEPHROOM_SIGNING_KEY: "",
  CEPHROOM_PUBLIC_KEY: "",
};

beforeAll(async () => {
  const { generateKeyPair, exportPKCS8, exportSPKI } = await import("jose");
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    extractable: true,
  });
  ENV.CEPHROOM_SIGNING_KEY = Buffer.from(await exportPKCS8(privateKey)).toString(
    "base64",
  );
  ENV.CEPHROOM_PUBLIC_KEY = Buffer.from(await exportSPKI(publicKey)).toString(
    "base64",
  );
  Object.assign(process.env, ENV);
});

describe("publishing costs nothing", () => {
  it("mints a serve key for somebody with no subscription at all", async () => {
    const { mintServeKey, verifyServeKey } = await import("@/lib/keys/tokens");

    const key = await mintServeKey({ sub: "s_free_contributor" });
    const verified = await verifyServeKey(key);

    expect(verified?.sub).toBe("s_free_contributor");
  });

  it("gives that key real capacity, not zero", async () => {
    const { mintServeKey, verifyServeKey } = await import("@/lib/keys/tokens");
    const { FREE_SERVING_CAPACITY } = await import("@/lib/stripe/plans");

    const verified = await verifyServeKey(
      await mintServeKey({ sub: "s_free_contributor" }),
    );
    expect(verified?.capacity).toBe(FREE_SERVING_CAPACITY);
    expect(FREE_SERVING_CAPACITY).toBeGreaterThan(0);
  });

  it("makes the free capacity enough to actually publish with", async () => {
    const { FREE_SERVING_CAPACITY } = await import("@/lib/stripe/plans");
    expect(FREE_SERVING_CAPACITY).toBeGreaterThanOrEqual(20);
  });

  it("keeps the free plan a plan, not a trial", async () => {
    const { SERVING_PLANS, FREE_SERVING_TIER } = await import(
      "@/lib/stripe/plans"
    );
    const free = SERVING_PLANS[FREE_SERVING_TIER];

    expect(free.prices).toBeUndefined();
    const copy = [free.tagline, ...free.features].join(" ").toLowerCase();
    for (const word of ["trial", "for now", "to start", "get started free", "days"]) {
      expect(copy, `the free serving plan reads as temporary: "${word}"`).not.toContain(
        word,
      );
    }
  });

  it("says so on the free plan, in words", async () => {
    const { SERVING_PLANS, FREE_SERVING_TIER } = await import(
      "@/lib/stripe/plans"
    );
    const free = SERVING_PLANS[FREE_SERVING_TIER];
    expect(free.tagline.toLowerCase()).toContain("free");
  });

  it("never gates announcing behind a scope any plan has to buy", async () => {
    const { mintServeKey, verifyServeKey } = await import("@/lib/keys/tokens");
    const { SERVING_CAPACITY } = await import("@/lib/stripe/plans");

    const free = await verifyServeKey(await mintServeKey({ sub: "s_a" }));
    const paid = await verifyServeKey(
      await mintServeKey({ sub: "s_b", capacity: SERVING_CAPACITY.stacks }),
    );

    expect(free).not.toBeNull();
    expect(paid).not.toBeNull();
    expect(Object.keys(free!).sort()).toEqual(Object.keys(paid!).sort());
  });

  it("never sells the act of serving as a paid feature", async () => {
    const { SERVING_PLANS, SERVING_ORDER, FREE_SERVING_TIER } = await import(
      "@/lib/stripe/plans"
    );

    const paidCopy = SERVING_ORDER.filter((id) => id !== FREE_SERVING_TIER)
      .map((id) => SERVING_PLANS[id])
      .flatMap((plan) => [plan.tagline, ...plan.features])
      .join(" ")
      .toLowerCase();

    for (const phrase of [
      "serve your own",
      "serve under your own",
      "run a node",
      "publish your work",
      "start serving",
      "unlock serving",
    ]) {
      expect(paidCopy, `a paid serving plan sells "${phrase}"`).not.toContain(
        phrase,
      );
    }
  });

  it("describes the paid plans as more of the same, not something else", async () => {
    const { SERVING_PLANS, SERVING_ORDER, FREE_SERVING_TIER } = await import(
      "@/lib/stripe/plans"
    );
    for (const id of SERVING_ORDER) {
      if (id === FREE_SERVING_TIER) continue;
      const copy = [SERVING_PLANS[id].tagline, ...SERVING_PLANS[id].features]
        .join(" ")
        .toLowerCase();
      expect(copy, `${id} does not say what it adds`).toMatch(
        /more|up to|items|capacity|listing/,
      );
    }
  });

  it("puts a contributor's plan nowhere near a consumer's", async () => {
    const { DISCOVERY_ORDER, SERVING_ORDER } = await import(
      "@/lib/stripe/plans"
    );
    expect(DISCOVERY_ORDER.some((id) => (SERVING_ORDER as string[]).includes(id))).toBe(
      false,
    );
  });
});

describe("the contribute page does not read like a countdown", () => {
  it("says serving is free before it mentions a limit", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { ROOT } = await import("./scan");

    const page = readFileSync(
      join(ROOT, "src", "app", "contribute", "page.tsx"),
      "utf8",
    ).replace(/\s+/g, " ");

    const saysFree = page.search(/serving is free|free (?:to serve|and needs no account)/i);
    expect(saysFree, "the page never says serving is free").toBeGreaterThan(-1);

    const mentionsCapacity = page.search(/up to \{?SERVING_CAPACITY|items at once/i);
    if (mentionsCapacity > -1) {
      expect(
        saysFree,
        "the page introduces a limit before it says serving is free",
      ).toBeLessThan(mentionsCapacity);
    }
  });

  it("never tells a contributor their work earns them anything here", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { ROOT } = await import("./scan");

    const page = readFileSync(
      join(ROOT, "src", "app", "contribute", "page.tsx"),
      "utf8",
    ).replace(/\s+/g, " ");

    expect(page).toMatch(/never pay you ourselves/i);
    expect(page).toMatch(/no bonuses/i);
  });
});
