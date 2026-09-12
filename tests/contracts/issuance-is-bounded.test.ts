import { generateKeyPairSync, randomBytes } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { IssuanceGate, ISSUANCE_CONCURRENCY } from "@/lib/tokens/issuance-gate";

beforeAll(() => {
  const pair = generateKeyPairSync("ed25519");
  process.env.CEPHROOM_SIGNING_KEY = Buffer.from(
    pair.privateKey.export({ type: "pkcs8", format: "pem" }) as string,
  ).toString("base64");
  process.env.CEPHROOM_PUBLIC_KEY = Buffer.from(
    pair.publicKey.export({ type: "spki", format: "pem" }) as string,
  ).toString("base64");
  process.env.AUTH_SUBJECT_SECRET ??= randomBytes(32).toString("hex");
});


describe("the issuance gate bounds work, not people", () => {
  it("admits up to its capacity", () => {
    const gate = new IssuanceGate(2);
    expect(gate.tryEnter()).toBe(true);
    expect(gate.tryEnter()).toBe(true);
    expect(gate.inFlight()).toBe(2);
  });

  it("refuses beyond it", () => {
    const gate = new IssuanceGate(2);
    gate.tryEnter();
    gate.tryEnter();
    expect(gate.tryEnter()).toBe(false);
    expect(gate.inFlight()).toBe(2);
  });

  it("admits again once work finishes", () => {
    const gate = new IssuanceGate(1);
    expect(gate.tryEnter()).toBe(true);
    expect(gate.tryEnter()).toBe(false);
    gate.leave();
    expect(gate.tryEnter()).toBe(true);
  });

  it("does not leak a slot when the work throws", async () => {
    const gate = new IssuanceGate(1);
    await expect(
      gate.run(async () => {
        throw new Error("signing blew up");
      }),
    ).rejects.toThrow("signing blew up");
    expect(gate.inFlight()).toBe(0);
    expect(gate.tryEnter()).toBe(true);
  });

  it("releases the slot on success too", async () => {
    const gate = new IssuanceGate(1);
    expect(await gate.run(async () => "signed")).toBe("signed");
    expect(gate.inFlight()).toBe(0);
  });

  it("never drops below zero, however unbalanced the calls", () => {
    const gate = new IssuanceGate(2);
    gate.leave();
    gate.leave();
    expect(gate.inFlight()).toBe(0);
    expect(gate.tryEnter()).toBe(true);
  });

  it("counts work and knows nothing about who asked", () => {
    const source = IssuanceGate.toString();
    expect(source).not.toMatch(/sub|subject|customer|tier|ip|Map|Set/i);
    expect(Object.getOwnPropertyNames(IssuanceGate.prototype).sort()).toEqual(
      ["constructor", "inFlight", "leave", "run", "tryEnter"].sort(),
    );
  });

  it("leaves room for an honest subscriber topping up", () => {
    expect(ISSUANCE_CONCURRENCY).toBeGreaterThanOrEqual(2);
    expect(ISSUANCE_CONCURRENCY).toBeLessThanOrEqual(4);
  });
});

describe("the exposure this gate could not close was removed instead", () => {
  it("issues tokens against discovery plans, not against anyone's content", async () => {
    const { TOKEN_TIERS } = await import("@/lib/tokens/issuer");
    const { DISCOVERY_PLANS } = await import("@/lib/stripe/plans");
    for (const tier of TOKEN_TIERS) {
      expect(Object.keys(DISCOVERY_PLANS)).toContain(tier);
    }
  });

  it("mints an anonymous key that unlocks nothing on any node", async () => {
    const { mintAnonymousKey, verifyAccessKey } = await import(
      "@/lib/keys/tokens"
    );
    const verified = await verifyAccessKey(
      await mintAnonymousKey({ discovery: "sweep" }),
    );
    expect(verified!.scp).toEqual([]);
    expect(JSON.stringify(verified)).not.toMatch(/read:/);
  });
});

describe("a stockpile cannot be built far in advance", () => {
  it("keeps tokens usable for only the live epochs", async () => {
    const { liveEpochs, LIVE_EPOCHS, EPOCH_SECONDS } = await import(
      "@/lib/tokens/issuer"
    );
    const now = Date.now();
    expect(liveEpochs(now)).toHaveLength(LIVE_EPOCHS);

    const old = now - (LIVE_EPOCHS + 1) * EPOCH_SECONDS * 1000;
    const overlap = liveEpochs(old).filter((e) => liveEpochs(now).includes(e));
    expect(overlap).toEqual([]);
  });

  it("bounds the useful life of anything farmed", async () => {
    const { LIVE_EPOCHS, EPOCH_SECONDS } = await import("@/lib/tokens/issuer");
    const usefulHours = (LIVE_EPOCHS * EPOCH_SECONDS) / 3600;
    expect(usefulHours).toBeLessThanOrEqual(2);
  });
});
