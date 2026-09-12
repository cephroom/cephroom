import { beforeAll, describe, expect, it } from "vitest";

/**
 * Contract 2's clause that is easiest to break by accident.
 *
 * > Serving remains free: any signed-in reader may announce, whatever their
 * > tier. The requirement is attribution, not payment — an announcement must
 * > be traceable to a subject, so that the registry cannot be written to
 * > anonymously.
 *
 * The README says it, `/contribute` says it, and the code said something else:
 * `scopesForTier` handed `serve:node` to Lab alone, and the Lab plan's feature
 * list sold "serve your own columns" and "serve under your own signed
 * identity" as things you get for $29 a month. Neither was ever enforced —
 * `/api/signal` has always accepted any valid key — so the paywall was
 * imaginary, which makes it worse rather than better: a prospective
 * contributor reading the pricing page would conclude publishing costs money
 * and go away.
 *
 * These tests fail if a tier check reappears anywhere on the path from
 * "signed in" to "announced".
 */

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
  it("does not make serving a scope any tier has to buy", async () => {
    const { scopesForTier } = await import("@/lib/keys/tokens");

    // If serving were gated, this is where the gate would be. It must not be:
    // the free tier and the paid tiers agree about announcing.
    expect(scopesForTier("reader")).not.toContain("serve:node");
    expect(scopesForTier("member")).not.toContain("serve:node");
    expect(scopesForTier("lab")).not.toContain("serve:node");
  });

  it("mints a serve key for a reader-tier contributor", async () => {
    const { mintServeKey, verifyServeKey } = await import("@/lib/keys/tokens");

    const key = await mintServeKey({ sub: "s_free_contributor", tier: "reader" });
    const verified = await verifyServeKey(key);

    expect(verified?.sub).toBe("s_free_contributor");
  });

  it("gives a reader-tier serve key exactly the same capability as a lab one", async () => {
    const { mintServeKey } = await import("@/lib/keys/tokens");
    const { decodeJwt } = await import("jose");

    const free = decodeJwt(
      await mintServeKey({ sub: "s_a", tier: "reader" }),
    ) as { scp?: string[]; aud?: string };
    const paid = decodeJwt(await mintServeKey({ sub: "s_b", tier: "lab" })) as {
      scp?: string[];
      aud?: string;
    };

    expect(free.scp).toEqual(paid.scp);
    expect(free.aud).toEqual(paid.aud);
  });

  it("never sells serving as a feature of a paid plan", async () => {
    const { PLANS } = await import("@/lib/stripe/plans");

    // Selling something that is free is worse than a bug: it turns a
    // contributor away at the pricing page. Phrased as a scan over the copy
    // rather than an exact-string match, so a rewrite cannot slip it back in.
    const paidCopy = Object.values(PLANS)
      .flatMap((plan) => [plan.tagline, ...plan.features])
      .join(" ")
      .toLowerCase();

    expect(paidCopy).not.toMatch(/serve your own/);
    expect(paidCopy).not.toMatch(/serve under your own/);
    expect(paidCopy).not.toMatch(/run a node/);
  });
});
